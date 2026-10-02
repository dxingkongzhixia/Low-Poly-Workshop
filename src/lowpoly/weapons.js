/**
 * lowpoly/weapons.js —— **武器本体**层：
 *   · WEAPONS：几何（Builder.box/shape）+ 持械姿态（hold）
 *   · 挂载数：单手 / 双手（WEAPON_HANDS / def.hands）
 *   · 种类：刀 / 锤 / 枪 / 炮 / 盾 / 杖 …（WEAPON_CATEGORY）
 *   · 从模型里按名字分割原生武器（extractNativeWeapons）
 */
import * as THREE from 'three';
import { Builder, addCyl } from './model.js';

/* ==========================================================================
 *  武器模块 —— 三层（model / pose / action）+ 武器池
 * ========================================================================== */
export const HAND = [0, -.48, .04];
const BLACKBLADE = { blade: 0x14161b, ridge: 0xb6c0cb, edge: 0x6b747f, guard: 0x22262e, handle: 0x1b1e24, wrap: 0x2c313a, pommel: 0xa8b1bb };
const ROCKCANNON = { body: 0x2c3037, dark: 0x1c2026, band: 0x3b414a, lip: 0x555b65, grip: 0x252a31, rib: 0x171b20, glow: 0x54b4f2, glowCore: 0xbfeaff };
export const WEAPONS = {
  blackBlade: {
    label: '黑刃', metalness: .5, gate: 'always', slot: 'hand', hands: 1, category: 'blade',
    attacks: ['horizontalSlash', 'verticalSlash'],
    hold: { rot: [-.60, 0, .44], upright: true, mirrorZ: true, scale: 1.28 },
    build(b) {
      const C = BLACKBLADE, Y = HAND[1];
      const W = .030, T = .013, Z0 = .172, Z1 = 1.30, ZT = Z1 - .175;
      b.box(0, Y, -.152, .074, .070, .062, C.pommel);
      b.box(0, Y, -.012, .076, .074, .245, C.handle);
      for (let i = 0; i < 7; i++) b.box(0, Y, -.106 + i * .035, .082, .019, .015, C.wrap, (i % 2 ? 1 : -1) * .6);
      b.box(0, Y, .148, .170, .100, .032, C.guard).box(.098, Y, .150, .058, .050, .040, C.guard);
      b.shape([[W, Z0], [W, ZT], [-W * .45, Z1], [-W, Z1 - .048], [-W, Z0]], 0, T * 2, C.blade, 0, Y, Math.PI / 2);
      b.box(W * .52, Y, (Z0 + ZT) / 2, .014, T * 2.16, ZT - Z0, C.ridge)
       .box(-W * .62, Y, (Z0 + ZT) / 2, .010, T * 2.10, ZT - Z0, C.edge);
      return b;
    },
  },
  rockCannon: {
    label: '黑岩巨炮', metalness: .45, gate: 'always', slot: 'hand', hands: 1, category: 'cannon',
    attacks: ['rapidFire'], hand: 0,
    hold: { rot: [-.12, 0, .10], upright: true, mirrorZ: true, scale: 1.5 },
    build(b) {
      const C = ROCKCANNON, Y = HAND[1];
      const tube = (r0, r1, z0, z1, color) => {
        const g = new THREE.CylinderGeometry(r0, r1, z1 - z0, 8, 1, false, -Math.PI / 8);
        g.rotateX(Math.PI / 2); g.translate(0, Y, (z0 + z1) / 2); b.add(g, color);
      };
      tube(.112, .112, .24, 1.00, C.body);
      tube(.092, .112, .00, .24, C.body);
      tube(.134, .134, 1.00, 1.13, C.band);
      const lipG = new THREE.CylinderGeometry(.108, .108, .090, 8, 1, true, -Math.PI / 8);
      lipG.rotateX(Math.PI / 2); lipG.translate(0, Y, 1.175); b.add(lipG, C.lip);
      const ring = new THREE.RingGeometry(.070, .108, 8, 1, -Math.PI / 8);
      ring.translate(0, Y, 1.222); b.add(ring, C.lip);
      const funnel = new THREE.CylinderGeometry(.070, .022, .045, 8, 1, true, -Math.PI / 8);
      funnel.rotateX(Math.PI / 2); funnel.translate(0, Y, 1.200); b.add(funnel, C.glow);
      const core = new THREE.CylinderGeometry(.024, .024, .036, 8, 1, false, -Math.PI / 8);
      core.rotateX(Math.PI / 2); core.translate(0, Y, 1.160); b.add(core, C.glowCore);
      for (const s of [-1, 1]) {
        const g1 = new THREE.CylinderGeometry(.064, .064, .030, 8, 1, false, -Math.PI / 8);
        g1.rotateZ(Math.PI / 2); g1.translate(s * .122, Y + .014, .96); b.add(g1, C.lip);
        const g2 = new THREE.CylinderGeometry(.030, .030, .038, 8, 1, false, -Math.PI / 8);
        g2.rotateZ(Math.PI / 2); g2.translate(s * .134, Y + .014, .96); b.add(g2, C.dark);
      }
      b.shape([[1.04, -.102], [1.04, -.200], [1.16, -.230], [1.34, -.140], [1.19, -.110], [1.10, -.126]], 0, .032, C.body, 0, Y, 0, -Math.PI / 2);
      b.shape([[1.04, -.200], [1.16, -.230], [1.34, -.140], [1.326, -.128], [1.16, -.215], [1.04, -.186]], 0, .040, C.lip, 0, Y, 0, -Math.PI / 2);
      b.box(0, Y - .098, 1.165, .086, .052, .092, C.band)
       .box(0, Y - .118, 1.170, .052, .020, .060, C.dark);
      tube(.080, .080, -.20, .00, C.grip);
      for (let i = 0; i < 5; i++) tube(.090, .090, -.09 + i * .042, -.068 + i * .042, C.rib);
      for (const [dx, dy] of [[0, .104], [0, -.104], [.104, 0], [-.104, 0]])
        b.box(dx, Y + dy, .62, dx ? .016 : .028, dy ? .016 : .028, .74, C.band);
      for (const s of [-1, 1]) {
        b.box(s * .062, Y + .196, .168, .028, .24, .056, C.dark)
         .box(s * .062, Y + .258, .042, .028, .056, .32, C.dark)
         .box(s * .062, Y + .176, -.082, .028, .20, .056, C.dark);
      }
      b.box(0, Y + .308, .188, .054, .050, .056, C.lip)
       .box(0, Y + .296, -.108, .060, .052, .046, C.dark);
      return b;
    },
  },
  /* 初音未来 · 葱（**锤类**）—— 既进共享池（谁都能拿），也是初音「角色武器池」里的原生那根 */
  leek: {
    label: '葱', metalness: .04, gate: 'always', slot: 'hand', hands: 1, type: 'hammer',
    attacks: ['hammer'],
    hold: { rot: [.10, 0, .06], upright: true, mirrorZ: true, scale: 1.0 },
    build(b) {
      const Y = HAND[1], LEAF = 0x63b34a, LEAF2 = 0x82cf62;
      addCyl(b, .048, .058, .34, Y + .17, 0xf2f5ec, 8, false);              // 葱白（杆，沿手臂 Y 向上）
      b.shape([[0, .32], [.09, .62], [.035, .78], [0, .70], [-.035, .78], [-.09, .62]], 0, .080, LEAF, 0, Y);
      b.shape([[0, .32], [.07, .58], [-.005, .72], [0, .60]], -.055, .055, LEAF2, 0, Y);
      b.shape([[0, .32], [-.07, .58], [.005, .72], [0, .60]], .055, .055, LEAF2, 0, Y);
      return b;
    },
  },
};
/* ==========================================================================
 *  ★ 原版武器注册表（12 把）—— 从 `character-dsl/index.html` 整块搬来
 *  （它就是逆向原作武器做的）。和我们已有的 blackBlade / rockCannon **同源且不重复**：
 *  那两把保留我们这版（一字不差）。这些几何都写在**手臂空间**（HAND = [0,-.48,.04]）并带 `hold`，
 *  所以能装到**任何**角色（原作 14 人 / 初音 / 黑岩）手上。
 * ========================================================================== */
