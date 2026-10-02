/**
 * lowpoly/actions.js —— **动作绑定**层，两块：
 *   · 移动 movement：poseCharacter() 状态机（motion / crouch / gait）
 *   · 活动 activity ：ACTIVITIES 12 项 + actArm/actArmZ/actHeadX 叠加
 */
import * as THREE from 'three';
import { BODY_Y } from './model.js';

/* ==========================================================================
 *  动画状态机 —— 两个平滑浮点（motion / crouch）+ 一个相位累加器（gait）
 * ========================================================================== */
export const ACTIVITIES = [
  { id: '', label: '站立' }, { id: 'inspect', label: '查看' }, { id: 'work', label: '工作' },
  { id: 'carry', label: '搬运' }, { id: 'chat', label: '交谈' }, { id: 'listen', label: '听' },
  { id: 'drink', label: '喝' }, { id: 'snack', label: '吃' }, { id: 'stretch', label: '伸展' },
  { id: 'dance', label: '跳舞' }, { id: 'sing', label: '唱歌' }, { id: 'game', label: '玩游戏' },
];
function actArm(c, i, t) {
  switch (c) {
    case 'drink':   return i === 1 ? -1.30 + Math.sin(t * 1.3) * .05 : .05;
    case 'snack':   return i === 1 ? -1.15 + Math.sin(t * 3.2) * .26 : -0.95 + Math.sin(t * 1.1) * .06;
    case 'stretch': return -2.20;
    case 'dance':   return -.6 + Math.sin(t * 3 + i) * .55;
    case 'chat':    return i === 1 ? -.65 + Math.sin(t * 2) * .18 : 0;
    case 'inspect': return -.7 + Math.sin(t * 1.8) * .12;
    case 'sing':    return i === 1 ? -1.35 : -.22;
    case 'game':    return -.8;
    case 'work':    return -.4;
    case 'listen':  return Math.sin(t * 3) * .15;
    default:        return 0;
  }
}
function actArmZ(c, i, t) {
  switch (c) {
    case 'drink':   return i === 1 ? -.62 : -.10;
    case 'snack':   return i === 1 ? -.78 : -.42;
    case 'sing':    return i === 1 ? -.45 : 0;
    case 'stretch': return i === 1 ? 1.15 : -1.15;
    case 'dance':   return (i === 1 ? -1 : 1) * Math.abs(Math.sin(t * 3 + i)) * .20;
    default:        return 0;
  }
}
function actHeadX(c) {
  switch (c) {
    case 'drink':   return -.12;
    case 'snack':   return .07;
    case 'inspect': return .05;
    default:        return 0;
  }
}
const _box = new THREE.Box3();
/** ★ 互通：同一套状态机驱动**两种骨骼** —— 我们的角色 / 工坊的原作 XT(id)。
 *  差异点都按「有则动、无则跳过」处理：`coatTails`(原作) vs `cape`(我们)、
 *  `tail`(原作兽尾) vs `tails`(我们的双马尾)、`halo`(光环)、`emperor`(体量) 特例。 */
