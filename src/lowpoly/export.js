/**
 * lowpoly/export.js —— 导出成工坊 **spec** / **model.js 工厂** + partBoxes。
 */
import * as THREE from 'three';
import { Builder, DARK, BODY_Y, HEAD_Y, HEAD_SCALE, QE, JE } from './model.js';
import { CHARACTERS } from './character.js';

/* ==========================================================================
 *  ★ 导出成低模工坊的 spec / model.js
 *  做法：临时给 Builder 打补丁，把每次 box/shape 记下来；
 *        build() 时按「网格挂在哪个组」分部件，再把坐标换算到工坊的父级组空间。
 * ========================================================================== */
const CAP = { on: false, samples: [] };
const _b0 = Builder.prototype.box, _s0 = Builder.prototype.shape, _d0 = Builder.prototype.build;
Builder.prototype.box = function (x, y, z, w, h, d, color, rotZ = 0) {
  if (CAP.on) (this._rec || (this._rec = [])).push({ kind: 'box', x, y, z, w, h, d, color, rotZ });
  return _b0.call(this, x, y, z, w, h, d, color, rotZ);
};
Builder.prototype.shape = function (points, z, depth, color, ox = 0, oy = 0, rotX = 0, rotY = 0) {
  if (CAP.on) (this._rec || (this._rec = [])).push({ kind: 'panel', points, z, depth, color, ox, oy, rotX, rotY });
  return _s0.call(this, points, z, depth, color, ox, oy, rotX, rotY);
};
Builder.prototype.build = function (parent, mat = null) {
  if (CAP.on && this._rec) { CAP.samples.push({ parent, prims: this._rec }); this._rec = null; }
  return _d0.call(this, parent, mat);
};

/** 把我们的骨骼组映射到工坊的父级键 */
function boneMap(proto) {
  const m = new Map();
  m.set(proto.body, 'body');
  m.set(proto.head, 'head');
  if (proto.arms) { m.set(proto.arms[0], 'armL'); m.set(proto.arms[1], 'armR'); }
  if (proto.legs) { m.set(proto.legs[0], 'legL'); m.set(proto.legs[1], 'legR'); }
  if (proto.knees) { m.set(proto.knees[0], 'legL'); m.set(proto.knees[1], 'legR'); }
  if (proto.cape) m.set(proto.cape, 'coatTails');
  return m;
}
const _v = new THREE.Vector3();
/** 工坊的父级键 → 中文名（L/R 结尾的会被 chiralityGate 认成镜像对） */
const LR_LABEL = { body: '躯干', head: '头部', armL: '手臂 L', armR: '手臂 R',
                   legL: '腿 L', legR: '腿 R', coatTails: '后摆', tail: '尾巴' };
const CATEGORY = { body: '基础身体', head: '头发', armL: '基础手臂（含手）', armR: '基础手臂（含手）',
                   legL: '基础腿部', legR: '基础腿部', coatTails: '服装装饰', tail: '尾巴' };
