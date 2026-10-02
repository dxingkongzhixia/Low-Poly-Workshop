/**
 * lowpoly/orig/port.js —— 把「捕获数据」重建成角色 rig —— **走我们自己的 Builder**，不碰原作 id。
 *
 * 两种数据形状（都由捕获生成，见 docs/lowpoly-runtime.md §8）：
 *  A) 忠实树：{ id, rootScale, roles:{body:节点号,…}, nodes:[{i,p,t,r,s,vis}], parts:[{n,p:[…]}] }
 *     —— 保留原作的**嵌套 wrapper**，图元重放不会偏（推荐，lappland 用）。
 *  B) 扁平：{ id, bones:[{n,p,t,r,s}], parts:[{b,p}], hairGeo?, exact?, hide? }
 *     —— 没有嵌套时够用（texas 用）。
 *
 * 头部 + 脸由原作脸管线 attachFace(head,{id}) 现场生成。
 */
import * as THREE from 'three';
import { Builder, QE } from '../model.js';
import { attachFace } from '../../characters.face.js';

const MAT = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .69, metalness: .05 });

function rawGeo(type, p, c) {
  const T = THREE; let g = null;
  try {
    if (type === 'BoxGeometry') g = new T.BoxGeometry(p.width, p.height, p.depth);
    else if (type === 'CylinderGeometry') g = new T.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, p.radialSegments, 1, p.openEnded);
    else if (type === 'SphereGeometry') g = new T.SphereGeometry(p.radius, p.widthSegments, p.heightSegments);
    else if (type === 'ConeGeometry') g = new T.ConeGeometry(p.radius, p.height, p.radialSegments, 1, p.openEnded);
    else if (type === 'TorusGeometry') g = new T.TorusGeometry(p.radius, p.tube, p.radialSegments, p.tubularSegments);
  } catch (e) { return null; }
  if (!g) return null;
  if (c) g.translate(c[0], c[1], c[2]);       // 记的是 bbox 中心（几何原本对称、在原点）
  return g;
}
function replay(bone, prims, name) {
  /* ⚠ 不能把 box/shape 和「直接 add 的裸几何」塞进**同一个** Builder ——
     实测 `b.box(...)` + `b.add(rawGeo)` 会让 `build()` 返回 null（两者都丢）。
     所以按种类分段：box/shape 归一个 Builder，裸几何各自 build 一次。
     `name` = 原作给这个网格起的名字（如 `croissant-hammer`）—— 回填后才能按名字认出武器。 */
  let b = new Builder();
  let firstMesh = null;
  const flush = () => { const m = b.build(bone); if (m && !firstMesh) firstMesh = m; b = new Builder(); };
  for (const pr of prims) {
    if (pr[0] === 'box') b.box(pr[1], pr[2], pr[3], pr[4], pr[5], pr[6], pr[7], pr[8] || 0);
    else if (pr[0] === 'shape') b.shape(pr[1], pr[2], pr[3], pr[4], pr[5] || 0, pr[6] || 0, pr[7] || 0, pr[8] || 0);
    else if (pr[0] === 'meshRaw') {          // 直接 add 的网格：位置 + 顶点色 + 相对骨骼的矩阵
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pr[1], 3));
      if (pr[2]) g.setAttribute('color', new THREE.Float32BufferAttribute(pr[2], 3));
      g.computeVertexNormals();
      if (pr[3]) g.applyMatrix4(new THREE.Matrix4().fromArray(pr[3]));
      flush();
      const mesh = new THREE.Mesh(g, MAT());
      mesh.name = pr[4] || name || '';
      g.userData.primitiveVertexCounts = [pr[1].length / 3];
      mesh.castShadow = mesh.receiveShadow = true;
      bone.add(mesh);
      if (!firstMesh) firstMesh = mesh;
      b = new Builder();
    }
    else {
      const g = pr[0] === 'geo' ? rawGeo(pr[1], pr[2], pr[3]) : rawRaw(pr);
      if (g) { flush(); b.add(g, pr[0] === 'geo' ? pr[4] : pr[2]); flush(); }
    }
  }
  flush();
  if (firstMesh && name) firstMesh.name = name;
}
function rawRaw(pr) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pr[1], 3));
  g.computeVertexNormals();
  return g;
}
function exactMesh(bone, it) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(it.positions, 3));
  if (it.normals) g.setAttribute('normal', new THREE.Float32BufferAttribute(it.normals, 3));
  if (it.colors) g.setAttribute('color', new THREE.Float32BufferAttribute(it.colors, 3));
  /* ★ 精确几何也要带上「每个原始图元占多少顶点」（写在 geometry.userData）——
     部件编辑器靠它把这一个网格再拆回原始图元 */
  g.userData.primitiveVertexCounts = it.counts || [g.getAttribute('position').count];
  const m = new THREE.Mesh(g, MAT());
  m.name = it.name || '';
  if (it.m) m.applyMatrix4(new THREE.Matrix4().fromArray(it.m));
  m.castShadow = m.receiveShadow = true;
  bone.add(m);
}