/* ⚠ 项目1（character-dsl）的那 11 把武器几何**不再并入** —— 改用**项目2（工坊）模型里分割出来的**武器。
   这里保留作参考，不参与运行。 */
const PORTED_PROJECT1_WEAPONS = {
  /* 拉普兰德 · 成对双剑（默认占双手） */
  twinBlades: {
    label: '交叉斩 · 双剑', metalness: .5, gate: 'always', slot: 'hand', slots: 2,
    hold: { rot: [-.60, 0, .44], upright: true, mirrorZ: true },
    build(b, side) {
      b.box(0, -.5, .18, .38, .065, .09, DARK)
       .box(0, -.53, .8, .075, .045, 1.22, 13162204)
       .box(0, -.53, 1.46, .04, .035, .1, LIGHT);
      const rz = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      b.torus(.235, .035, 13162204, Math.PI / 2, 0, rz, 0, -.53, .365)
       .torus(.187, .018, DARK, Math.PI / 2, 0, rz, 0, -.53, .365)
       .box(0, -.53, .365, .045, .055, .49, 13162204);
    },
  },
  /* 德克萨斯 · 单刀（技能时才出鞘） */
  blade: {
    label: '横斩 · 刀', metalness: .5, gate: 'skill', slot: 'hand',
    hold: { rot: [-.60, 0, .44], upright: true, mirrorZ: true },
    build(b) {
      b.box(0, -.5, .18, .38, .065, .09, DARK)
       .box(0, -.53, .58, .075, .045, .78, 15907925)
       .box(0, -.53, 1, .04, .035, .08, LIGHT)
       .box(0, -.53, .025, .065, .07, .24, 2697003)
       .box(0, -.53, -.11, .11, .09, .06, 12429171);
    },
  },
  /* 能天使 · 冲锋枪 */
  vector: {
    label: '点射 · 冲锋枪', metalness: .35, gate: 'always', slot: 'hand',
    group: { pos: [0, -.47, .04], rot: [.45, 0, 0] }, grip: [0, -.01, 0],
    hold: { rot: [-.08, 0, .06], upright: true },
    build(b) {
      const t = 2434091, n = 12368308, a = 13941080;
      b.box(0, .085, .19, .13, .25, .30, t).box(-.071, .09, .19, .023, .225, .265, a)
       .box(.071, .09, .19, .023, .225, .265, a).box(0, .22, .20, .145, .055, .43, t)
       .box(0, -.12, .19, .08, .24, .10, t).box(0, 0, 0, .09, .18, .095, t, -.08)
       .box(0, .065, .38, .075, .16, .07, t).box(0, .205, .57, .06, .065, .38, t)
       .box(0, .212, .77, .065, .07, .035, n).box(0, .18, -.14, .055, .06, .29, t)
       .box(0, .06, -.28, .085, .29, .055, t).box(0, -.055, -.18, .06, .04, .20, t)
       .box(0, .265, .12, .055, .07, .075, n).box(0, .258, .35, .05, .055, .035, t);
      for (let i = 0; i < 5; i++) b.box(0, .254, .2 + i * .035, .15, .014, .016, 3749694);
    },
  },
  /* 陈 · 剑鞘 */
  scabbard: {
    label: '拔刀斩 · 剑鞘', metalness: .5, gate: 'always', slot: 'hand', attached: true,
    hold: { rot: [-.55, 0, .32], upright: true, mirrorZ: true },
    build(b) {
      b.box(0, -.46, .14, .27, .065, .1, 1448996)
       .box(0, -.49, .62, .1, .06, .95, 12926542)
       .box(.025, -.5, .63, .025, .065, .9, 2303275)
       .box(0, -.47, .12, .17, .21, .17, 14212827)
       .box(.11, -.47, .12, .06, .12, .07, 12833233);
    },
  },
  /* 可颂 · 巨锤 */
  hammer: {
    label: '上劈 · 巨锤', metalness: .4, gate: 'always', slot: 'hand', attached: true,
    group: { pos: [0, -.135, .012], scale: .7 }, grip: [0, -.345, .028],
    hold: { rot: [-.62, 0, .28], scale: .7, upright: true, mirrorZ: true },
    build(b) {
      for (const s of [-1, 1]) b.box(s * .3, -.45, .72, .075, .32, .34, 12632504);
      b.box(0, -.42, .3, .3, .28, .3, 5592926).box(0, -.42, .6, .22, .22, .3, 5592926);
    },
  },
  /* 星熊 · 般若盾 */
  shield: {
    label: '盾击 · 般若盾', metalness: .6, gate: 'always', slot: 'hand', attached: true,
    group: { pos: [-.30, -.05, .16], scale: .62, rot: [0, 0, .18] },
    hold: { rot: [-.10, 0, .10], scale: .62, upright: true, offset: [-.05, -.02, .10], mirrorX: true },
    build(b) {
      b.shape([[-.65, .16], [.5, .16], [.08, -1.1]], .2, .14, 2435886)
       .shape([[-.54, .1], [.38, .1], [.07, -.89]], .282, .02, 6648433)
       .shape([[-.42, .03], [.27, .03], [.06, -.7]], .3, .02, 2239021);
      const pts = [[-.07, -.39], [.08, -.43], [-.08, -.54], [.075, -.6], [-.065, -.72], [.055, -.79]];
      for (let i = 1; i < pts.length; i++) {
        const [rx, ry] = pts[i - 1], [ax, ay] = pts[i];
        const dx = ax - rx, dy = ay - ry, len = Math.hypot(dx, dy);
        const ux = -dy / len * .016, uy = dx / len * .016;
        b.shape([[rx + ux, ry + uy], [ax + ux, ay + uy], [ax - ux, ay - uy], [rx - ux, ry - uy]], .333, .006, LIGHT);
      }
      for (const s of [-1, 1]) b.box(s * .22, .1, .292, .012, .22, .008, LIGHT).box(s * .1, -.16, .32, .015, .015, .006, LIGHT);
    },
  },
  /* 诗怀雅 · 链锤 */
  chainMace: {
    label: '链锤', metalness: .6, gate: 'always', slot: 'hand', attached: true,
    hold: { rot: [.50, 0, .20], upright: true, mirrorZ: true },
    build(b) {
      for (let i = 0; i < 9; i++) b.box(0, -.5 - i * .04, .15 + i * .05, .04, .075, .06, 10198161);
      b.box(0, -.86, .61, .28, .23, .28, 4475984);
    },
  },
  /* 诗怀雅 · 备用链条（服装，不在池子里） */
  chainCoil: {
    label: '备用链条', metalness: .6, gate: 'always', slot: 'body', attached: true, pool: false,
    hold: {},
    build(b) {
      for (let i = 0; i < 9; i++) b.box(i * .06, .75 - i * .027, -.3 - i * .07, .09, .095, .12, i % 2 ? 4208175 : 12555871);
    },
  },
  /* 莫斯提马 · 法杖（收纳；近似处理：不建背袋，收械时隐藏） */
  staff: {
    label: '横扫 · 法杖', metalness: .45, gate: 'stowed', slot: 'stowed', needsBag: true,
    stow: { pos: [.065, -.33, .015], scale: .72 }, held: { pos: [.02, -.52, .06], scale: 1, rot: [-.42, 0, .26] },
    grip: [0, -.20, 0], hold: { rot: [-.16, 0, .26], upright: true, mirrorZ: true },
    build(b, side) {
      b.box(0, .18, 0, .045, 1.15, .05, 2370096).box(0, .83, 0, .048, .28, .052, 14211017)
       .box(0, -.43, 0, .045, .1, .05, 14211017);
      if (side < 0) {
        b.torus(.19, .022, 3421240, 0, 0, 0, 0, 1.13, 0)
         .box(0, 1.41, 0, .025, .22, .03, 11903869).box(0, .94, 0, .075, .1, .06, 11903869);
        for (const s of [-1, 1]) b.box(s * .11, 1.13, .005, .012, .32, .015, 11903869, s * .55);
      } else {
        b.box(0, 1.19, 0, .04, .4, .045, 14211017);
        for (const s of [-1, 1]) b.box(s * .065, .94, 0, .016, .13, .018, 3553597, s * .25);
      }
    },
  },
  /* 吽 · 盾（和星熊的剪影不同） */
  lcShield: {
    label: '盾压 · 大盾', metalness: .6, gate: 'always', slot: 'hand', attached: true,
    group: { rot: [0, Math.PI * 35 / 180, 0] },
    hold: { rot: [0, Math.PI * 35 / 180, .10], upright: true, offset: [-.04, -.01, .09], mirrorX: true },
    build(b) {
      b.shape([[-.27, .23], [-.2, .29], [.2, .29], [.27, .23], [.25, -.91], [-.25, -.91]], .23, .105, 15100712)
       .shape([[-.27, -.11], [-.14, -.035], [.13, -.035], [.26, -.13], [.23, -.93], [-.23, -.93]], .298, .035, DARK)
       .shape([[-.145, -.35], [0, -.25], [.145, -.35], [.12, -.89], [-.12, -.89]], .322, .014, 15100712);
      const pts = [[-.07, -.39], [.08, -.43], [-.08, -.54], [.075, -.6], [-.065, -.72], [.055, -.79]];
      for (let i = 1; i < pts.length; i++) {
        const [rx, ry] = pts[i - 1], [ax, ay] = pts[i];
        const dx = ax - rx, dy = ay - ry, len = Math.hypot(dx, dy);
        const ux = -dy / len * .016, uy = dx / len * .016;
        b.shape([[rx + ux, ry + uy], [ax + ux, ay + uy], [ax - ux, ay - uy], [rx - ux, ry - uy]], .333, .006, 15656404);
      }
      for (const s of [-1, 1]) b.box(s * .22, .1, .292, .012, .22, .008, 15656404).box(s * .1, -.16, .32, .015, .015, .006, 15656404);
      for (const g of b.geometries) g.translate(0, -.16, 0);
    },
  },
  /* 大帝 · 提箱 */
  suitcase: {
    label: '提箱', metalness: .45, gate: 'always', slot: 'hand', attached: true,
    group: { rot: [0, Math.PI / 2, 0] },
    hold: { rot: [0, Math.PI / 2, .06], upright: true, offset: [.06, .06, .04], mirrorX: true },
    build(b) {
      b.box(0, -.68, .02, .37, .58, .12, 8754334).box(0, -.68, .092, .26, .48, .024, 12109259)
       .box(0, -.34, .02, .14, .065, .07, DARK);
    },
  },
  /* 大帝 · 银色手枪 */
  pistol: {
    label: '射击 · 手枪', metalness: .7, gate: 'always', slot: 'hand',
    group: { scale: .7 }, hold: { rot: [-.12, 0, .06], scale: .7, upright: true },
    build(b) {
      b.box(-.075, -.44, .17, .1, .09, .28, 12831696).box(-.075, -.5, .08, .075, .15, .09, 7371395)
       .box(-.075, -.44, .318, .055, .045, .014, 3291971).box(-.075, -.386, .25, .025, .022, .028, 14804713);
    },
  },
};