export function exportSpec(id) {
  const spec = CHARACTERS[id]; if (!spec) return null;
  CAP.on = true; CAP.samples = [];
  const proto = spec.build(spec);
  proto.root.updateMatrixWorld(true);
  CAP.on = false;
  const map = boneMap(proto);
  const keyGroup = {};
  for (const [g, k] of map) if (!keyGroup[k]) keyGroup[k] = g;

  const parts = [];
  const partIds = {};
  for (const sample of CAP.samples) {
    /* 找到这个网格所在组对应的工坊父级键（沿父链找最近的映射组） */
    let g = sample.parent, key = 'body', src = proto.body;
    while (g) { if (map.has(g)) { key = map.get(g); src = g; break; } g = g.parent; }
    const dst = keyGroup[key] || proto.body;
    const M = new THREE.Matrix4().copy(dst.matrixWorld).invert().multiply(src.matrixWorld);
    const prims = sample.prims.map((pr) => {
      const c = pr.color, base = { color: c };
      if (pr.kind === 'box') {
        _v.set(pr.x, pr.y, pr.z).applyMatrix4(M);
        return { kind: 'box', x: _v.x, y: _v.y, z: _v.z, w: pr.w, h: pr.h, d: pr.d, color: c,
                 rotX: 0, rotY: 0, rotZ: pr.rotZ };
      }
      // panel / 带 rotX/rotY 的挤出片
      _v.set(pr.ox, pr.oy, pr.z).applyMatrix4(M);
      const pts = pr.points.map((p) => { const q = new THREE.Vector3(p[0], p[1], 0).applyMatrix4(M); return [q.x, q.y]; });
      if (pr.rotX || pr.rotY) {
        return { kind: 'geo', shape: 'extrude', params: { points: pts, depth: pr.depth },
                 x: _v.x, y: _v.y, z: _v.z, rotX: pr.rotX, rotY: pr.rotY, rotZ: 0, color: c };
      }
      return { kind: 'panel', points: pts, depth: pr.depth, z: _v.z, color: c };
    });
    const n = (partIds[key] = (partIds[key] || 0) + 1);
    parts.push({ id: key + '#' + n, name: LR_LABEL[key] || key, category: CATEGORY[key] || '基础身体',
                 parent: key, primitives: prims });
  }

  // 脸部：工坊 spec 承载不了手绘贴图，这里放一个肤色的圆角盒占位
  parts.push({
    id: 'face#1', name: '脸（占位，见 model.js）', category: '基础头型', parent: 'head',
    primitives: [{ kind: 'geo', shape: 'box', w: .61, h: .5, d: .47, x: 0, y: .035, z: 0, rotX: 0, rotY: 0, rotZ: 0, color: spec.skin }],
  });

  return {
    id, name: spec.name, mode: 'parts', base: null,
    useOrigFace: false, iris: spec.eyes.slice(),
    palette: { hair: spec.hair, hairHi: spec.hairHi ?? spec.hair, coat: spec.coat ?? spec.shirt ?? spec.hair,
               coatHi: spec.coatB ?? spec.shirtB ?? spec.hair, trim: spec.trim ?? spec.tie ?? 0xffffff,
               skin: spec.skin, under: spec.shade ?? 0x111111, metal: 0x9aa3ad },
    rig: {
      groups: {
        body: { p: [0, BODY_Y, 0], r: [0, 0, 0], s: [1, 1, 1] },
        head: { p: [0, HEAD_Y, 0], r: [0, 0, 0], s: HEAD_SCALE.slice() },
        armL: { p: [-.36, 1.2183, 0], r: [0, 0, 0], s: [1, 1, 1] },
        armR: { p: [.36, 1.2183, 0], r: [0, 0, 0], s: [1, 1, 1] },
        legL: { p: [-.16, .73, 0], r: [0, 0, 0], s: [1, JE, 1] },
        legR: { p: [.16, .73, 0], r: [0, 0, 0], s: [1, JE, 1] },
        coatTails: { p: [0, 1.34, -.18], r: [0, 0, 0], s: [1, 1, 1] },
        tail: { p: [0, .77, -.23], r: [0, 0, 0], s: [1, 1, 1] },
        root: { p: [0, 0, 0], r: [0, 0, 0], s: [QE, QE, QE] },
      },
      bodyY: BODY_Y, headY: HEAD_Y, headScale: HEAD_SCALE.slice(),
      armX: .36, armY: 1.2183, legX: .16, legY: .73, rootScale: QE,
      coatTails: [0, 1.34, -.18], tail: [0, .77, -.23],
    },
    zones: [], parts,
  };
}

