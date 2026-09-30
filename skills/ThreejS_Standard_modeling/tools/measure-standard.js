#!/usr/bin/env node
/**
 * measure-standard.js
 * -------------------
 * Reads a standard-model JSON (Three.js Object3D.toJSON) and prints the
 * landmark data the skill needs: per-part world bounds, the head radius
 * profile, and the original hairline.
 *
 * Usage:
 *   node tools/measure-standard.js reference/iE.json
 *   node tools/measure-standard.js reference/iE.json --json
 */
const fs = require('fs');

const file = process.argv[2] || 'reference/iE.json';
const asJson = process.argv.includes('--json');
const o = JSON.parse(fs.readFileSync(file, 'utf8'));

// column-major 4x4 multiply (matches THREE.Matrix4.elements order)
function mul(a, b) {
  const r = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + row] * b[c * 4 + k];
    r[c * 4 + row] = s;
  }
  return r;
}
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const geoById = new Map((o.geometries || []).map(g => [g.uuid, g]));

function worldPoints(gid, m) {
  const g = geoById.get(gid);
  const arr = g && g.data && g.data.attributes && g.data.attributes.position && g.data.attributes.position.array;
  if (!arr) return null;
  const out = [];
  for (let i = 0; i < arr.length; i += 3) {
    const x = arr[i], y = arr[i + 1], z = arr[i + 2];
    out.push([
      m[0] * x + m[4] * y + m[8] * z + m[12],
      m[1] * x + m[5] * y + m[9] * z + m[13],
      m[2] * x + m[6] * y + m[10] * z + m[14]
    ]);
  }
  return out;
}

const parts = [];
function walk(node, parentMatrix) {
  const local = node.matrix && node.matrix.length === 16 ? node.matrix : IDENTITY;
  const world = mul(parentMatrix, local);
  if (node.type === 'Mesh' && node.geometry) {
    const pts = worldPoints(node.geometry, world);
    if (pts) {
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (const p of pts) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
      parts.push({
        name: node.name || '(unnamed)',
        category: (node.userData && node.userData.studyCategory) || null,
        visible: node.visible !== false,
        min: mn, max: mx, vertices: pts.length
      });
    }
  }
  (node.children || []).forEach(c => walk(c, world));
}
walk(o.object, IDENTITY);

// head radius profile
function profile(partName, slices = 10) {
  const rec = parts.find(p => p.name === partName);
  if (!rec) return null;
  // re-derive points for slicing
  let ptsOut = null;
  (function find(node, pm) {
    const local = node.matrix && node.matrix.length === 16 ? node.matrix : IDENTITY;
    const world = mul(pm, local);
    if (node.type === 'Mesh' && node.name === partName && node.geometry) ptsOut = worldPoints(node.geometry, world);
    (node.children || []).forEach(c => find(c, world));
  })(o.object, IDENTITY);
  if (!ptsOut) return null;
  const rows = [];
  const lo = rec.min[1], hi = rec.max[1];
  for (let s = 0; s < slices; s++) {
    const a = lo + (hi - lo) * s / slices, b = lo + (hi - lo) * (s + 1) / slices;
    let rx = 0, zmin = Infinity, zmax = -Infinity, n = 0;
    for (const p of ptsOut) if (p[1] >= a && p[1] < b) { rx = Math.max(rx, Math.abs(p[0])); zmin = Math.min(zmin, p[2]); zmax = Math.max(zmax, p[2]); n++; }
    if (n) rows.push({ yFrom: +a.toFixed(3), yTo: +b.toFixed(3), radiusX: +rx.toFixed(3), z: [+zmin.toFixed(3), +zmax.toFixed(3)], vertices: n });
  }
  return rows;
}

// original hairline: front-facing hair vertices give the fringe bottom
function hairline() {
  // only the fringe/crown mesh defines the hairline; side locks would skew it down
  const names = ['reference-square-crown-and-fringe'];
  const ys = [];
  (function find(node, pm) {
    const local = node.matrix && node.matrix.length === 16 ? node.matrix : IDENTITY;
    const world = mul(pm, local);
    if (node.type === 'Mesh' && names.includes(node.name) && node.geometry) {
      const pts = worldPoints(node.geometry, world) || [];
      for (const p of pts) if (p[2] > 0.28) ys.push(p[1]);
    }
    (node.children || []).forEach(c => find(c, world));
  })(o.object, IDENTITY);
  if (!ys.length) return null;
  return { frontHairMinY: +Math.min(...ys).toFixed(3), frontHairMaxY: +Math.max(...ys).toFixed(3), samples: ys.length };
}

/**
 * Find the eyes on a textured face mesh and report their world-space position.
 * The head is a multi-material mesh; one material carries a small face texture.
 * Iris pixels are a desaturated teal: g and b are both clearly above r.
 */