/* ★★ 项目2（低模工坊）的武器：在 `XT(id)` 模型里是**有名字的独立网格**（拉普兰德的 weapons[]、
   可颂的 croissant-hammer/shield、星熊的 hoshi-shield、诗怀雅的 swire-right-chain-weapon、
   莫斯提马的 mostima-staff、能天使的 exusiai-vector、陈的 classic-chen-side-scabbard、
   大帝的 emperor-silver-pistol/suitcase…）。直接**从模型里分割**出来、按名字关联到角色，
   而不是再建一套几何。 */
const WEAPON_NAME_RE = /weapon|staff|pistol|hammer|shield|chain|suitcase|vector|blade|sword|scabbard|gun|cannon|spear|axe|leek|negi/i;
const WEAPON_TYPE_RULES = [
  [/twin|双剑|交叉/i, 'twinBlades'],
  [/scabbard|鞘/i, 'scabbard'],
  [/hammer|锤/i, 'hammer'],
  [/shield|盾/i, 'shield'],
  [/staff|杖/i, 'staff'],
  [/chain|链/i, 'chainMace'],
  [/suitcase|箱/i, 'suitcase'],
  [/pistol|手枪/i, 'pistol'],
  [/vector|gun|枪|炮|cannon|rifle/i, 'vector'],
  [/blade|sword|刀|剑/i, 'blade'],
];
function weaponTypeOf(name) {
  for (const [re, type] of WEAPON_TYPE_RULES) if (re.test(name || '')) return type;
  return null;
}
const WEAPON_TYPE_LABEL = { twinBlades: '双剑', blade: '刀', scabbard: '剑鞘', hammer: '巨锤',
  shield: '盾', staff: '法杖', chainMace: '链锤', suitcase: '提箱', pistol: '手枪', vector: '冲锋枪' };
