#!/usr/bin/env node
/**
 * build-voxel-character.js
 * ------------------------
 * Generates a MagicaVoxel .vox model of the blocky Q-style character, plus a
 * JSON copy for the Three.js voxel viewer.
 *
 * No dependencies. Writes a minimal, widely-compatible version-150 file:
 *   MAIN { SIZE, XYZI, RGBA }
 *
 * Usage:
 *   node tools/build-voxel-character.js [outDir]
 *   node tools/build-voxel-character.js --preview      # ASCII front/side views
 */
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// palette (index 1..n). index 0 is reserved for "empty".
// ---------------------------------------------------------------------------
const PAL = [
  [0x1b, 0x1e, 0x26, 255],  // 1 fabric black
  [0x14, 0x16, 0x1c, 255],  // 2 hair black
  [0xf2, 0xf4, 0xf6, 255],  // 3 white
  [0xf8, 0xdd, 0xc9, 255],  // 4 skin
  [0xec, 0xc8, 0xb2, 255],  // 5 skin shade
  [0xb9, 0xc4, 0xcb, 255],  // 6 metal
  [0x0a, 0x0b, 0x0e, 255],  // 7 outline black
  [0x2a, 0x2d, 0x38, 255]   // 8 alternate fabric
];
const C = { FAB: 1, HAIR: 2, WHITE: 3, SKIN: 4, SHADE: 5, METAL: 6, LINE: 7, ALT: 8 };
const GLYPH = { 0: ' ', 1: '#', 2: '@', 3: '.', 4: 'o', 5: 'x', 6: '+', 7: '*', 8: '%' };

// ---------------------------------------------------------------------------
// grid: x in [-X0, SX-X0), y in [-Y0, SY-Y0), z in [0, SZ)
// voxel coords: x right, y back (front = -Y), z up
// ---------------------------------------------------------------------------
const SX = 72, SY = 34, SZ = 74, X0 = 36, Y0 = 17;

class Vox {
  constructor() { this.g = new Uint8Array(SX * SY * SZ); this.n = 0; }
  idx(x, y, z) { return ((z * SY) + (y + Y0)) * SX + (x + X0); }
  inb(x, y, z) { return x >= -X0 && x < SX - X0 && y >= -Y0 && y < SY - Y0 && z >= 0 && z < SZ; }
  set(x, y, z, c) {
    x = Math.round(x); y = Math.round(y); z = Math.round(z);
    if (!this.inb(x, y, z)) return;
    const i = this.idx(x, y, z);
    if (this.g[i] === 0 && c !== 0) this.n++;
    if (c === 0 && this.g[i] !== 0) this.n--;
    this.g[i] = c;
  }
  get(x, y, z) { return this.inb(x, y, z) ? this.g[this.idx(x, y, z)] : 0; }
  /** inclusive box */
  box(x0, x1, y0, y1, z0, z1, c) {
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, z, c);
  }
  /** box mirrored across x (fills both sides) */
  both(x0, x1, y0, y1, z0, z1, c) {
    this.box(x0, x1, y0, y1, z0, z1, c);
    this.box(-x1, -x0, y0, y1, z0, z1, c);
  }
  /** filled disc on the XZ plane at depth y */
  discXZ(cx, cz, r, y, c) {
    for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
        if ((x - cx) ** 2 + (z - cz) ** 2 <= r * r) this.set(x, y, z, c);
  }
  /** hollow ring on the XZ plane at depth y */
  ringXZ(cx, cz, r, y, c) {
    for (let z = Math.floor(cz - r - 1); z <= Math.ceil(cz + r + 1); z++)
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        const d = Math.sqrt((x - cx) ** 2 + (z - cz) ** 2);
        if (d <= r && d > r - 1.15) this.set(x, y, z, c);
      }
  }
  /** a stack of shrinking boxes along z — the blocky tapered limb shape */
  taper(x0, x1, y0, y1, z0, z1, c, shrink = 0) {
    const steps = z1 - z0 + 1;
    for (let i = 0; i < steps; i++) {
      const t = steps <= 1 ? 0 : i / (steps - 1);
      const s = Math.round(shrink * t);
      this.box(x0 + s, x1 - s, y0 + s, y1 - s, z0 + i, z0 + i, c);
    }
  }
  taperBoth(x0, x1, y0, y1, z0, z1, c, shrink = 0) {
    this.taper(x0, x1, y0, y1, z0, z1, c, shrink);
    this.taper(-x1, -x0, y0, y1, z0, z1, c, shrink);
  }
}

