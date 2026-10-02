/**
 * lowpoly/moves.js —— **武器对应动作**层：每种（类型/种类）一条标准招 + 连携。
 * 纯姿态函数（PH / W_）；末尾把 WEAPONS 的显示名 / 来源标记收尾。
 */
import { WEAPONS } from './weapons.js';

/* ==========================================================================
 *  ★ 武器**标准动作**（每种类型一条，从 character-dsl 搬来）
 *  规则：`moves` 默认取 **和武器 id 同名**的那条 ATTACKS；也可以显式给 `attacks: [...]`。
 *  所以「原版武器全都没有动作」这件事，靠下面这张表 + attach 的默认规则一起解决。
 *  攻击按钮上显示的是这里的 `label`；**武器按钮只显示武器名**（下面统一抹掉「招 · 」前缀）。
 * ========================================================================== */
const ORIG_ATTACKS = {
  twinBlades: { label: '交叉斩', duration: .85, pose(u) {
    const wind = PH(u, 0, .22), strike = PH(u, .22, .55);
    return { armX: -2.05 * wind + 1.80 * strike, armZ: -.55 * wind + 1.55 * strike,
             bodyRotX: .16 * wind - .06 * strike, bodyRotY: .34 * strike - .16 * PH(u, .55, 1), w: W_(u) };
  } },
  blade: { label: '横斩', duration: .70, pose(u) {
    const wind = PH(u, 0, .25), strike = PH(u, .25, .60);
    return { armX: -.90 * wind + .35 * strike, armZ: .50 * wind - 1.35 * strike,
             bodyRotY: -.35 * wind + .80 * strike, bodyRotX: .10 * wind + .06 * strike, w: W_(u) };
  } },
  vector: { label: '点射', duration: .55, pose(u) {
    const aim = PH(u, 0, .15), kick = Math.exp(-u * 9) * Math.sin(u * 26) * .12;
    return { armX: -1.30 * aim + kick, armZ: -.10 * aim, bodyRotX: .06 * aim - kick * .3, w: W_(u) };
  } },
  scabbard: { label: '拔刀斩', duration: .95, pose(u) {
    const wind = PH(u, 0, .30), cut = PH(u, .30, .60);
    return { armX: -1.90 * wind + 1.55 * cut, armZ: .40 * wind - .90 * cut,
             bodyRotY: -.40 * wind + .85 * cut, bodyRotX: .12 * wind + .10 * cut, w: W_(u) };
  } },
  hammer: { label: '上劈', duration: 1.0, pose(u) {
    const up = PH(u, 0, .40), down = PH(u, .40, .65);
    return { armX: -2.30 * up + 2.05 * down, armZ: .25 * up,
             bodyRotX: .22 * up + .18 * down, brace: up * .22 + down * .38, w: W_(u) };
  } },
  shield: { label: '盾击', duration: .80, pose(u) {
    const set = PH(u, 0, .22), bash = PH(u, .22, .45);
    return { armX: -1.30 + .45 * set - .40 * bash, armZ: .25 * set - .40 * bash,
             bodyRotX: .10 * set + .30 * bash, bodyY: -.02 * bash, brace: set * .45 + bash * .42, w: W_(u) };
  } },
  lcShield: { label: '盾压', duration: .90, pose(u) {
    const raise = PH(u, 0, .35), slam = PH(u, .35, .60);
    return { armX: -2.10 * raise + 1.40 * slam, armZ: .35 * raise - .50 * slam,
             bodyRotX: .18 * raise + .26 * slam, bodyY: -.08 * slam, brace: raise * .30 + slam * .48, w: W_(u) };
  } },
  chainMace: { label: '链锤回旋', duration: 1.30, pose(u) {
    const wind = PH(u, 0, .22), fling = PH(u, .22, .50), rec = PH(u, .62, 1);
    return { armX: -1.28 + .42 * wind - .48 * fling + .48 * rec, armZ: -.28 * wind + .90 * fling - .90 * rec,
             bodyRotY: -.35 * wind + 1.35 * fling - 1.10 * rec, bodyRotX: .12 * fling,
             brace: .05 + .20 * wind,
             wRotX: .18 * wind - 1.15 * fling + 1.15 * rec, wRotZ: .38 * fling - .38 * rec,
             wStretch: 1 + .55 * fling - .55 * rec, w: W_(u) };
  } },
  staff: { label: '横扫', duration: 1.0, pose(u) {
    const wind = PH(u, 0, .25), sweep = PH(u, .25, .65);
    return { armX: -.70 - .25 * wind, armZ: .60 * wind - 1.50 * sweep,
             bodyRotY: -.50 * wind + 1.55 * sweep, bodyRotX: .10 * wind + .06 * sweep, w: W_(u) };
  } },
  suitcase: { label: '提箱挥击', duration: .8, pose(u) {
    const wind = PH(u, 0, .30), swing = PH(u, .30, .65);
    return { armX: -.90 - .50 * wind + .60 * swing, armZ: -.60 * wind + 1.10 * swing,
             bodyRotZ: -.15 * wind + .20 * swing, bodyRotY: -.40 * wind + .70 * swing, bodyRotX: .10 * wind, w: W_(u) };
  } },
  pistol: { label: '射击', duration: .5, pose(u) {
    const aim = PH(u, 0, .12), kick = Math.exp(-u * 10) * Math.sin(u * 24) * .16;
    return { armX: -1.30 * aim + kick, bodyRotX: .05 * aim - kick * .25, w: W_(u) };
  } },
};