/** ★ 武器**名字**的精确覆盖（按名字 → 类型 / 显示名）—— 比通用规则优先 */
const WEAPON_NAME_TYPE  = { leek: 'hammer', negi: 'hammer' };        // 初音的葱 → **锤类**
const WEAPON_NAME_LABEL = { leek: '葱', negi: '葱' };
/** ★ 大类：**单手 / 双手**（默认单手；原作里目前只有拉普兰德的**双剑**是双手） */
const WEAPON_HANDS = { twinBlades: 2 };
export const weaponHands = (type) => WEAPON_HANDS[type] || 1;

/* ==========================================================================
 *  ★ 武器**种类**（大类）—— 挂载数之外的第二种划分。
 *    挂载数：单手 / 双手（WEAPON_HANDS / def.hands）
 *    种类  ：刀 blade / 锤 hammer / 枪 gun / 炮 cannon / 盾 shield / 杖 staff / 链 chain / 箱 case
 * ========================================================================== */
export const WEAPON_CATEGORIES = ['blade', 'hammer', 'gun', 'cannon', 'shield', 'staff', 'chain', 'case'];
export const WEAPON_CATEGORY_LABEL = { blade: '刀类', hammer: '锤类', gun: '枪类', cannon: '炮类',
  shield: '盾类', staff: '杖类', chain: '链类', case: '箱类' };