export function buildFromPort(data) {
  const root = new THREE.Group(); root.name = 'root'; root.scale.setScalar(QE);

  /* ── A) 忠实树 ── */
  if (data.nodes) {
    const objs = [];
    for (const nd of data.nodes) {
      const o = new THREE.Group();
      o.position.set(nd.t[0], nd.t[1], nd.t[2]);
      o.rotation.set(nd.r[0], nd.r[1], nd.r[2]);
      o.scale.set(nd.s[0], nd.s[1], nd.s[2]);
      if (nd.vis === false) o.visible = false;
      objs[nd.i] = o;
      (nd.p < 0 ? root : objs[nd.p] || root).add(o);
    }
    for (const part of data.parts) { const n = objs[part.n]; if (n) replay(n, part.p); }
    const R = data.roles || {};
    const at = (i) => (i >= 0 && objs[i]) || null;
    const head = at(R.head);
    const face = (data.noFace || !head) ? null : attachFace(head, { id: data.id, iris: (data.palette && data.palette.AT) || null });
    return { root, body: at(R.body), head, hair: at(R.hair),
      arms: [at(R.armL), at(R.armR)].filter(Boolean),
      legs: [at(R.legL), at(R.legR)].filter(Boolean),
      knees: [at(R.kneeL), at(R.kneeR)].filter(Boolean),
      tail: at(R.tail), prop: at(R.prop), coatTails: at(R.coatTails),
      weapons: [at(R.weapon0), at(R.weapon1)].filter(Boolean), staffs: [],
      halo: null, eyes: null, face, ported: true, spec: { id: data.id } };
  }

  /* ── B) 扁平 ── */
  const G = { root };
  for (const b of data.bones) {
    const o = new THREE.Group(); o.name = b.n;
    o.position.set(b.t[0], b.t[1], b.t[2]);
    o.rotation.set(b.r[0], b.r[1], b.r[2]);
    o.scale.set(b.s[0], b.s[1], b.s[2]);
    G[b.n] = o;
    (b.p === 'root' ? root : G[b.p] || root).add(o);
  }
  const skip = new Set(Object.keys(data.exact || {}));
  const nmMap = {}; for (const bd of (data.bones || [])) nmMap[bd.n] = bd.mn;
  for (const part of data.parts) { const n = G[part.b]; if (n && !skip.has(part.b)) replay(n, part.p, part.nm || nmMap[part.b]); }
  if (data.exact) for (const [n, list] of Object.entries(data.exact)) {
    const bone = G[n]; if (!bone) continue;
    for (const it of list) exactMesh(bone, it);
  }
  for (const n of (data.hide || [])) if (G[n]) G[n].visible = false;
  const head = G.head;
  const face = (data.noFace || !head) ? null : attachFace(head, { id: data.id, iris: (data.palette && data.palette.AT) || null });
  if (data.hairGeo && G.hair) {
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.Float32BufferAttribute(data.hairGeo.positions, 3));
    if (data.hairGeo.normals) hg.setAttribute('normal', new THREE.Float32BufferAttribute(data.hairGeo.normals, 3));
    if (data.hairGeo.colors) hg.setAttribute('color', new THREE.Float32BufferAttribute(data.hairGeo.colors, 3));
    hg.userData.primitiveVertexCounts = [hg.getAttribute('position').count];
    const hm = new THREE.Mesh(hg, MAT());
    hm.castShadow = hm.receiveShadow = true;
    G.hair.add(hm);
  }
  return { root, body: G.body, head, hair: G.hair,
    arms: [G.armL, G.armR].filter(Boolean), legs: [G.legL, G.legR].filter(Boolean),
    knees: [G.kneeL, G.kneeR].filter(Boolean),
    tail: G.tail || null, prop: G.prop || null, coatTails: G.coatTails || null,
    weapons: (data.bones || []).filter(b => /^weapon/i.test(b.n)).map(b => G[b.n]).filter(Boolean),
    staffs: (data.bones || []).filter(b => /^staff/i.test(b.n)).map(b => G[b.n]).filter(Boolean),
    halo: null, eyes: null, face, ported: true, spec: { id: data.id } };
}