// ---------------------------------------------------------------------------
// the character
// ---------------------------------------------------------------------------
function build(variant = 'classic') {
  const V = new Vox();
  const FAB = variant === 'alternate' ? C.ALT : C.FAB;

  // Strategy: FILL a solid silhouette first, then CARVE the openings, then
  // paint the inner layers. Building the body from disconnected slabs was what
  // produced holes and background showing through.

  // stage 1 — solid fills ------------------------------------------------
  V.both(1, 11, -11, 6, 0, 3, C.WHITE);            // boot sole
  V.box(-1, 1, -11, 6, 0, 3, 0);                   // gap between the soles
  V.both(1, 11, -11, 6, 3, 15, FAB);               // boot shaft
  V.both(1, 11, -13, -11, 3, 8, FAB);              // toe box
  V.both(2, 9, -8, 5, 15, 24, C.SKIN);             // bare thigh
  V.box(-11, 11, -9, 6, 23, 29, FAB);              // shorts
  V.box(-11, 11, -9, 6, 29, 32, FAB);              // wide belt
  V.box(-12, 12, -10, 7, 32, 46, FAB);             // torso / closed coat volume
  V.box(-6, 6, -7, 6, 44, 48, C.SKIN);             // NECK (was missing)
  V.both(12, 21, -7, 5, 30, 45, FAB);              // sleeves (touching shoulders)
  V.both(12, 20, -6, 5, 24, 31, FAB);              // gloves
  V.box(-14, 14, -11, 9, 12, 32, FAB);             // coat hem / skirt volume
  V.box(-15, 15, -14, 13, 46, 70, C.SKIN);         // head block
  V.box(-16, 16, 9, 15, 44, 72, C.HAIR);           // back hair
  V.box(-16, 16, -15, 14, 62, 72, C.HAIR);         // top hair slab
  V.box(-11, 11, -9, 8, 72, 75, C.HAIR);           // crown step
  V.box(-6, 6, -5, 4, 75, 76, C.HAIR);             // crown top
  V.both(13, 18, -15, 14, 44, 72, C.HAIR);         // side hair
  V.box(-15, 15, -15, -12, 60, 72, C.HAIR);        // fringe slab
  for (const [sx, len] of [[-13, 7], [-9, 4], [-5, 2], [5, 2], [9, 4], [13, 7]]) {
    for (let i = 0; i < len; i++) {                // jagged fringe spikes
      const ww = Math.max(0, 2 - Math.floor(i / 3));
      for (let x = sx - ww; x <= sx + ww; x++) V.set(x, -12, 60 - i, C.HAIR);
    }
  }

  // stage 2 — carve the openings ----------------------------------------
  V.box(-4, 4, -14, -3, 33, 45, 0);                // open front of the coat
  V.box(-3, 3, -14, -8, 12, 32, 0);                // front slit in the hem
  V.box(-9, 9, -14, -6, 15, 23, 0);                // hem cut so thighs show

  // stage 3 — repaint the layers revealed by the carve --------------------
  V.box(-7, 7, -8, -4, 32, 38, C.SKIN);            // bare midriff
  V.box(-8, 8, -9, -4, 38, 45, FAB);               // bikini inner top
  V.box(-8, 8, -9, -4, 38, 38, C.WHITE);           //   white bottom edge
  V.box(-8, 8, -9, -4, 44, 45, C.WHITE);           //   white top edge
  V.box(-2, 2, -10, -9, 40, 41, C.WHITE);          //   knot
  V.box(-9, 9, -11, -9, 32, 45, 0);                // keep the opening clear again
  V.box(-8, 8, -10, -6, 38, 45, FAB);
  V.box(-8, 8, -10, -6, 44, 45, C.WHITE);
  V.box(-7, 7, -10, -6, 32, 38, C.SKIN);

  // stage 4 — trim and details -------------------------------------------
  V.both(1, 11, -11, 6, 0, 3, C.WHITE);            // re-assert sole colour
  V.box(-1, 1, -11, 6, 0, 3, 0);
  V.both(1, 11, -11, 6, 13, 15, C.WHITE);          // boot top band
  V.both(9, 13, -13, -10, 13, 15, C.WHITE);        // boot front chevron
  V.both(11, 11, -8, 4, 4, 12, C.WHITE);           // boot side stripe
  V.box(-11, 11, -9, 6, 31, 31, C.WHITE);          // belt stripes
  V.box(-11, 11, -9, 6, 29, 29, C.WHITE);
  V.box(-3, 3, -10, -9, 29, 32, C.METAL);          // buckle
  V.both(5, 6, -14, -9, 33, 45, C.WHITE);          // white lapel down the opening
  V.both(12, 21, -7, 5, 26, 27, C.WHITE);          // sleeve cuff
  V.both(20, 20, -4, 3, 30, 38, C.WHITE);          // sleeve stripe
  V.box(-14, 14, -11, 9, 12, 12, C.WHITE);         // hem bottom edge
  V.both(13, 14, -11, 9, 12, 32, C.WHITE);         // hem outer edge
  V.both(9, 9, -12, -10, 14, 30, C.WHITE);         // hem front edge
  V.box(-12, 12, 7, 12, 40, 52, FAB);              // hood behind the head

  // ===== face =============================================================
  const eyeY = -14, eyeZ = 55, eyeR = 3.6;
  V.ringXZ(-6, eyeZ, eyeR + 1.0, eyeY, C.LINE);
  V.discXZ(-6, eyeZ, eyeR, eyeY, C.WHITE);
  V.ringXZ(6, eyeZ, eyeR + 1.0, eyeY, C.LINE);
  V.discXZ(6, eyeZ, eyeR, eyeY, C.WHITE);
  V.box(-1, 1, eyeY, eyeY, 49, 49, C.LINE);        // mouth

  // ===== twin tails =======================================================
  const seg = [
    [19, 25, -10, 3, 58, 66],
    [22, 28, -10, 3, 46, 60],
    [25, 30, -9, 3, 34, 50],
    [26, 31, -8, 2, 22, 38],
    [24, 29, -7, 2, 14, 26],
    [20, 25, -6, 1, 9, 17]
  ];
  for (const [x0, x1, y0, y1, z0, z1] of seg) {
    V.box(x0, x1, y0, y1, z0, z1, C.HAIR);
    V.box(-x1, -x0, y0, y1, z0, z1, C.HAIR);
  }
  for (const [bx, bz, len] of [[30, 60, 6], [31, 42, 7], [29, 20, 6]]) {
    for (let i = 0; i < len; i++) {
      const w = Math.max(0, 2 - Math.floor(i / 3));
      for (let y = -2; y <= 2; y++) for (let dz = -w; dz <= w; dz++) {
        V.set(bx + i, y, bz + dz, C.HAIR);
        V.set(-(bx + i), y, bz + dz, C.HAIR);
      }
    }
  }
  V.box(-25, -18, -11, 4, 60, 62, C.FAB);
  V.box(18, 25, -11, 4, 60, 62, C.FAB);

  return V;
}