function faceEyes(meshName = 'rounded-cheeks-and-chin', minW = 0) {
  let target = null;
  (function find(node, pm) {
    const local = node.matrix && node.matrix.length === 16 ? node.matrix : IDENTITY;
    const world = mul(pm, local);
    if (node.type === 'Mesh' && node.name === meshName) target = { node, world };
    (node.children || []).forEach(c => find(c, world));
  })(o.object, IDENTITY);
  if (!target) return null;

  const matRefs = Array.isArray(target.node.material) ? target.node.material : [target.node.material];
  const matById = new Map((o.materials || []).map(m => [m.uuid, m]));
  const texById = new Map((o.textures || []).map(t => [t.uuid, t]));
  const imgById = new Map((o.images || []).map(t => [t.uuid, t]));

  for (let mi = 0; mi < matRefs.length; mi++) {
    const m = matById.get(matRefs[mi]);
    const tex = m && m.map ? texById.get(m.map) : null;
    const im = tex ? imgById.get(tex.image) : null;
    if (!im || im.url.width < minW || im.url.width > 128) continue;
    const { width: W, height: H, data: D } = im.url;
    let n = 0, u0 = Infinity, u1 = -Infinity, r0 = Infinity, r1 = -Infinity;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, r = D[i], g = D[i + 1], b = D[i + 2];
      if (g > r + 18 && b > r + 18) { n++; u0 = Math.min(u0, x); u1 = Math.max(u1, x); r0 = Math.min(r0, y); r1 = Math.max(r1, y); }
    }
    if (!n) continue;
    const U0 = u0 / W, U1 = (u1 + 1) / W, V0 = 1 - (r1 + 1) / H, V1 = 1 - r0 / H;
    const g2 = geoById.get(target.node.geometry);
    const P = g2.data.attributes.position.array, UV = g2.data.attributes.uv.array;
    const groups = g2.data.groups || [];
    const grp = groups.find(x => x.materialIndex === mi);
    const idx = g2.data.index ? g2.data.index.array : null;
    const verts = new Set();
    if (idx && grp) for (let i = grp.start; i < grp.start + grp.count; i++) verts.add(idx[i]);
    else for (let i = 0; i < P.length / 3; i++) verts.add(i);
    const w = target.world;
    let ymin = Infinity, ymax = -Infinity, zmin = Infinity, zmax = -Infinity, x0 = Infinity, x1 = -Infinity, hits = 0;
    for (const vi of verts) {
      const u = UV[vi * 2], v = UV[vi * 2 + 1];
      if (u < U0 - .02 || u > U1 + .02 || v < V0 - .02 || v > V1 + .02) continue;
      const X = P[vi * 3], Y = P[vi * 3 + 1], Z = P[vi * 3 + 2];
      const wx = w[0] * X + w[4] * Y + w[8] * Z + w[12];
      const wy = w[1] * X + w[5] * Y + w[9] * Z + w[13];
      const wz = w[2] * X + w[6] * Y + w[10] * Z + w[14];
      ymin = Math.min(ymin, wy); ymax = Math.max(ymax, wy);
      zmin = Math.min(zmin, wz); zmax = Math.max(zmax, wz);
      x0 = Math.min(x0, wx); x1 = Math.max(x1, wx);
      hits++;
    }
    if (!hits) continue;
    const r3 = v => +v.toFixed(3);
    return {
      materialIndex: mi, textureSize: `${W}x${H}`, irisPixels: n, mappedVertices: hits,
      worldY: [r3(ymin), r3(ymax)], worldX: [r3(x0), r3(x1)], worldZ: [r3(zmin), r3(zmax)]
    };
  }
  return null;
}

const total = parts.filter(p => p.visible && p.category);
const bounds = total.reduce((acc, p) => {
  for (let k = 0; k < 3; k++) { acc.min[k] = Math.min(acc.min[k], p.min[k]); acc.max[k] = Math.max(acc.max[k], p.max[k]); }
  return acc;
}, { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });

const result = {
  source: file,
  note: 'The standard is a ~2.4-head chibi facing +Z. Build detail geometry in this coordinate space.',
  totalBounds: bounds,
  totalHeight: +(bounds.max[1] - bounds.min[1]).toFixed(3),
  headProfile: profile('rounded-cheeks-and-chin'),
  bodyProfile: profile('reference-base-body'),
  hairline: hairline(),
  eyes: faceEyes(),
  parts
};

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const f = n => n.toFixed(3);
  console.log(`standard: ${file}`);
  console.log(`height ${result.totalHeight}  x[${f(bounds.min[0])}..${f(bounds.max[0])}]  y[${f(bounds.min[1])}..${f(bounds.max[1])}]  z[${f(bounds.min[2])}..${f(bounds.max[2])}]`);
  console.log(`\nhairline: ${JSON.stringify(result.hairline)}`);
  console.log(`eyes: ${JSON.stringify(result.eyes)}`);
  console.log('\nhead profile:');
  for (const r of result.headProfile || []) console.log(`  y ${r.yFrom}..${r.yTo}  |x|max ${r.radiusX}  z[${r.z}]`);
  console.log('\nparts:');
  for (const p of parts) {
    console.log(`  ${p.visible ? ' ' : 'x'} ${(p.category || '-').padEnd(12)} ${p.name}  y[${f(p.min[1])}..${f(p.max[1])}] size[${f(p.max[0]-p.min[0])},${f(p.max[1]-p.min[1])},${f(p.max[2]-p.min[2])}]`);
  }
}
