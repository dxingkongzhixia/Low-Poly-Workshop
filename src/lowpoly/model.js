/**
 * lowpoly/model.js —— **人物模型**层：骨架常量 + 图元（Builder）+ 脸 + 角色本体构造器。
 * 只依赖 three；不碰武器池、不碰动作绑定。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/* ================================================== 骨架常量（和原作完全一致） */
export const SKIN = 16243144, DARK = 2107185, LIGHT = 15527140;
export const QE = 1.12 * .9, JE = .85;
export const HEAD_SCALE = [1.52 * 1.1, 1.4 * 1.1, 1.38 * 1.1];
export const HEAD_Y = 1.47, BODY_Y = -.73 * (1 - JE);
export const CH = { HEIGHT: 1.55 };
const BLUSH = 0xefb3bc, MOUTH = 0xb24a52;


/* ============================================== 图元 —— 顶点色 + Builder（= 原作 Q） */
function vcolor(geo, hex) {
  const n = geo.getAttribute('normal');
  const c = new THREE.Color(hex);
  const a = new Float32Array(geo.getAttribute('position').count * 3);
  for (let i = 0; i < a.length; i += 3) {
    const t = .92 + .08 * Math.max(0, n.getY(i / 3));
    a[i] = c.r * t; a[i + 1] = c.g * t; a[i + 2] = c.b * t;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
export class Builder {
  constructor() { this.geometries = []; }
  add(geo, color) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    this.geometries.push(vcolor(g, color));
    return this;
  }
  box(x, y, z, w, h, d, color, rotZ = 0) {
    const c = Math.min(w, h, d);
    const g = c > .12
      ? new RoundedBoxGeometry(w, h, d, 1, Math.min(.075, c * .22))
      : new THREE.BoxGeometry(w, h, d);
    if (rotZ) g.rotateZ(rotZ);
    g.translate(x, y, z);
    return this.add(g, color);
  }
  shape(points, z, depth, color, ox = 0, oy = 0, rotX = 0, rotY = 0) {
    const s = new THREE.Shape();
    points.forEach((p, i) => (i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])));
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, steps: 1, curveSegments: 1 });
    g.translate(0, 0, -depth / 2);
    if (rotX) g.rotateX(rotX);
    if (rotY) g.rotateY(rotY);
    g.translate(ox, oy, z);
    return this.add(g, color);
  }
  /** 轮廓挤出（`z = 0` 的简写）—— 刀身 / 刺刀都用它 */
  shapeX(points, depth, color, ox = 0, oy = 0, rotX = 0, rotY = 0) {
    return this.shape(points, 0, depth, color, ox, oy, rotX, rotY);
  }
  /** 低多边形圆环（柄环 / 杖环）—— 原版武器注册表要用 */
  torus(r, tube, color, rotX = 0, rotY = 0, rotZ = 0, ox = 0, oy = 0, oz = 0) {
    const g = new THREE.TorusGeometry(r, tube, 6, 16);
    if (rotX) g.rotateX(rotX);
    if (rotY) g.rotateY(rotY);
    if (rotZ) g.rotateZ(rotZ);
    g.translate(ox, oy, oz);
    return this.add(g, color);
  }
  build(parent, mat = null) {
    if (!this.geometries.length) return null;
    const counts = this.geometries.map((g) => g.getAttribute('position').count);
    const merged = mergeGeometries(this.geometries, false);
    this.geometries.forEach((g) => g.dispose());
    this.geometries = [];
    if (!merged) return null;
    /* ★ 与原作 `Q.build` 对齐：记录每个原始图元占多少顶点 —— 部件编辑器靠它**精确拆分**（不是包围盒近似） */
    merged.userData.primitiveVertexCounts = counts;
    const mesh = new THREE.Mesh(merged, mat || new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: .69, metalness: .05,
    }));
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
}
export function addCyl(b, rTop, rBot, h, y, color, seg = 8, open = false, theta = Math.PI / 8) {
  /* 不再手动 toNonIndexed —— `Builder.add` 本来就会转；保留 index 才能让「武器编辑器拆解」认出它是
     CylinderGeometry（toNonIndexed 之后会变成普通 BufferGeometry、`parameters` 丢失）。几何结果不变。 */
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open, theta);
  g.computeVertexNormals();
  g.translate(0, y, 0);
  return b.add(g, color);
}
export function segPts(a, b, wa, wb) {
  const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1;
  const px = -dy / n, py = dx / n;
  return [
    [a[0] + px * wa / 2, a[1] + py * wa / 2],
    [b[0] + px * wb / 2, b[1] + py * wb / 2],
    [b[0] - px * wb / 2, b[1] - py * wb / 2],
    [a[0] - px * wa / 2, a[1] - py * wa / 2],
  ];
}
export function squareLoop(b, cx, cy, cz, w, h, bar, thick, color, lean = 0, axis = 'z') {
  const sl = Math.sin(lean), cl = Math.cos(lean);
  const edge = (du, dv, uw, vw) => {
    if (axis === 'x') return b.box(cx - dv * sl, cy + dv * cl, cz + du, thick, vw, uw, color, lean);
    return b.box(cx + du * cl - dv * sl, cy + du * sl + dv * cl, cz, uw, vw, thick, color, lean);
  };
  edge(0, h / 2 - bar / 2, w, bar);
  edge(0, -h / 2 + bar / 2, w, bar);
  edge(-w / 2 + bar / 2, 0, bar, h - 2 * bar);
  edge(w / 2 - bar / 2, 0, bar, h - 2 * bar);
  return b;
}
/** 五角星：角度从 +π/2 起 → 一个角朝上（正着的） */
export function starPts(cx, cy, r, ir) {
  const p = [];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? ir : r;
    p.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return p;
}
export function roundPoly(P, ch = .020) {
  const dir = (a, b) => { const d = [b[0] - a[0], b[1] - a[1]], n = Math.hypot(d[0], d[1]); return [d[0] / n, d[1] / n]; };
  const off = (p, d, k) => [p[0] + d[0] * k, p[1] + d[1] * k];
  const N = P.length, out = [];
  for (let i = 0; i < N; i++) {
    const prev = P[(i - 1 + N) % N], p = P[i], next = P[(i + 1) % N];
    out.push(off(p, dir(p, prev), ch));
    out.push(off(p, dir(p, next), ch));
  }
  return out;
}