export function poseCharacter(M, t, dt, o) {
  const p = 1 - Math.exp(-dt * 12);
  const L = (a, b) => a + (b - a) * p;
  const eid = (M.meta && M.meta.id) || (M.spec && M.spec.id) || '';   // emperor 特例
  const air = !!o.air, running = !!o.running, crouchT = !!o.crouch;
  const act = o.moving ? '' : (o.activity ?? '');
  M.crouch = L(M.crouch ?? 0, crouchT ? 1 : 0);
  M.motion = L(M.motion ?? 0, o.moving ? 1 : 0);
  M.gait = (M.gait ?? 0) + dt * (crouchT ? 4.5 : running ? 11 : 7) * (.15 + .85 * M.motion);
  const h = Math.sin(M.gait) * M.motion;
  const carry = air || act === 'carry';
  if (o.attackT != null) { o.attackT += dt / (o.attackDuration || .7); if (o.attackT >= 1) o.attackT = null; }
  const atk = (M.weaponRig && o.attackT != null) ? M.weaponRig.attackPose(o.attackT) : null;
  const aw = atk?.w ?? 0;
  const at = (v) => (v ?? 0) * aw;
  M.weaponRig?.setArmed(o.combat == null ? true : !!o.combat, act, atk ? {
    wRot: { x: at(atk.wRotX), z: at(atk.wRotZ) },
    wStretch: atk.wStretch == null ? 1 : 1 + (atk.wStretch - 1) * aw,
  } : {});
  const armed = M.weaponRig?.armedArms?.() ?? null;
  const m = Math.min(1, M.crouch + at(atk?.brace));
  M.body.position.y = (eid === 'emperor' ? 0 : BODY_Y)
    + Math.abs(Math.sin(M.gait)) * M.motion * (running ? .065 : .035)
    + Math.sin(t * 2) * .013 * (1 - M.motion) + at(atk?.bodyY);
  M.body.rotation.x = L(M.body.rotation.x, m * .24 + (1 - m) * (running ? .12 : air ? .08 : 0) + at(atk?.bodyRotX));
  M.body.rotation.y = at(atk?.bodyRotY);
  M.body.rotation.z = h * (eid === 'emperor' ? .075 : .035) + at(atk?.bodyRotZ);
  (M.legs ?? []).forEach((g, i) => {
    if (g.userData.baseY === undefined) g.userData.baseY = g.position.y;
    g.position.y = g.userData.baseY + m * .22;
    g.rotation.x = -m * .9 + h * (i === 0 ? 1 : -1) * (crouchT ? .16 : running ? .65 : .4);
  });
  (M.arms ?? []).forEach((a, i) => {
    const swing = h * (i === 0 ? -1 : 1) * .34;
    const holding = armed?.has(i);
    const base = carry ? -1.05 : crouchT ? -.45 : (o.combat && holding) ? (-.95 + swing)
                 : swing + actArm(act, i, t) * (1 - M.motion);
    const tz = crouchT ? (i === 0 ? .35 : -.35) : actArmZ(act, i, t);
    const ov = atk?.arms?.[i];
    a.rotation.x = ov ? THREE.MathUtils.lerp(L(a.rotation.x, base), ov.x, ov.w) : L(a.rotation.x, base);
    a.rotation.z = ov ? THREE.MathUtils.lerp(L(a.rotation.z, tz), ov.z, ov.w) : L(a.rotation.z, tz);
  });
  (M.knees ?? []).forEach((k, i) => {
    const r = Math.sin(M.gait + i * Math.PI);
    k.rotation.x = L(k.rotation.x, Math.max(0, -r) * (running ? .7 : .35) * M.motion + m * 1.45);
  });
  if (M.hair) {
    M.hair.rotation.x = L(M.hair.rotation.x, (air ? .15 : .015) + M.motion * .035 + Math.sin(t * 2.1) * .012);
    M.hair.rotation.z = h * .018;
  }
  if (M.tails) {                                  // 我们的双马尾
    M.tails.rotation.x = L(M.tails.rotation.x, .10 + M.motion * .13 + Math.sin(t * 1.9) * .02);
    M.tails.rotation.z = h * .03 + Math.sin(t * 1.4) * .015;
  }
  if (M.coatTails) M.coatTails.rotation.x = -M.motion * .13 + Math.sin(M.gait) * M.motion * .04;  // 原作风衣
  if (M.cape)                                     // 我们的斗篷（正号才是向后）
    M.cape.rotation.x = L(M.cape.rotation.x, M.motion * (running ? .26 : .15) + Math.sin(M.gait) * M.motion * .05 + Math.sin(t * 1.6) * .012);
  if (M.tail) { M.tail.rotation.y = Math.sin(t * 3) * .17; M.tail.rotation.x = M.motion * .15; }   // 原作兽尾
  if (M.halo) M.halo.rotation.z = Math.sin(t) * .045;                                              // 原作光环
  M.head.rotation.x = (air ? -.18 + Math.sin(t * 23) * .035
                          : (act === 'work' && !o.moving ? .12 : Math.sin(t * 1.1) * .035)) + actHeadX(act);
  M.head.rotation.y = o.moving ? 0 : Math.sin(t * .9) * .075;
  if (act === 'dance' && !o.moving) {
    M.body.rotation.z = Math.sin(t * 3) * .11;
    M.body.position.y += Math.abs(Math.sin(t * 3)) * .07;
  }
  M.body.position.y -= m * .22;
  if (crouchT) M.arms.forEach((a) => { a.rotation.x -= .18 * p; });
  if (M.flame) {
    M.flame.visible = !!o.combat;
    if (M.flame.visible) {
      M.flame.scale.set(1 + Math.sin(t * 11) * .05, 1 + Math.sin(t * 8.5) * .09, 1).multiplyScalar(M.flame.userData.baseScale ?? 1);
      M.flame.rotation.z = (M.flame.userData.baseRotZ ?? 0) + Math.sin(t * 6.3) * .10;
    }
  }
  /* 地面钳制（我们的角色靠 knees；原作靠它自己的脚——没有 knees 就跳过） */
  M.root.position.y = M.baseY ?? 0;
  if (M.knees?.length) for (let it = 0; it < 3; it++) {
    M.root.updateMatrixWorld(true);
    let low = Infinity;
    for (const kn of M.knees) { _box.setFromObject(kn); if (_box.min.y < low) low = _box.min.y; }
    if (low >= -.0001) break;
    M.root.position.y -= low;
  }
  /* 眨眼 = 换贴图（我们手绘的脸才有这个；原作的脸走它自己的管线，跳过） */
  if (M.face && M.face.faceMat && M.face.open && M.face.closed) {
    const blink = Math.sin(t * 1.23 + (eid.length || 4)) > .998;
    const serious = !!o.combat && !!M.face.openS;
    const want = serious ? (blink ? M.face.closedS : M.face.openS) : (blink ? M.face.closed : M.face.open);
    if (M.face.faceMat.map !== want) { M.face.faceMat.map = want; M.face.faceMat.needsUpdate = true; }
  }
}
