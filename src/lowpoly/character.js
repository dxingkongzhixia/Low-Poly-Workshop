/**
 * lowpoly/character.js —— **角色抽象类** + 具体角色 + 角色注册表。
 *   Character（抽象）把三大块拼在一起：model（人物模型）/ weapons（武器池绑定）/ actions（动作绑定）。
 */
import { buildMiku, buildBRS, CH, normaliseHeight } from './model.js';
import { mountWeapons } from './rig.js';
import { LOADOUT } from './weapons.js';
import { ACTIVITIES } from './actions.js';

/* ==========================================================================
 *  ★ 人物抽象类 —— 一个角色 = 三大块：**人物模型** / **武器池绑定** / **动作绑定**
 *    · build()          人物模型（子类实现）
 *    · defaultLoadout() 武器池绑定：角色自带的武器（绑进「角色武器池」）
 *    · actions()        动作绑定：移动（状态机）+ 活动（共用 actions.js）
 * ========================================================================== */
export class Character {
  constructor(palette = {}) { Object.assign(this, palette); }
  /** 人物模型 —— 子类必须实现 */
  build() { throw new Error(`[Character] ${this.id || '?'} 未实现 build()`); }
  /** 武器池绑定 —— 默认空手（可被共享池覆盖） */
  defaultLoadout() { return []; }
  /** 动作绑定 —— 移动（状态机）+ 活动（ACTIVITIES） */
  actions() { return ACTIVITIES; }
  /** 一键装配：模型 + 武器池（自带武器 → 角色武器池） */
  assemble(opts = {}) {
    const proto = this.build();
    proto.spec = this;
    proto.weaponRig = mountWeapons(proto, [], { startNative: true, bind: this.defaultLoadout() });
    proto.weaponRig.setArmed(opts.combat ?? true, '');
    return proto;
  }
}

export class Miku extends Character {
  constructor() { super({
    id: 'miku', name: '初音未来', en: 'HATSUNE MIKU', feat: '青绿双马尾 · 领带 · 耳机',
    skin: 0xf7d9c8,
    hair: 0x3ec6bd, hairHi: 0x8ae6e0, shade: 0x247d80,
    shirt: 0xe9edf2, shirtB: 0xc4ccd6, tie: 0x2fb3bc,
    boot: 0x22252b, boot2: 0x2f333b, trim: 0x40cdd2,
    hphone: 0x1b1e23, sole: 0xdfe4e8, acc: 0xf2607c,
    eyes: [0x145f86, 0x2fa8cf, 0xd6f2fb],
  }); }
  build() { return buildMiku(this); }
}

export class Brs extends Character {
  constructor() { super({
    id: 'brs', name: '黑岩射手', en: 'BLACK★ROCK SHOOTER', feat: '黑双马尾 · 白腰带 · 湛蓝斗篷 · 蓝火 · 黑刃',
    skin: 0xf7d9c8,
    hair: 0x14161c, shade: 0x0e1016,
    fringe: 0x2e343f, tail: 0x262b34, hairHi: 0x4a5670,
    coat: 0x191c22, coatB: 0x272c36, coat2: 0x0e1014,
    boot: 0x111318, bootGrey: 0x3d444d,
    cloak: 0x223c5a, cloakHi: 0x53b6e6,
    belt: 0xe6ebef, star: 0xe6ebef, trim: 0xecefe4,
    flame: { outer: 0x1b4f96, mid: 0x2f9be0, core: 0xd6f2ff },
    eyes: [0x2a9fe0, 0x6fc3e8, 0xdcf4ff],
    serious: true, mouth: 0x8f6f6a, flatMouth: true, lash: 0x181922,
  }); }
  build() { return buildBRS(this); }
  defaultLoadout() { return LOADOUT; }        // 黑岩自带：黑岩巨炮 + 黑刃
}

/** 角色注册表：id → Character 实例 */
export const CHARACTERS = { miku: new Miku(), brs: new Brs() };

/* ==========================================================================
 *  建角色 / 挂载
 * ========================================================================== */
export function buildCharacter(id) {
  const spec = CHARACTERS[id] || CHARACTERS.miku;
  const proto = spec.build(spec);
  proto.spec = spec;
  return { proto, spec };
}
/** 建 + 归一化 + 挂到 target；返回 { proto, spec, naturalH } */
export function mount(id, target, opts = {}) {
  const { proto, spec } = buildCharacter(id);
  const naturalH = normaliseHeight(proto.root, opts.height ?? CH.HEIGHT, proto.detach ?? []);
  proto.baseY = proto.root.position.y;
  proto.crouch = 0; proto.motion = 0; proto.gait = 0;
  /* ★ 武器池绑定：角色自带武器 → 「角色武器池」（原生），而不是共享池 */
  const bind = (spec.defaultLoadout && spec.defaultLoadout()) || [];
  if (bind.length) {
    proto.weaponRig = mountWeapons(proto, [], { startNative: true, bind });
    proto.weaponRig.setArmed(opts.combat ?? true, '');
  }
  if (target) target.add(proto.root);
  return { proto, spec, naturalH };
}

/** ★ 互通：把**任意**符合骨骼接口的 rig（例如工坊原作 `XT(id)` 的返回）纳进我们的运行时。
 *  归一化 + 落地 + 可选武器池 —— 之后就能用同一个 `poseCharacter()` 驱动。 */
export function adoptRig(rig, opts = {}) {
  rig.spec = { id: opts.id || 'rig', name: opts.name || opts.id || '角色', feat: opts.feat || '' };
  const naturalH = normaliseHeight(rig.root, opts.height ?? CH.HEIGHT, rig.detach ?? []);
  rig.baseY = rig.root.position.y;
  rig.crouch = 0; rig.motion = 0; rig.gait = 0;
  if (opts.loadout) {
    rig.weaponRig = mountWeapons(rig, opts.loadout);
    rig.weaponRig.setArmed(opts.combat ?? true, '');
  }
  if (opts.target) opts.target.add(rig.root);
  return { proto: rig, spec: rig.spec, naturalH };
}