/* ======================================================== 脸 — 96×80 手绘贴图 */
const EYE_RIM = 1579298, EYE_WHITE = 16052973, LASH_PINK = 14459052, EYE_SPARK = 16775656;
const CLOSED_LID = 2827312, CLOSED_LINE = 10841210;
export function paintFace(closed, spec, serious = false) {
  const W = 96, H = 80;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const P = (x, y, w, h, col) => {
    g.fillStyle = '#' + (col >>> 0).toString(16).padStart(6, '0');
    g.fillRect(x, y, w, h);
  };
  P(0, 0, W, H, spec.skin);
  P(5, 52, 12, 4, BLUSH);
  P(79, 52, 12, 4, BLUSH);
  const c = spec.eyes;
  const LASH = spec.lash ?? LASH_PINK;
  for (let eye = 0; eye < 2; eye++) {
    const a = eye === 0 ? 7 : 56;
    const r = (e) => Math.round(33 + (e - 33) * 1.05);
    const L = (x, y, w, h, col) => {
      const lx = r(x), ux = r(x + w);
      P(a + (eye === 0 ? lx : 33 - ux), y, ux - lx, h, col);
    };
    if (closed) { L(2, 36, 29, 4, CLOSED_LID); L(7, 40, 20, 2, CLOSED_LINE); continue; }
    if (serious) {
      L(3, 28, 29, 20, EYE_WHITE);
      L(6, 50, 23, 3, EYE_WHITE);
      L(11, 30, 17, 18, c[1]);
      L(11, 30, 17, 9, c[0]);
      L(15, 34, 10, 11, c[0]);
      L(12, 45, 15, 4, c[1]);
      L(14, 47, 11, 3, c[2]);
      L(0, 23, 10, 5, EYE_RIM);
      L(10, 25, 11, 6, EYE_RIM);
      L(21, 26, 12, 7, EYE_RIM);
      L(0, 30, 4, 15, EYE_RIM); L(4, 48, 4, 4, EYE_RIM);
      L(2, 23, 9, 2, LASH); L(12, 26, 10, 2, LASH);
      continue;
    }
    L(4, 21, 23, 5, EYE_RIM); L(0, 26, 33, 5, EYE_RIM);
    L(0, 30, 4, 17, EYE_RIM); L(4, 49, 4, 4, EYE_RIM);
    L(2, 24, 29, 3, LASH);
    L(3, 27, 29, 24, EYE_WHITE);
    L(6, 51, 23, 3, EYE_WHITE);
    L(11, 27, 17, 23, c[1]);
    L(11, 27, 17, 10, c[0]);
    L(15, 32, 10, 13, c[0]);
    L(12, 45, 15, 5, c[1]);
    L(14, 48, 11, 4, c[2]); L(14, 50, 11, 4, c[2]);
    P(a + (eye === 0 ? r(11) : 33 - r(28)) + 1, 32, 4, 5, EYE_SPARK);
  }
  const mouthCol = spec.mouth ?? MOUTH;
  if (spec.flatMouth) { P(42, 63, 11, 3, mouthCol); }
  else { P(42, 63, 12, 3, mouthCol); P(45, 66, 6, 1, mouthCol); }
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export function buildFace(headBone, spec) {
  const open = paintFace(false, spec), closed = paintFace(true, spec);
  const openS = spec.serious ? paintFace(false, spec, true) : null;
  const closedS = spec.serious ? paintFace(true, spec, true) : null;
  const faceMat = new THREE.MeshStandardMaterial({ map: open, roughness: .92, metalness: 0 });
  const skinMat = new THREE.MeshStandardMaterial({ color: spec.skin, roughness: .92, metalness: 0 });
  const backMat = new THREE.MeshStandardMaterial({ color: 0x2a2226, roughness: .95, metalness: 0 });
  const geo = new RoundedBoxGeometry(.61, .5, .47, 4, .095);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = THREE.MathUtils.smoothstep(-y, 0.015, 0.25);
    x *= 1 - .38 * a; y -= .035 * a; z -= .035 * a;
    const t = Math.max(0, -y - .205);
    p.setXYZ(i, x, y + t * .62, z - t * .5);
  }
  p.needsUpdate = true; geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, [skinMat, skinMat, skinMat, skinMat, faceMat, backMat]);
  mesh.name = 'base-head';        // ★ 便于工具按名字识别「头/脸」（部件编辑器据此排除它，再单独重建贴图脸）
  mesh.position.y = .035;
  mesh.castShadow = mesh.receiveShadow = true;
  headBone.add(mesh);
  return { mesh, faceMat, open, closed, openS, closedS };
}
function buildHair(head, t, fr) {
  const m = new Builder();
  m.box(0, .30, -.055, .71, .29, .59, t.hair)
   .box(0, .07, -.24, .69, .49, .20, t.shade)
   .box(-.32, .06, 0, .13, .41, .43, t.hair)
   .box(.32, .06, 0, .13, .41, .43, t.hair);
  const FR = [.30, .24, .18, .28, .33];
  for (let n = -2; n <= 2; n++) {
    const r = n * .115, len = FR[n + 2];
    m.shape([[r - .092, .37], [r + .086, .34], [r + .073, .23],
             [r + (n < 0 ? -.04 : .04), .34 - len], [r - .083, .20]],
            .272 + (n + 2) * .003, .045, fr);
  }
  for (const n of [-1, 1])
    m.shape([[n * .25, .16], [n * .35, .21], [n * .39, -.13], [n * .46, -.2], [n * .29, -.16]], -.04, .3, t.hair);
  m.build(head);
  return m;
}
function buildBackHair(head, t) {
  const hair = new THREE.Group(); hair.name = 'back-hair';
  hair.position.y = .16; head.add(hair);
  const v = new Builder();
  for (let i = -2; i <= 2; i++) {
    const n = i * .12;
    v.shape([[n - .12, .17], [n + .1, .12], [n + .14, -.22],
             [n + (i < 0 ? -.1 : .12), -.34 + Math.abs(i) * .02], [n - .08, -.26]],
            -.35 - (i + 2) * .009, .045, i % 2 ? t.hair : t.shade);
  }
  v.build(hair);
  return hair;
}
function buildTails(head, t, sides, opts = {}) {
  const tails = new THREE.Group(); tails.name = 'twintails'; head.add(tails);
  const z = opts.z ?? -.30, dep = opts.depth ?? .17;
  function rebuild() {
    tails.clear();
    for (const { s, nodes, tie } of sides) {
      const b = new Builder();
      for (let i = 0; i < nodes.length - 1; i++)
        b.shape(segPts([s * nodes[i][0], nodes[i][1]], [s * nodes[i + 1][0], nodes[i + 1][1]],
                       nodes[i][2], nodes[i + 1][2]), z, dep, t.hair);
      const last = nodes[nodes.length - 1];
      b.shape(segPts([s * last[0], last[1]], [s * (last[0] - .02), last[1] - .18], last[2], .012),
              z, dep * .7, t.hair);
      b.shape(segPts([s * .33, .26], [s * .48, last[1] + .10], .038, .012),
              z + dep * .52, .016, t.hairHi);
      b.box(s * .32, .30, z, .17, .17, dep * 1.15, tie ?? t.hphone ?? t.coat2);
      b.build(tails);
    }
    tails.updateMatrixWorld(true);
  }
  rebuild();
  return { group: tails, rebuild };
}
function buildBrsTails(head, t) {
  const tails = new THREE.Group(); tails.name = 'twintails'; head.add(tails);
  const z = -.30, dep = .16;
  const PATHS = [
    [[.27, .30, .132], [.38, .49, .120], [.51, .35, .108], [.56, -.04, .092], [.53, -.37, .074], [.49, -.60, .046], [.46, -.74, .012]],
    [[.29, .33, .106], [.42, .51, .096], [.55, .34, .084], [.58, -.07, .068], [.55, -.39, .052], [.51, -.62, .015]],
    [[.24, .30, .088], [.34, .43, .079], [.44, .32, .070], [.49, -.08, .058], [.46, -.35, .042], [.43, -.54, .012]],
    [[.30, .32, .078], [.44, .41, .071], [.56, .08, .062], [.55, -.25, .046], [.51, -.46, .013]],
  ];
  const RX = .27, RY = .30;
  function rebuild() {
    tails.clear();
    for (const s of [-1, 1]) {
      const k = s < 0 ? 0.80 : 1.0;
      const map = ([x, y, w]) => [s * (RX + (x - RX) * k), RY + (y - RY) * k, w * k];
      const b = new Builder();
      const fill = t.tail ?? t.hair;
      for (const pts of PATHS)
        for (let i = 0; i < pts.length - 1; i++) {
          const a = map(pts[i]), c = map(pts[i + 1]);
          b.shape(segPts([a[0], a[1]], [c[0], c[1]], a[2], c[2]), z, dep, fill);
        }
      const s0 = map([.30, .42, .034]), s1 = map([.56, -.52, .012]);
      b.shape(segPts([s0[0], s0[1]], [s1[0], s1[1]], s0[2], s1[2]), z + dep * .52, .016, t.hairHi);
      b.box(s * RX, RY + .01, z, .14 * k, .14 * k, dep * 1.15, t.coat2);
      b.build(tails);
    }
    tails.updateMatrixWorld(true);
  }
  rebuild();
  return tails;
}

