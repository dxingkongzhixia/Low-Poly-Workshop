import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Shared materials. Cel / blocky friendly: matte, low metalness.
// ---------------------------------------------------------------------------
export const M = {
  skin: new THREE.MeshStandardMaterial({ color: 0xf6d9c8, roughness: .92 }),
  hair: new THREE.MeshStandardMaterial({ color: 0x14161d, roughness: .78, flatShading: true }),
  black: new THREE.MeshStandardMaterial({ color: 0x1a1c24, roughness: .86, flatShading: true }),
  blackSoft: new THREE.MeshStandardMaterial({ color: 0x24262f, roughness: .88, flatShading: true }),
  white: new THREE.MeshStandardMaterial({ color: 0xf7f8f8, roughness: .74, flatShading: true }),
  eye: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .55 }),
  outline: new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: .8 }),
  blush: new THREE.MeshStandardMaterial({ color: 0xf0b3aa, roughness: .92 }),
  metal: new THREE.MeshStandardMaterial({ color: 0xc2ccd2, roughness: .42, metalness: .45 })
};

/**
 * Make a closed-ish surface face outward.
 * Loft winding depends on whether rings are stacked up or down, so instead of
 * relying on a convention we measure the normals against the centroid and flip
 * the index buffer when they point inward. This removes a whole class of
 * "part is invisible / inside-out" bugs.
 */
export function orientOutward(geometry) {
  geometry.computeVertexNormals();
  const P = geometry.attributes.position, N = geometry.attributes.normal;
  if (!P || !N) return geometry;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < P.count; i++) { cx += P.getX(i); cy += P.getY(i); cz += P.getZ(i); }
  cx /= P.count; cy /= P.count; cz /= P.count;
  let d = 0;
  for (let i = 0; i < P.count; i++) {
    d += N.getX(i) * (P.getX(i) - cx) + N.getY(i) * (P.getY(i) - cy) + N.getZ(i) * (P.getZ(i) - cz);
  }
  if (d < 0 && geometry.index) {
    const idx = geometry.index.array;
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    geometry.index.needsUpdate = true;
    geometry.computeVertexNormals();
  }
  return geometry;
}

function finish(name, geometry, material, category, { smooth = true, orient = true } = {}) {
  if (smooth) { if (orient) orientOutward(geometry); else geometry.computeVertexNormals(); }
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  if (category) mesh.userData.studyCategory = category;
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/** Elliptical ring in the XZ plane at height `y`. Feed the result to `loft`. */
export function ring(cx, y, cz, rx, rz, sides = 10, phase = 0) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = phase + (i / sides) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * rx, y, cz + Math.sin(a) * rz]);
  }
  return pts;
}

/** Axis-aligned square ring — the building block of the blocky/voxel style. */
export function squareRing(cx, y, cz, hw, hd) {
  return [[cx + hw, y, cz + hd], [cx - hw, y, cz + hd], [cx - hw, y, cz - hd], [cx + hw, y, cz - hd]];
}

/** Connect a stack of equal-length rings into a closed surface. */
export function loft(name, rings, material, category, { capStart = true, capEnd = true } = {}) {
  const n = rings[0].length, verts = [], idx = [];
  rings.forEach(r => r.forEach(p => verts.push(p[0], p[1], p[2])));
  for (let s = 0; s < rings.length - 1; s++) {
    const base = s * n, next = (s + 1) * n;
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n;
      idx.push(base + j, base + j2, next + j2, base + j, next + j2, next + j);
    }
  }
  if (capStart) { const c = 0; for (let j = 1; j < n - 1; j++) idx.push(c, c + j, c + j + 1); }
  if (capEnd) { const c = (rings.length - 1) * n; for (let j = 1; j < n - 1; j++) idx.push(c, c + j + 1, c + j); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  return finish(name, g, material, category);
}

/** Vertical stack of elliptical rings. rows = [y, rx, rz, cx?, cz?] */
export function stack(name, rows, sides, material, category, opts) {
  return loft(name, rows.map(([y, rx, rz, cx = 0, cz = 0]) => ring(cx, y, cz, rx, rz, sides)), material, category, opts);
}