// ---------------------------------------------------------------------------
// .vox writer
// ---------------------------------------------------------------------------
function toVox(V) {
  const voxels = [];
  for (let z = 0; z < SZ; z++) for (let y = 0; y < SY; y++) for (let x = 0; x < SX; x++) {
    const c = V.g[(z * SY + y) * SX + x];
    if (c) voxels.push([x, y, z, c]);
  }
  // chunk sizes: 12-byte header each, plus content
  const sizeChunk = 12 + 12;                     // SIZE: 3 int32
  const xyziChunk = 12 + 4 + voxels.length * 4;  // XYZI: count + x,y,z,c
  const rgbaChunk = 12 + 1024;                   // RGBA: 256 entries
  const childrenSize = sizeChunk + xyziChunk + rgbaChunk;
  const buf = Buffer.alloc(8 + 12 + childrenSize);   // 'VOX ' + version + MAIN header + children
  let o = 0;
  buf.write('VOX ', o); o += 4; buf.writeInt32LE(150, o); o += 4;
  buf.write('MAIN', o); o += 4; buf.writeInt32LE(0, o); o += 4; buf.writeInt32LE(childrenSize, o); o += 4;
  buf.write('SIZE', o); o += 4; buf.writeInt32LE(12, o); o += 4; buf.writeInt32LE(0, o); o += 4;
  buf.writeInt32LE(SX, o); o += 4; buf.writeInt32LE(SY, o); o += 4; buf.writeInt32LE(SZ, o); o += 4;
  buf.write('XYZI', o); o += 4; buf.writeInt32LE(4 + voxels.length * 4, o); o += 4; buf.writeInt32LE(0, o); o += 4;
  buf.writeInt32LE(voxels.length, o); o += 4;
  for (const [x, y, z, c] of voxels) { buf[o++] = x; buf[o++] = y; buf[o++] = z; buf[o++] = c; }
  buf.write('RGBA', o); o += 4; buf.writeInt32LE(1024, o); o += 4; buf.writeInt32LE(0, o); o += 4;
  for (let i = 0; i < 256; i++) { const p = PAL[i] || [0, 0, 0, 255]; buf[o++] = p[0]; buf[o++] = p[1]; buf[o++] = p[2]; buf[o++] = p[3]; }
  if (o !== buf.length) throw new Error(`vox size mismatch: wrote ${o}, allocated ${buf.length}`);
  return buf;
}