/* ============================================================= 初音未来本体 */
export function buildMiku(t) {
  const u = t.skin;
  const root = new THREE.Group(); root.name = 'root'; root.scale.setScalar(QE);
  const body = new THREE.Group(); body.name = 'body'; body.position.y = BODY_Y; root.add(body);
  new Builder()
    .box(0, 1.06, 0, .50, .55, .32, t.shirt)
    .box(0, 1.335, .02, .44, .10, .29, t.shirtB)
    .box(0, 1.30, .165, .085, .075, .05, t.tie)
    .shape([[-.052, 1.275], [.052, 1.275], [.058, 1.12], [0, .995], [-.058, 1.12]], .172, .045, t.tie)
    .box(0, .80, .19, .16, .075, .05, t.trim)
    .build(body);
  {
    const skirt = new THREE.Group(); skirt.position.y = .775; body.add(skirt);
    const b = new Builder();
    addCyl(b, .245, .335, .17, 0, t.boot, 8, false);
    addCyl(b, .338, .338, .030, -.075, t.trim, 8, true);
    b.build(skirt);
  }
  const legs = [], knees = [];
  for (const n of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(n * .16, .73, 0); leg.scale.y = JE;
    body.add(leg); legs.push(leg);
    const knee = new THREE.Group(); knee.position.y = -.3; leg.add(knee); knees.push(knee);
    new Builder()
      .box(0, -.02, 0, .185, .32, .215, u)
      .box(0, -.175, 0, .198, .045, .232, t.trim)
      .box(0, -.28, 0, .195, .24, .225, t.boot)
      .build(leg);
    new Builder()
      .box(0, 0, 0, .182, .26, .210, t.boot)
      .box(0, -.15, .015, .22, .30, .25, t.boot)
      .box(0, -.33, .08, .29, .17, .40, t.boot2)
      .box(0, -.425, .08, .30, .04, .41, t.sole)
      .box(n * .112, -.20, .10, .022, .14, .05, t.trim)
      .build(knee);
  }
  const arms = [];
  for (const n of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(n * .36, 1.3 - .545 * .15, 0);
    body.add(arm); arms.push(arm);
    new Builder()
      .box(0, -.15, 0, .21, .30, .25, u)
      .box(0, -.385, .02, .188, .21, .215, t.boot)
      .box(0, -.285, .02, .194, .028, .222, t.trim)
      .box(0, -.545, .03, .15, .13, .18, u)
      .build(arm);
  }
  const head = new THREE.Group(); head.name = 'head';
  head.position.y = HEAD_Y; head.scale.set(...HEAD_SCALE); body.add(head);
  const hm = buildHair(head, t, t.hair);
  hm.box(-.13, .379, .13, .23, .035, .14, t.hairHi, -.13)
    .box(0, .452, -.05, .56, .042, .20, t.hphone)
    .box(-.40, .06, 0, .10, .20, .22, t.hphone)
    .box(.40, .06, 0, .10, .20, .22, t.hphone)
    .box(-.462, .06, 0, .018, .12, .12, t.trim)
    .box(.462, .06, 0, .018, .12, .12, t.trim)
    .build(head);
  const antennae = new THREE.Group(); antennae.name = 'antennae'; head.add(antennae);
  {
    const ab = new Builder();
    squareLoop(ab, .30, .49, -.24, .17, .25, .031, .062, t.acc, -.14, 'x');
    squareLoop(ab, -.30, .49, -.24, .17, .25, .031, .062, t.acc, .14, 'x');
    ab.build(antennae);
  }
  const hair = buildBackHair(head, t);
  const { group: tails } = buildTails(head, t, [
    { s: -1, nodes: [[.32, .30, .150], [.47, .34, .135], [.51, .06, .120], [.49, -.26, .095], [.46, -.56, .060]] },
    { s: 1, nodes: [[.32, .30, .150], [.47, .34, .135], [.51, .06, .120], [.49, -.26, .095], [.46, -.56, .060]] },
  ], { z: -.30, depth: .17 });
  const face = buildFace(head, t);
  const leek = new THREE.Group(); leek.name = 'leek';
  leek.position.set(0, -.54, .08); leek.rotation.set(.95, 0, .15);
  leek.scale.setScalar(1.3);
  arms[0].add(leek);
  {
    const b = new Builder();
    addCyl(b, .048, .058, .34, .17, 0xf2f5ec, 8, false);
    const LEAF = 0x63b34a, LEAF2 = 0x82cf62;
    b.shape([[0, .32], [.09, .62], [.035, .78], [0, .70], [-.035, .78], [-.09, .62]], 0, .08, LEAF);
    b.shape([[0, .32], [.07, .58], [-.005, .72], [0, .60]], -.055, .055, LEAF2);
    b.shape([[0, .32], [-.07, .58], [.005, .72], [0, .60]], .055, .055, LEAF2);
    b.build(leek);
  }
  return { root, body, head, arms, legs, knees, hair, tails, face, leek, antennae, props: { leek }, detach: [antennae] };
}