/** 类型 / 名字 → 种类 */
const WEAPON_CATEGORY = {
  twinBlades: 'blade', blade: 'blade', scabbard: 'blade',
  hammer: 'hammer', leek: 'hammer',
  shield: 'shield', staff: 'staff', chainMace: 'chain', suitcase: 'case',
  pistol: 'gun', vector: 'gun',
  rockCannon: 'cannon',
};
/** 取一个武器（**定义对象** 或 **类型字符串**）的种类 */
export function weaponCategory(x) {
  if (!x) return null;
  if (typeof x === 'string') return WEAPON_CATEGORY[x] || null;
  return x.category || WEAPON_CATEGORY[x.type] || WEAPON_CATEGORY[x.id] || null;
}
/** ★ 种类 → **默认动作模板**：新武器按种类**复用同类型**的那套招（之后还能手调）。
 *  值 = `ATTACKS` 里的 key（见 moves.js）。 */
export const KIND_MOVES = {
  blade:  ['horizontalSlash', 'verticalSlash'],
  hammer: ['hammer'],
  gun:    ['rapidFire'],
  cannon: ['rapidFire'],
  shield: ['shield'],
  staff:  ['staff'],
  chain:  ['chainMace'],
  case:   ['suitcase'],
};
/** 取某种类的默认动作模板（副本） */
export function weaponKindMoves(kind) { return (KIND_MOVES[kind] || ['horizontalSlash']).slice(); }
/** 一个武器的「挂载数 + 种类」摘要（UI / 调试用） */
export function describeWeapon(x) {
  const type = typeof x === 'string' ? x : (x.type || x.id);
  const cat = weaponCategory(x);
  return { type, mount: (typeof x === 'object' && x.hands) || weaponHands(type),
           category: cat, categoryLabel: cat ? WEAPON_CATEGORY_LABEL[cat] : null,
           mountLabel: (((typeof x === 'object' && x.hands) || weaponHands(type)) === 2) ? '双手' : '单手' };
}
/** 角色 → 兜底武器类型（`weapons[]` 里的对象**没有名字**时用） */
const WEAPON_TYPE_BY_CHAR = { lappland: 'twinBlades', texas: 'blade', exusiai: 'vector', emperor: 'pistol' };
/** 从模型里分割出它自己的武器：返回 [{ name, label, object, type, hands }] */
export function extractNativeWeapons(model) {
  const found = [];
  const cid = (model.spec && model.spec.id) || '';
  const SKIP = /bag|waist|tassel/i;                 // 背袋 / 腰链流苏都是服装，不是武器
  const add = (o) => {
    if (!o || !o.isObject3D) return;
    let nm = o.name || '';
    if (SKIP.test(nm)) return;
    if (found.some((f) => f.object === o)) return;
    /* 组名认不出类型时（如移植后的 `weapon0`），往下找一个**有名字的网格**来定类型 / 显示名 */
    if (!weaponTypeOf(nm) && !WEAPON_NAME_TYPE[nm]) {
      let inner = null;
      o.traverse((c) => { if (!inner && c.isMesh && c.name && WEAPON_NAME_RE.test(c.name) && !SKIP.test(c.name)) inner = c; });
      if (inner) nm = inner.name;
    }
    const type = WEAPON_NAME_TYPE[nm] || weaponTypeOf(nm) || WEAPON_TYPE_BY_CHAR[cid] || null;
    found.push({ name: nm || (cid + '-weapon'),
                 label: WEAPON_NAME_LABEL[nm] || WEAPON_TYPE_LABEL[type] || nm || '武器',
                 object: o, type, hands: weaponHands(type) });
  };
  for (const o of [...(model.weapons || []), ...(model.staffs || [])]) add(o);   // ① 原作明确的武器数组
  /* ② 名字像武器的对象（网格**或组**，如初音的 `leek` 组）—— 命中就整棵子树算一件，不再下钻 */
  (function walk(o) {
    if (o !== model.root && o.name && WEAPON_NAME_RE.test(o.name)) { add(o); return; }
    for (const c of o.children) walk(c);
  })(model.root);
  return found;
}

/** ★ 每个原作角色装什么（`arm: 0` = 右手；成对武器 `slots:2` 默认占双手） */
export const LOADOUTS = {
  lappland: [{ id: 'twinBlades' }],
  texas: [{ id: 'blade', arm: 0 }],
  exusiai: [{ id: 'vector', arm: 0 }],
  croissant: [{ id: 'hammer', arm: 1 }],
  chen: [{ id: 'scabbard', arm: 0 }],
  hoshiguma: [{ id: 'shield', arm: 0 }],
  swire: [{ id: 'chainMace', arm: 0 }, { id: 'chainCoil' }],
  mostima: [{ id: 'staff', arm: 0 }, { id: 'staff', arm: 1 }],
  emperor: [{ id: 'suitcase', arm: 1 }, { id: 'pistol', arm: 0 }],
  hung: [{ id: 'lcShield', arm: 1 }],
};

/* 黑岩：炮按它自己的 `hand: 0`（左手那侧）+ 黑刃右手 */
export const LOADOUT = [{ id: 'rockCannon', arm: 0 }, { id: 'blackBlade', arm: 1 }];