/** Vertical stack of axis-aligned boxes. rows = [y, halfWidth, halfDepth, cx?, cz?] */
export function blockStack(name, rows, material, category, opts) {
  return loft(name, rows.map(([y, hw, hd, cx = 0, cz = 0]) => squareRing(cx, y, cz, hw, hd)), material, category, opts);
}

/** A single hard-edged box, as a mesh (not a primitive helper). */
export function block(name, w, h, d, material, category, cx = 0, cy = 0, cz = 0) {
  return blockStack(name, [[cy - h / 2, w / 2, d / 2, cx, cz], [cy + h / 2, w / 2, d / 2, cx, cz]], material, category);
}

/** Extrude an XY silhouette (convex or concave) through Z. */
export function shapeExtrude(name, points, depth, material, category) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -depth / 2);
  return finish(name, g, material, category, { smooth: false });
}

/** Chamfered silhouette extrusion for convex outlines. */
export function profileExtrude(name, points, depth, material, category = 'custom-profile', bevel = .02) {
  if (bevel <= 0) return shapeExtrude(name, points, depth, material, category);
  const n = points.length, verts = [], idx = [];
  const addRing = (z, scale) => points.forEach(([x, y]) => verts.push(x * scale, y * scale, z));
  addRing(-depth / 2, 1 - bevel); addRing(-depth / 2 + bevel, 1);
  addRing(depth / 2 - bevel, 1); addRing(depth / 2, 1 - bevel);
  for (let r = 0; r < 3; r++) for (let i = 0; i < n; i++) {
    const a = r * n + i, b = r * n + (i + 1) % n;
    idx.push(a, b, (r + 1) * n + (i + 1) % n, a, (r + 1) * n + (i + 1) % n, (r + 1) * n + i);
  }
  for (let i = 1; i < n - 1; i++) { idx.push(0, i + 1, i); const c = 3 * n; idx.push(c, c + i, c + i + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  return finish(name, g, material, category);
}

/** Sweep a rectangular section along a 3D path, perpendicular to the path. */
export function ribbon(name, path, widths, thickness, material, category = 'ribbon') {
  const up = new THREE.Vector3(0, 1, 0), tmp = new THREE.Vector3();
  const verts = [], idx = [];
  const p = new THREE.Vector3(), tangent = new THREE.Vector3(), side = new THREE.Vector3(), normal = new THREE.Vector3();
  for (let i = 0; i < path.length; i++) {
    p.set(...path[i]);
    const a = new THREE.Vector3(...(path[Math.max(0, i - 1)]));
    const b = new THREE.Vector3(...(path[Math.min(path.length - 1, i + 1)]));
    tangent.subVectors(b, a).normalize();
    side.crossVectors(tangent, up).normalize();
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    normal.crossVectors(side, tangent).normalize();
    const hw = (widths[i] ?? widths[widths.length - 1]) / 2, ht = thickness / 2;
    for (const [s, t] of [[-hw, -ht], [hw, -ht], [hw, ht], [-hw, ht]]) {
      tmp.copy(p).addScaledVector(side, s).addScaledVector(normal, t);
      verts.push(tmp.x, tmp.y, tmp.z);
    }
  }
  for (let i = 1; i < path.length; i++) {
    const a = (i - 1) * 4, b = i * 4;
    for (const [u, v] of [[0, 1], [1, 2], [2, 3], [3, 0]]) idx.push(a + u, b + u, b + v, a + u, b + v, a + v);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  return finish(name, g, material, category);
}

/** A shallow costume panel from an XY silhouette. */
export function panel(name, silhouette, depth, material, category = 'clothing-panel') {
  return shapeExtrude(name, silhouette, depth, material, category);
}

export function joint(parent, name, position) {
  const g = new THREE.Group(); g.name = name; g.position.set(...position);
  if (parent) parent.add(g); return g;
}
export function starPoints(outer, inner, cx = 0, cy = 0, points = 5) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const a = Math.PI / 2 + i * Math.PI / points, r = i % 2 ? inner : outer;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}
/** Regular polygon outline, for round-ish eyes and emblems. */
export function circlePoints(r, cx = 0, cy = 0, sides = 12) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}