/** 导出成工坊的 model.js 工厂源码（自包含：内联 spec + 一个小解释器，实验室可直接跑） */
export function factorySource(id) {
  const spec = exportSpec(id);
  if (!spec) return null;
  const S = JSON.stringify(spec);
  return `/* 由 characters.lowpoly.js 导出 · ${spec.name} (${spec.id})
   自包含工厂：内联 spec + 小解释器。用法：const c = build_${id}(); scene.add(c.root);
   注：工厂**不能声明 THREE/Q 参数** —— 低模工坊是把它塞进
   new Function('THREE','Q','XT','attachFace', src) 里求值的，要用闭包里的 THREE。
   几何/骨架与我们的运行时一致；脸在这里是占位盒（手绘贴图只在运行时本体里）。 */
function build_${id}(){
  const SPEC = ${S};
  const T = THREE, RG = SPEC.rig.groups;
  const G = {}; for (const k in RG){ G[k] = new T.Group(); const g = RG[k];
    if (g.p) G[k].position.set(g.p[0],g.p[1],g.p[2]);
    if (g.r) G[k].rotation.set(g.r[0],g.r[1],g.r[2]);
    if (g.s) G[k].scale.set(g.s[0],g.s[1],g.s[2]); }
  const parentOf = (k) => (k==='root' ? G.root : (k==='body' ? G.body : (k==='head' ? G.head : G.body)));
  G.root.add(G.body); G.body.add(G.head, G.coatTails, G.tail, G.armL, G.armR, G.legL, G.legR);
  function vcol(g, hex){ const n=g.getAttribute('normal'), c=new T.Color(hex),
    a=new Float32Array(g.getAttribute('position').count*3);
    for(let i=0;i<a.length;i+=3){ const t=.92+.08*Math.max(0,n.getY(i/3));
      a[i]=c.r*t; a[i+1]=c.g*t; a[i+2]=c.b*t; }
    g.setAttribute('color', new T.BufferAttribute(a,3)); return g; }
  function mkGeo(pr){
    if (pr.kind==='box' || (pr.kind==='geo' && pr.shape==='box'))
      return new T.BoxGeometry(pr.w||.1, pr.h||.1, pr.d||.1);
    const pts = pr.points || (pr.params && pr.params.points) || [[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]];
    const dep = (pr.depth!=null) ? pr.depth : ((pr.params && pr.params.depth) || .02);
    const s = new T.Shape(); pts.forEach((p,i)=> i?s.lineTo(p[0],p[1]):s.moveTo(p[0],p[1])); s.closePath();
    const g = new T.ExtrudeGeometry(s,{depth:dep,bevelEnabled:false,steps:1,curveSegments:1});
    g.translate(0,0,-dep/2); return g;
  }
  const mat = new T.MeshStandardMaterial({vertexColors:true, roughness:.69, metalness:.05});
  for (const part of SPEC.parts){
    const par = G[part.parent] || G.body;
    for (const pr of part.primitives){
      const g = mkGeo(pr);
      if (pr.rotX) g.rotateX(pr.rotX); if (pr.rotY) g.rotateY(pr.rotY); if (pr.rotZ) g.rotateZ(pr.rotZ);
      g.translate(pr.x||0, pr.y||0, pr.z||0);
      vcol(g, typeof pr.color==='number'?pr.color:0xcccccc);
      const m = new T.Mesh(g, mat); m.castShadow = m.receiveShadow = true; par.add(m);
    }
  }
  return { root: G.root };
}`;
}

/** 把 spec 的每个部件算成**世界空间**（root 空间）的 Box3 —— 喂给 seamGate */
export function partBoxes(spec) {
  const g = (spec.rig && spec.rig.groups) || {};
  const parentOf = { body: 'root', head: 'body', armL: 'body', armR: 'body',
                     legL: 'body', legR: 'body', coatTails: 'body', tail: 'body', root: null };
  const O = {};
  for (const k in g) {
    const t = g[k], o = new THREE.Object3D();
    o.position.set(...(t.p || [0, 0, 0]));
    o.rotation.set(...(t.r || [0, 0, 0]));
    o.scale.set(...(t.s || [1, 1, 1]));
    O[k] = o;
  }
  for (const k in O) { const p = parentOf[k]; if (p && O[p]) O[p].add(O[k]); }
  (O.root || O.body).updateMatrixWorld(true);
  const out = new Map();
  for (const part of spec.parts || []) {
    const m = (O[part.parent] || O.body).matrixWorld;
    const box = new THREE.Box3();
    for (const pr of part.primitives || []) {
      if (pr.kind === 'box') {
        const c = new THREE.Vector3(pr.x, pr.y, pr.z).applyMatrix4(m);
        const h = new THREE.Vector3(Math.abs(pr.w) / 2, Math.abs(pr.h) / 2, Math.abs(pr.d) / 2);
        box.expandByPoint(c.clone().sub(h)); box.expandByPoint(c.clone().add(h));
      } else {
        const pts = pr.points || (pr.params && pr.params.points) || [];
        const dep = (pr.depth != null) ? pr.depth : ((pr.params && pr.params.depth) || 0);
        const zc = (pr.z || 0);
        for (const p of pts) box.expandByPoint(new THREE.Vector3(p[0], p[1], zc - dep / 2).applyMatrix4(m));
        if (pts.length) for (const p of pts) box.expandByPoint(new THREE.Vector3(p[0], p[1], zc + dep / 2).applyMatrix4(m));
      }
    }
    if (!box.isEmpty()) out.set(part.id, box);
  }
  return out;
}