/* 武器按钮只显示武器名（把「交叉斩 · 双剑」这种前缀抹掉，动作名归「攻击」按钮） */
for (const k in WEAPONS) {
  const L = WEAPONS[k].label;
  if (typeof L === 'string' && L.includes(' · ')) WEAPONS[k].label = L.split(' · ').pop();
}
/* 来源标记：`orig` = 原版武器（角色实验室给原作 14 人用），`ours` = 我们自己的（初音/黑岩等程序化角色用）。
   原版角色的武器建模更好 → 实验室的池子**只列 orig**。 */
for (const k in WEAPONS) WEAPONS[k].origin = 'ours';
for (const k in ORIG_ATTACKS) if (WEAPONS[k]) WEAPONS[k].origin = 'orig';
if (WEAPONS.chainCoil) WEAPONS.chainCoil.origin = 'orig';   // 诗怀雅的备用链条（pool:false，不进池）
const W_ = (u) => Math.min(1, u * 8) * Math.min(1, (1 - u) * 8);
const PH = (u, a, b) => Math.max(0, Math.min(1, (u - a) / (b - a)));
export const ATTACKS = {
  horizontalSlash: { label: '横斩', duration: .70, pose(u) {
    const wind = PH(u, 0, .25), strike = PH(u, .25, .60);
    return { armX: -.90 * wind + .35 * strike, armZ: .50 * wind - 1.35 * strike,
             bodyRotY: -.35 * wind + .80 * strike, bodyRotX: .10 * wind + .06 * strike, w: W_(u) };
  } },
  verticalSlash: { label: '竖斩', duration: .82, pose(u) {
    const wind = PH(u, 0, .26), cut = PH(u, .26, .58);
    return { armX: -2.15 * wind + 1.95 * cut, armZ: -.16 * wind + .10 * cut,
             bodyRotX: -.12 * wind + .30 * cut, bodyRotY: .14 * wind - .20 * cut, bodyY: -.025 * cut, w: W_(u) };
  } },
  rapidFire: { label: '连射', duration: 1.15, pose(u) {
    const raise = PH(u, 0, .22), t = PH(u, .22, .95);
    const burst = Math.exp(-t * 2.6) * Math.sin(t * Math.PI * 8) * .34;
    return { armX: -1.18 * raise + burst, armZ: -.20 * raise,
             bodyRotX: -.15 * raise - burst * .55, bodyY: -.022 * raise, brace: raise * .42, w: W_(u) };
  } },
};
export const COMBOS = {
  'blackBlade+rockCannon': [
    { label: '斩炮连携', duration: 1.45, pose(u) {
      const aim = PH(u, 0, .20), fire = PH(u, .16, .50), wind = PH(u, .38, .62), cut = PH(u, .62, .92);
      const burst = Math.exp(-fire * 3.2) * Math.sin(fire * Math.PI * 6) * .26;
      return { arms: { 0: { x: -1.16 * aim + burst, z: -.18 * aim, w: W_(u) },
                       1: { x: -2.15 * wind + 1.95 * cut, z: -.14 * wind + .08 * cut, w: W_(u) } },
               bodyRotX: -.06 * aim + .08 * fire - burst * .5 - .12 * wind + .30 * cut,
               bodyRotY: -.20 * aim + .30 * fire, brace: aim * .34, w: W_(u) };
    } },
    { label: '炮击斩', duration: 1.36, pose(u) {
      const aim = PH(u, 0, .22), fire = PH(u, .20, .55), set = PH(u, .55, .70), slash = PH(u, .70, .92);
      const burst = Math.exp(-fire * 3.2) * Math.sin(fire * Math.PI * 6) * .26;
      return { arms: { 0: { x: -1.16 * aim + burst, z: -.18 * aim, w: W_(u) },
                       1: { x: -1.05 * set + .95 * slash, z: .42 * set - 1.05 * slash, w: W_(u) } },
               bodyRotX: -.06 * aim + .08 * fire + .08 * slash - burst * .5,
               bodyRotY: -.20 * aim + .34 * fire - .58 * slash, brace: aim * .34, w: W_(u) };
    } },
  ],
};
/* 声明顺序：ATTACKS 在这里已经初始化 → 现在把原版武器那 11 条标准招并进去 */
Object.assign(ATTACKS, ORIG_ATTACKS);