/* =============================================== 黑岩射手本体（TV 版） */
export function buildBRS(t) {
  const u = t.skin;
  const root = new THREE.Group(); root.name = 'root'; root.scale.setScalar(QE);
  const body = new THREE.Group(); body.name = 'body'; body.position.y = BODY_Y; root.add(body);
  new Builder()
    .box(0, 1.08, 0, .510, .560, .330, t.coat)
    .box(0, 1.335, .020, .440, .140, .310, t.coatB)
    .box(0, 1.318, .150, .105, .052, .022, DARK)
    .box(0, 1.318, .162, .070, .030, .012, 0x9aa3ad)
    .build(body);
  {
    const front = new Builder();
    front.shape([[-.175, 1.340], [.175, 1.340], [.205, .800], [-.205, .800]], .158, .024, u);
    for (const s of [-1, 1])
      front.shape([[s * .175, 1.340], [s * .153, 1.340], [s * .183, .800], [s * .205, .800]], .180, .026, t.trim);
    front.shape(starPts(.220, 1.060, .030, .0126), .172, .012, t.star);
    front.build(body);
  }
  new Builder()
    .shape(roundPoly([[-.140, 1.160], [-.005, 1.020], [-.205, 1.020]], .034), .186, .080, 0x1c2027)
    .shape(roundPoly([[.140, 1.160], [.005, 1.020], [.205, 1.020]], .034), .186, .080, 0x1c2027)
    .box(0, 1.035, .206, .070, .015, .042, 0xffffff)
    .build(body);
  new Builder()
    .box(0, .712, 0, .510, .104, .350, t.coat)
    .box(0, .666, .176, .505, .014, .012, t.coatB)
    .box(0, .712, .178, .012, .104, .010, t.coatB)
    .box(0, .786, .029, .520, .058, .330, t.belt, .20)
    .box(0, .792, .023, .545, .076, .350, DARK, -.09)
    .box(.0017, .8109, .200, .545, .013, .012, t.trim, -.09)
    .box(-.0017, .7731, .200, .545, .013, .012, t.trim, -.09)
    .box(.020, .790, .205, .112, .084, .022, DARK, -.09)
    .box(.020, .790, .217, .086, .058, .012, 0x9aa3ad, -.09)
    .box(.020, .790, .224, .056, .032, .010, DARK, -.09)
    .box(0, .872, .181, .020, .036, .010, 0xa8806e)
    .build(body);
  const legs = [], knees = [];
  for (const n of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(n * .16, .73, 0); leg.scale.y = JE;
    body.add(leg); legs.push(leg);
    new Builder().box(0, -.13, 0, .175, .30, .205, u).build(leg);
    const knee = new THREE.Group(); knee.position.y = -.3; leg.add(knee); knees.push(knee);
    const mb = new Builder();
    mb.box(0, -.020, 0, .250, .092, .284, t.boot)
      .box(0, -.214, .009, .232, .314, .262, t.boot)
      .box(0, -.400, .050, .248, .085, .320, t.boot)
      .box(0, -.480, .072, .292, .098, .420, t.boot)
      .box(0, -.544, .072, .302, .030, .432, t.trim);
    const WING_PITCH = -0.30, WING_YAW = 0.45;
    for (const s of [-1, 1]) {
      const cx = s * .082;
      mb.shape([[-.062, .008], [.062, .008], [0, -.148]], .120, .018, t.trim, cx, -.038, WING_PITCH, s * WING_YAW)
        .shape([[-.055, .015], [.055, .015], [0, -.124]], .126, .020, t.boot, cx, -.038, WING_PITCH, s * WING_YAW);
    }
    mb.box(0, -.100, .139, .016, .055, .020, t.trim)
      .box(-.020, -.012, .148, .016, .042, .018, t.trim)
      .box(.020, -.012, .148, .016, .042, .018, t.trim)
      .box(n * -.124, -.255, .012, .024, .200, .125, t.bootGrey)
      .box(n * .124, -.255, .012, .024, .200, .125, t.bootGrey)
      .box(n * -.138, -.255, .012, .012, .200, .050, t.trim)
      .box(n * .138, -.255, .012, .012, .200, .050, t.trim)
      .box(0, -.455, .276, .150, .052, .020, t.trim);
    mb.build(knee);
  }
  const arms = [];
  for (const n of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(n * .36, 1.30, 0);
    body.add(arm); arms.push(arm);
    new Builder()
      .box(0, -.15, 0, .22, .30, .26, t.coatB)
      .box(0, -.32, .02, .18, .18, .21, t.coatB)
      .box(0, -.075, 0, .226, .154, .266, t.coat)
      .box(n * .109, -.260, .058, .018, .216, .016, t.trim)
      .box(n * .109, -.260, -.008, .018, .216, .016, t.trim)
      .box(0, -.415, .035, .20, .085, .23, DARK)
      .box(0, -.412, .035, .205, .016, .235, t.trim)
      .build(arm);
    new Builder().box(0, -.485, .04, .15, .13, .18, u).build(arm);
  }
  const head = new THREE.Group(); head.name = 'head';
  head.position.y = HEAD_Y; head.scale.set(...HEAD_SCALE); body.add(head);
  const m = new Builder();
  m.box(0, .32, -.055, .71, .25, .59, t.hair)
   .box(0, .07, -.24, .69, .49, .20, t.shade)
   .box(-.32, .06, 0, .13, .41, .43, t.hair)
   .box(.32, .06, 0, .13, .41, .43, t.hair);
  const FR = [.13, .15, .19, .15, .13];
  for (let n = -2; n <= 2; n++) {
    const r = n * .115, len = FR[n + 2];
    m.shape([[r - .092, .37], [r + .086, .34], [r + .073, .23],
             [r + (n < 0 ? -.04 : .04), .34 - len], [r - .083, .20]],
            .276 + (n + 2) * .004, .050, t.fringe);
  }
  for (const n of [-1, 1])
    m.shape([[n * .25, .16], [n * .35, .21], [n * .39, -.13], [n * .46, -.2], [n * .29, -.16]], -.04, .3, t.hair);
  m.box(-.37, .31, .10, .075, .20, .07, 0x3fa8dc, -.50)
   .box(-.46, .22, .05, .07, .16, .07, 0x3fa8dc, -.50)
   .box(0, .452, -.05, .56, .042, .20, t.coat2)
   .build(head);
  const hair = buildBackHair(head, t);
  const flame = new THREE.Group(); flame.name = 'eye-flame';
  flame.position.set(.15, .02, .345); head.add(flame);
  {
    const FL = t.flame;
    const fp = (s, k) => [[-.030, -.035], [.045, -.035], [.098, .075], [.048, .140],
                          [.130, .230], [.066, .310], [.018, .212], [-.018, .118]].map(([x, y]) => [s * x * k, y * k]);
    const fb = new Builder();
    for (const [k, z, col] of [[1.00, .000, FL.outer], [.78, .014, FL.mid], [.50, .028, FL.core]])
      fb.shape(fp(1, k), z, .012, col);
    fb.shape([[.052, 0], [0, .058], [-.052, 0], [0, -.058]], .038, .012, FL.core, .022, .010);
    const fm = fb.build(flame, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: .95, depthWrite: false }));
    fm.renderOrder = 3;
  }
  flame.userData.baseScale = 1.0;
  const tails = buildBrsTails(head, t);
  const face = buildFace(head, t);
  const cape = new THREE.Group(); cape.name = 'cape'; cape.position.set(0, 1.34, -.18); body.add(cape);
  {
    const b = new Builder();
    b.shape([[-.30, .04], [.30, .04], [.50, -1.16], [.34, -1.10], [-.34, -1.10], [-.50, -1.16]], 0, .15, t.cloak);
    b.shape([[-.27, .02], [.27, .02], [.45, -1.08], [-.45, -1.08]], .081, .015, t.cloakHi);
    b.shape([[-.028, -1.10], [.028, -1.10], [.024, -.04], [-.024, -.04]], .080, .02, t.cloakHi);
    b.shape([[-.21, .03], [.21, .03], [.17, .30], [-.17, .30]], 0, .22, t.cloak);
    b.shape(starPts(0, -.30, .125, .052), -.088, .03, t.star);
    b.build(cape);
  }
  return {
    root, body, head, arms, legs, knees, hair, tails, face, cape, flame,
    detach: [tails],
  };
}

/** 量出自然高度再缩放到 target（高过头顶的配件先 detach） */
export function normaliseHeight(root, target, detachList = []) {
  const parents = detachList.map((d) => d.parent);
  detachList.forEach((d) => d.parent && d.parent.remove(d));
  root.scale.setScalar(1);
  root.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  detachList.forEach((d, i) => parents[i] && parents[i].add(d));
  root.scale.setScalar(target / size.y);
  root.updateMatrixWorld(true);
  return size.y;
}