function toJSON(V) {
  const voxels = [];
  for (let z = 0; z < SZ; z++) for (let y = 0; y < SY; y++) for (let x = 0; x < SX; x++) {
    const c = V.g[(z * SY + y) * SX + x];
    if (c) voxels.push([x - X0, y - Y0, z, c]);
  }
  return { size: [SX, SY, SZ], offset: [X0, Y0], palette: PAL.map(p => `#${p[0].toString(16).padStart(2, '0')}${p[1].toString(16).padStart(2, '0')}${p[2].toString(16).padStart(2, '0')}`), voxels };
}

// ---------------------------------------------------------------------------
// ASCII preview so the model can be checked without opening the GUI
// ---------------------------------------------------------------------------
function preview(V) {
  const lines = [];
  lines.push('FRONT (looking along +Y, frontmost voxel wins)');
  for (let z = SZ - 1; z >= 0; z--) {
    let row = String(z).padStart(2, ' ') + ' ';
    let any = false;
    for (let x = -X0; x < SX - X0; x++) {
      let c = 0;
      for (let y = -Y0; y < SY - Y0; y++) { const v = V.get(x, y, z); if (v) { c = v; break; } }
      row += GLYPH[c]; if (c) any = true;
    }
    if (any) lines.push(row);
  }
  lines.push('');
  lines.push('SIDE (looking along -X, leftmost voxel wins)');
  for (let z = SZ - 1; z >= 0; z--) {
    let row = String(z).padStart(2, ' ') + ' ';
    let any = false;
    for (let y = -Y0; y < SY - Y0; y++) {
      let c = 0;
      for (let x = -X0; x < SX - X0; x++) { const v = V.get(x, y, z); if (v) { c = v; break; } }
      row += GLYPH[c]; if (c) any = true;
    }
    if (any) lines.push(row);
  }
  return lines.join('\n');
}

/** horizontal slice at height z: rows = y (depth, front at top), cols = x */
function sliceZ(V, z) {
  const out = [`--- slice z=${z} (front row is y=-${Y0}) ---`];
  for (let y = -Y0; y < SY - Y0; y++) {
    let row = String(y).padStart(3, ' ') + ' ';
    for (let x = -X0; x < SX - X0; x++) row += GLYPH[V.get(x, y, z)];
    out.push(row);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const previewOnly = args.includes('--preview');
const sliceArg = args.find(a => a.startsWith('--slice='));
const outDir = args.find(a => !a.startsWith('--')) || '.';

if (sliceArg) {
  const zs = sliceArg.split('=')[1].split(',').map(Number);
  const V = build('classic');
  for (const z of zs) console.log(sliceZ(V, z) + '\n');
  process.exit(0);
}

for (const variant of ['classic', 'alternate']) {
  const V = build(variant);
  if (previewOnly) { console.log(`===== ${variant} =====`); console.log(preview(V)); continue; }
  const voxName = `qgirl-${variant}.vox`;
  fs.writeFileSync(path.join(outDir, voxName), toVox(V));
  fs.writeFileSync(path.join(outDir, `qgirl-${variant}.json`), JSON.stringify(toJSON(V)));
  console.log(`${voxName}: ${V.n} voxels`);
}
if (!previewOnly) console.log(`written to ${path.resolve(outDir)}`);
