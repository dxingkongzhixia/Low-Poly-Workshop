import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

type ProudRingStack = { rings: [number, number, number, number][] };

// Signed distance to a stack of ellipse rings. Negative inside, positive outside.
//
// The sign is exact; the magnitude is the first-order estimate f / |grad f|, which UNDERSTATES how
// clear an outside point is and OVERSTATES how deep an inside point is. Both errors make the march
// below push slightly further than strictly necessary, which is the safe direction: the failure
// being prevented is a component sinking into the one beneath it and rendering as a bare patch.
function ringStackDistance(stack: ProudRingStack, x: number, y: number, z: number): number {
  const rings = stack.rings;
  const yMin = rings[0][0];
  const yMax = rings[rings.length - 1][0];
  let rx = rings[0][1];
  let rz = rings[0][2];
  let zc = rings[0][3];
  if (y >= yMax) {
    const last = rings[rings.length - 1];
    rx = last[1]; rz = last[2]; zc = last[3];
  } else if (y > yMin) {
    for (let i = 0; i + 1 < rings.length; i += 1) {
      const lo = rings[i];
      const hi = rings[i + 1];
      if (y >= lo[0] && y <= hi[0]) {
        const span = hi[0] - lo[0];
        const t = span > 1e-9 ? (y - lo[0]) / span : 0;
        rx = lo[1] + (hi[1] - lo[1]) * t;
        rz = lo[2] + (hi[2] - lo[2]) * t;
        zc = lo[3] + (hi[3] - lo[3]) * t;
        break;
      }
    }
  }
  const dx = x / rx;
  const dz = (z - zc) / rz;
  const f = dx * dx + dz * dz - 1;
  const gx = (2 * x) / (rx * rx);
  const gz = (2 * (z - zc)) / (rz * rz);
  const grad = Math.hypot(gx, gz);
  const radial = grad < 1e-12 ? -Math.min(rx, rz) : f / grad;
  const axial = Math.max(yMin - y, y - yMax);
  return Math.hypot(Math.max(radial, 0), Math.max(axial, 0)) + Math.min(Math.max(radial, axial), 0);
}

// Push every vertex outward until it stands `clearance` clear of the target's surface.
//
// WHY THE AUTHORED NUMBERS ARE ONLY A LOWER BOUND. A ring is an ELLIPSE, and the surface it has to
// clear generally is not. Any single ellipse that clears the widest point is loose at the narrowest
// and vice versa, so hand-widening moves the error rather than shrinking it -- measured on hair,
// where widening the side masses took closure from 42.2% to 40.9%, worse on all six views, with
// dark coverage DOWN because the widened mass had slid off the skull. Here the authored width is a
// floor and the real radius is MEASURED per vertex.
//
// Each vertex travels along its OWN radial spoke rather than along the field's gradient, so the
// ring keeps its vertex order and its seam positions and only its radius changes. `maxPush` is
// required, not a safeguard: an uncapped march walks inner vertices straight through the target and
// out the far side, closing the very gap the component exists to leave.
function applyStandProud(
  geometry: THREE.BufferGeometry,
  marcher: THREE.Object3D,
  target: THREE.Object3D,
  stack: ProudRingStack,
  clearance: number,
  maxPush: number,
): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  marcher.updateWorldMatrix(true, false);
  target.updateWorldMatrix(true, false);
  const toTarget = new THREE.Matrix4().copy(target.matrixWorld).invert().multiply(marcher.matrixWorld);
  const fromTarget = new THREE.Matrix4().copy(toTarget).invert();
  const p = new THREE.Vector3();
  // A vertex can exhaust `maxPush` and still be inside the target. That is the cap doing its job --
  // an uncapped march walks vertices out the far side -- but it means the clearance this function
  // promises was NOT achieved, and saying nothing there hides exactly the defect the caller asked
  // to be protected from. Measured on the shipped fixture: 2 of 8 sampled hair vertices sat 0.059
  // inside a skull against a 0.04 cap and could never have reached clear.
  let unresolved = 0;

  for (let i = 0; i < position.count; i += 1) {
    p.fromBufferAttribute(position, i).applyMatrix4(toTarget);
    // The spoke is the vertex's own radial direction in the target's frame; marching along it keeps
    // each ring a ring, since every vertex holds its own angle and only its radius changes.
    //
    // A vertex on the axis has no radial direction at all -- and that is precisely the crown, the
    // one place a bald patch is most visible. Skipping it leaves the exact failure this function
    // exists to prevent. So a degenerate spoke marches axially instead, out through whichever cap
    // it is nearer, which is the direction the field itself measures there.
    const spokeLength = Math.hypot(p.x, p.z);
    const onAxis = spokeLength < 1e-9;
    const midHeight = (stack.rings[0][0] + stack.rings[stack.rings.length - 1][0]) / 2;
    const sx = onAxis ? 0 : p.x / spokeLength;
    const sz = onAxis ? 0 : p.z / spokeLength;
    const sy = onAxis ? (p.y >= midHeight ? 1 : -1) : 0;

    let travelled = 0;
    for (let step = 0; step < 24; step += 1) {
      const gap = ringStackDistance(stack, p.x, p.y, p.z);
      if (gap >= clearance) break;
      const move = Math.min(Math.max(0.002, clearance - gap), maxPush - travelled);
      if (move <= 0) break;
      p.x += sx * move;
      p.y += sy * move;
      p.z += sz * move;
      travelled += move;
    }

    if (ringStackDistance(stack, p.x, p.y, p.z) < clearance) unresolved += 1;

    p.applyMatrix4(fromTarget);
    position.setXYZ(i, p.x, p.y, p.z);
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();

  geometry.userData.standProud = { clearance, maxPush, unresolved, total: position.count };
  if (unresolved > 0) {
    console.warn(
      `standProud: ${unresolved}/${position.count} vertices could not reach ${clearance} within ` +
      `maxPush ${maxPush}. They are still inside the target and will render as bare patches. ` +
      `Raise maxPush, or move the component out so it does not start that deep.`,
    );
  }
}

// bevelEnabled defaults to true on THREE.ExtrudeGeometry and rounds every
// corner — sharp/pointed profiles (blades, fork tines, spikes) need
// bevelEnabled: false plus lineTo()-only path segments near the tip, since a
// curve command cannot produce a true converging point.
function buildExtrudeShape(points: [number, number][], holes?: [number, number][][]): THREE.Shape {
  const shape = new THREE.Shape();
  if (points.length > 0) {
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) {
      shape.lineTo(points[i][0], points[i][1]);
    }
  }
  // Cutouts (e.g. an oval wire-cutter hole) as THREE.Path added to shape.holes —
  // dep-free boolean subtraction via the tessellator, no CSG library needed.
  for (const loop of holes ?? []) {
    if (loop.length < 3) continue;
    const path = new THREE.Path();
    path.moveTo(loop[0][0], loop[0][1]);
    for (let i = 1; i < loop.length; i += 1) path.lineTo(loop[i][0], loop[i][1]);
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

// Build an N-gon oval loop (for hole authoring from a compact {cx,cy,rx,ry} descriptor).
function ovalLoop(cx: number, cy: number, rx: number, ry: number, seg = 24): [number, number][] {
  const loop: [number, number][] = [];
  for (let i = 0; i < seg; i += 1) {
    const a = (i / seg) * Math.PI * 2;
    loop.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return loop;
}

function buildExtrudeGeometry(profile: { points: [number, number][]; depth: number; holes?: [number, number][][]; ovalHoles?: { cx: number; cy: number; rx: number; ry: number }[] }): THREE.ExtrudeGeometry {
  const holes = [...(profile.holes ?? []), ...((profile.ovalHoles ?? []).map((o) => ovalLoop(o.cx, o.cy, o.rx, o.ry)))];
  const shape = buildExtrudeShape(profile.points, holes);
  return new THREE.ExtrudeGeometry(shape, {
    depth: profile.depth,
    bevelEnabled: false,
    steps: 1,
  });
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  // setStyle with an explicit SRGBColorSpace, NOT the numeric constructor.
  //
  // `new THREE.Color(r, g, b)` treats its arguments as LINEAR working-space components,
  // while an authored `baseColor` hex is sRGB. Feeding one to the other skipped the
  // transfer function and lifted every dark albedo: #2e2a28, authored as a near-black
  // vinyl, rendered at roughly sRGB 0.46 — a mid grey. The error is largest exactly where
  // it matters most, because the transfer curve is steepest near black.
  return new THREE.Color().setStyle(source, THREE.SRGBColorSpace);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  // A material that declares -- with evidence -- that its subject carries no texture
  // detail gets NO texture set. Synthesising one anyway is not a harmless default: the
  // branch below then forces color to white and roughness to 1 and reads both from the
  // generated maps, so the authored albedo and the reference-derived roughness are both
  // discarded, and the model gains mottling the reference does not have. Measured on the
  // tuxedo cat, whose black fur rendered as speckled grey-and-white from a palette that
  // only ever described two flat regions.
  const textureless = (spec.textureless as { declared?: boolean } | undefined)?.declared === true;
  const textures = textureless
    ? null
    : makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Chibi Twin-Tail Character
// Sculpt build pass: lighting-pass
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createChibiTwinTailCharacterModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Chibi Twin-Tail Character";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40.0, "aspect": 1.0, "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0.0, 0.0, 3.0], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["hidden"] = createSculptMaterial(
    "hidden",
    {"id": "hidden", "name": "Pivot placeholder", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "qualityTier": "utility", "baseColor": "#000000", "color": "#000000", "albedo": {"dominant": "#000000", "secondary": ["#000000"]}, "roughness": {"base": 1.0, "variation": 0.0}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [], "shaderNotes": ["Utility material for the root pivot, which emits no visible surface."]},
    options
  );
  materialMap["skin"] = createSculptMaterial(
    "skin",
    {"id": "skin", "name": "Skin", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "qualityTier": "hero", "baseColor": "#F2DED2", "color": "#F2DED2", "albedo": {"dominant": "#F2DED2", "secondary": ["#D6BAAA", "#E8CFC0"], "samplingNotes": "Sampled from the flat reference regions after excluding the baked shading ramp."}, "colorVariation": {"palette": ["#F2DED2", "#D6BAAA", "#E8CFC0"], "pattern": "flat bounded regions", "amplitude": 0.05, "heightCorrelation": 0.0}, "roughness": {"base": 0.55, "variation": 0.08, "localResponse": "broad low-frequency sheen only; the reference shows no gloss and no strand specular"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.22, "contactShadowBias": 0.3, "notes": "Darken creases where the coat panels meet, where the tails meet the head, and under the belt."}, "localOverrides": [{"id": "toeCapTone", "notes": "Slightly cooler tone at the boot opening, from the reference's occlusion ramp."}], "textureless": {"declared": true, "evidence": ["analysis/zones/zone-r1c1.png shows a single flat skin value with no pores or grain at 1:1", "analysis/crops2/headA.png face skin is one bounded value between the eye ring and the fringe"]}, "shaderNotes": ["Flat-paint subject: the colour regions are bounded by hard edges, so identity lives in geometry and albedo boundaries, not in surface noise.", "The white accents are separate geometry components, never a texture mask."]},
    options
  );
  materialMap["hair-black"] = createSculptMaterial(
    "hair-black",
    {"id": "hair-black", "name": "Hair black", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "qualityTier": "hero", "baseColor": "#141414", "color": "#141414", "albedo": {"dominant": "#141414", "secondary": ["#28282D", "#0C0C0E"], "samplingNotes": "Sampled from the flat reference regions after excluding the baked shading ramp."}, "colorVariation": {"palette": ["#141414", "#28282D", "#0C0C0E"], "pattern": "flat bounded regions", "amplitude": 0.05, "heightCorrelation": 0.0}, "roughness": {"base": 0.82, "variation": 0.08, "localResponse": "broad low-frequency sheen only; the reference shows no gloss and no strand specular"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.22, "contactShadowBias": 0.3, "notes": "Darken creases where the coat panels meet, where the tails meet the head, and under the belt."}, "localOverrides": [{"id": "facetStep", "notes": "Each slab face is one flat value; the step between adjacent facets is the hair's only shading structure."}], "textureless": {"declared": true, "evidence": ["analysis/crops2/headA.png shows flat facet values with hard steps and no strand specular", "analysis/views/back.png confirms the same flat treatment from behind"]}, "shaderNotes": ["Flat-paint subject: the colour regions are bounded by hard edges, so identity lives in geometry and albedo boundaries, not in surface noise.", "The white accents are separate geometry components, never a texture mask."]},
    options
  );
  materialMap["cloth-black"] = createSculptMaterial(
    "cloth-black",
    {"id": "cloth-black", "name": "Garment black", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "qualityTier": "hero", "baseColor": "#131313", "color": "#131313", "albedo": {"dominant": "#131313", "secondary": ["#262626", "#0A0A0A"], "samplingNotes": "Sampled from the flat reference regions after excluding the baked shading ramp."}, "colorVariation": {"palette": ["#131313", "#262626", "#0A0A0A"], "pattern": "flat bounded regions", "amplitude": 0.05, "heightCorrelation": 0.0}, "roughness": {"base": 0.85, "variation": 0.08, "localResponse": "broad low-frequency sheen only; the reference shows no gloss and no strand specular"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.22, "contactShadowBias": 0.3, "notes": "Darken creases where the coat panels meet, where the tails meet the head, and under the belt."}, "localOverrides": [{"id": "panelCrease", "notes": "Roughness rises slightly in the fold between a coat panel and its trim; no other variation is observable."}], "textureless": {"declared": true, "evidence": ["analysis/zones/zone-r1c1.png coat panels are one flat value with a bounded white edge", "analysis/views/side.png sleeve shows only a broad low-frequency sheen"]}, "shaderNotes": ["Flat-paint subject: the colour regions are bounded by hard edges, so identity lives in geometry and albedo boundaries, not in surface noise.", "The white accents are separate geometry components, never a texture mask."]},
    options
  );
  materialMap["trim-white"] = createSculptMaterial(
    "trim-white",
    {"id": "trim-white", "name": "Trim white", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "qualityTier": "hero", "baseColor": "#E9E9E9", "color": "#E9E9E9", "albedo": {"dominant": "#E9E9E9", "secondary": ["#C6C6CC", "#F5F5F5"], "samplingNotes": "Sampled from the flat reference regions after excluding the baked shading ramp."}, "colorVariation": {"palette": ["#E9E9E9", "#C6C6CC", "#F5F5F5"], "pattern": "flat bounded regions", "amplitude": 0.05, "heightCorrelation": 0.0}, "roughness": {"base": 0.8, "variation": 0.08, "localResponse": "broad low-frequency sheen only; the reference shows no gloss and no strand specular"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.22, "contactShadowBias": 0.3, "notes": "Darken creases where the coat panels meet, where the tails meet the head, and under the belt."}, "localOverrides": [{"id": "trimEdge", "notes": "Boundary against the black cloth is a hard edge; there is no bleed and no gradient in the reference."}], "textureless": {"declared": true, "evidence": ["analysis/views/back.png star is a single flat white with a hard five-point boundary", "analysis/zones/zone-r1c1.png belt and trim read the same flat value"]}, "shaderNotes": ["Flat-paint subject: the colour regions are bounded by hard edges, so identity lives in geometry and albedo boundaries, not in surface noise.", "The white accents are separate geometry components, never a texture mask."]},
    options
  );
  materialMap["eye-white"] = createSculptMaterial(
    "eye-white",
    {"id": "eye-white", "name": "Eye white", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "qualityTier": "hero", "baseColor": "#FBFBFB", "color": "#FBFBFB", "albedo": {"dominant": "#FBFBFB", "secondary": ["#E2E7EE"], "samplingNotes": "Sampled from the flat reference regions after excluding the baked shading ramp."}, "colorVariation": {"palette": ["#FBFBFB", "#E2E7EE"], "pattern": "flat bounded regions", "amplitude": 0.05, "heightCorrelation": 0.0}, "roughness": {"base": 0.55, "variation": 0.08, "localResponse": "broad low-frequency sheen only; the reference shows no gloss and no strand specular"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.22, "contactShadowBias": 0.3, "notes": "Darken creases where the coat panels meet, where the tails meet the head, and under the belt."}, "localOverrides": [{"id": "limbalRing", "notes": "Inner edge of the sclera darkens into the ring; that boundary is authored as the ring torus geometry."}], "textureless": {"declared": true, "evidence": ["analysis/crops2/headA.png eye whites are uniform and fully enclosed by the ring", "analysis/measure7.py isolates 2171 and 2250 near-white pixels in two blobs"]}, "shaderNotes": ["Flat-paint subject: the colour regions are bounded by hard edges, so identity lives in geometry and albedo boundaries, not in surface noise.", "The white accents are separate geometry components, never a texture mask."]},
    options
  );
  materialMap["line-black"] = createSculptMaterial(
    "line-black",
    {"id": "line-black", "name": "Line black", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "qualityTier": "hero", "baseColor": "#0A0A0A", "color": "#0A0A0A", "albedo": {"dominant": "#0A0A0A", "secondary": ["#202022"], "samplingNotes": "Sampled from the flat reference regions after excluding the baked shading ramp."}, "colorVariation": {"palette": ["#0A0A0A", "#202022"], "pattern": "flat bounded regions", "amplitude": 0.05, "heightCorrelation": 0.0}, "roughness": {"base": 0.72, "variation": 0.08, "localResponse": "broad low-frequency sheen only; the reference shows no gloss and no strand specular"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.22, "contactShadowBias": 0.3, "notes": "Darken creases where the coat panels meet, where the tails meet the head, and under the belt."}, "localOverrides": [{"id": "chokerSheen", "notes": "The choker shows a marginally tighter highlight than the cloth, its only distinguishing response."}], "textureless": {"declared": true, "evidence": ["analysis/crops2/headA.png eye rings are a flat near-black with no interior variation", "analysis/zones/zone-r0c1.png choker reads as one flat dark band"]}, "shaderNotes": ["Flat-paint subject: the colour regions are bounded by hard edges, so identity lives in geometry and albedo boundaries, not in surface noise.", "The white accents are separate geometry components, never a texture mask."]},
    options
  );
  materialMap["metal-gray"] = createSculptMaterial(
    "metal-gray",
    {"id": "metal-gray", "name": "Hardware", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "qualityTier": "hero", "baseColor": "#B9B9B9", "color": "#B9B9B9", "albedo": {"dominant": "#B9B9B9", "secondary": ["#8C8C92", "#DCDCDC"], "samplingNotes": "Sampled from the flat reference regions after excluding the baked shading ramp."}, "colorVariation": {"palette": ["#B9B9B9", "#8C8C92", "#DCDCDC"], "pattern": "flat bounded regions", "amplitude": 0.05, "heightCorrelation": 0.0}, "roughness": {"base": 0.45, "variation": 0.08, "localResponse": "broad low-frequency sheen only; the reference shows no gloss and no strand specular"}, "metalness": {"base": 0.75, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.22, "contactShadowBias": 0.3, "notes": "Darken creases where the coat panels meet, where the tails meet the head, and under the belt."}, "localOverrides": [{"id": "ringHighlight", "notes": "The choker ring and belt buckle are the only surfaces with a metal highlight in the reference."}], "textureless": {"declared": true, "evidence": ["analysis/zones/zone-r0c1.png choker ring is the only specular element at the throat", "analysis/zones/zone-r1c1.png belt buckle reads brighter than the belt itself"]}, "shaderNotes": ["Flat-paint subject: the colour regions are bounded by hard edges, so identity lives in geometry and albedo boundaries, not in surface noise.", "The white accents are separate geometry components, never a texture mask."]},
    options
  );
  materialMap["sole-gray"] = createSculptMaterial(
    "sole-gray",
    {"id": "sole-gray", "name": "Sole", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "qualityTier": "hero", "baseColor": "#C4C4C8", "color": "#C4C4C8", "albedo": {"dominant": "#C4C4C8", "secondary": ["#96969C"], "samplingNotes": "Sampled from the flat reference regions after excluding the baked shading ramp."}, "colorVariation": {"palette": ["#C4C4C8", "#96969C"], "pattern": "flat bounded regions", "amplitude": 0.05, "heightCorrelation": 0.0}, "roughness": {"base": 0.85, "variation": 0.08, "localResponse": "broad low-frequency sheen only; the reference shows no gloss and no strand specular"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.22, "contactShadowBias": 0.3, "notes": "Darken creases where the coat panels meet, where the tails meet the head, and under the belt."}, "localOverrides": [{"id": "soleEdge", "notes": "Sole edge is a hard boundary against the black boot, with no gradient."}], "textureless": {"declared": true, "evidence": ["analysis/views/side.png shows a flat light wedge under each boot", "analysis/zones/zone-r2c1.png sole reads as one flat mid value"]}, "shaderNotes": ["Flat-paint subject: the colour regions are bounded by hard edges, so identity lives in geometry and albedo boundaries, not in surface noise.", "The white accents are separate geometry components, never a texture mask."]},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_root_0 = makeAttachmentEndpoint(null);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "Character root__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Character root", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.85, "primitive": "box", "topologyClass": "material-only", "topologyRationale": "Root pivot node; carries no visible surface, exists so the whole figure can be transformed as one.", "geometryDescriptor": {"topologyIntent": "Character root as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.001, 0.001, 0.001]}, "actionProfile": {"animationRole": "body", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.01, 0.01, 0.01], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["characterPivot"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "blockout"};
  node_root_0.userData.actionProfile = {"animationRole": "body", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.01, 0.01, 0.01], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_root_0) {
    mesh_root_0Geometry.scale(0.001, 0.001, 0.001);
  }
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["hidden"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Character root";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Character root", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.85, "primitive": "box", "topologyClass": "material-only", "topologyRationale": "Root pivot node; carries no visible surface, exists so the whole figure can be transformed as one.", "geometryDescriptor": {"topologyIntent": "Character root as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.001, 0.001, 0.001]}, "actionProfile": {"animationRole": "body", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.01, 0.01, 0.01], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["characterPivot"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "blockout"};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.01, 0.01, 0.01], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_root_0);

  const endpoint_pelvis_1 = makeAttachmentEndpoint(null);
  const node_pelvis_1 = new THREE.Group();
  node_pelvis_1.name = "Pelvis and shorts__pivot";
  node_pelvis_1.scale.set(1, 1, 1);
  if (endpoint_pelvis_1) {
    node_pelvis_1.position.copy(endpoint_pelvis_1.start);
    node_pelvis_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_pelvis_1.position.set(0.0, 0.3, 0.0);
    node_pelvis_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_pelvis_1.userData.sculptComponent = {"id": "pelvis", "name": "Pelvis and shorts", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a compact chibi pelvis whose widest point is 200 px against a 369 px head, so an ellipsoid 0.235 wide is read, not an adult pelvis.", "geometryDescriptor": {"topologyIntent": "Pelvis and shorts as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "root", "dimensions": {"width": 0.235, "height": 0.155, "depth": 0.215, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, 0.3, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.235, 0.155, 0.215]}, "actionProfile": {"animationRole": "body", "pivot": {"mode": "root", "localPosition": [0.0, 0.3, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.235, 0.155, 0.215], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["shortsHem", "beltLine"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "blockout"};
  node_pelvis_1.userData.actionProfile = {"animationRole": "body", "pivot": {"mode": "root", "localPosition": [0.0, 0.3, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.235, 0.155, 0.215], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_pelvis_1);
  nodes["pelvis"] = node_pelvis_1;
  const mesh_pelvis_1Geometry = endpoint_pelvis_1
    ? new THREE.CylinderGeometry(endpoint_pelvis_1.endRadius, endpoint_pelvis_1.baseRadius, endpoint_pelvis_1.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_pelvis_1) {
    mesh_pelvis_1Geometry.scale(0.235, 0.155, 0.215);
  }
  const mesh_pelvis_1 = new THREE.Mesh(
    mesh_pelvis_1Geometry,
    materialMap["cloth-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pelvis_1.name = "Pelvis and shorts";
  if (endpoint_pelvis_1) {
    mesh_pelvis_1.position.copy(endpoint_pelvis_1.midpoint);
    mesh_pelvis_1.quaternion.copy(endpoint_pelvis_1.quaternion);
  }
  mesh_pelvis_1.castShadow = options.castShadow ?? true;
  mesh_pelvis_1.receiveShadow = options.receiveShadow ?? true;
  mesh_pelvis_1.userData.sculptComponent = {"id": "pelvis", "name": "Pelvis and shorts", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a compact chibi pelvis whose widest point is 200 px against a 369 px head, so an ellipsoid 0.235 wide is read, not an adult pelvis.", "geometryDescriptor": {"topologyIntent": "Pelvis and shorts as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "root", "dimensions": {"width": 0.235, "height": 0.155, "depth": 0.215, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, 0.3, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.235, 0.155, 0.215]}, "actionProfile": {"animationRole": "body", "pivot": {"mode": "root", "localPosition": [0.0, 0.3, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.235, 0.155, 0.215], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["shortsHem", "beltLine"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "blockout"};
  node_pelvis_1.add(mesh_pelvis_1);
  meshes["pelvis"] = mesh_pelvis_1;
  colliders["pelvis"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.235, 0.155, 0.215], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["pelvis"] ??= [];
  destructionGroups["pelvis"].push(node_pelvis_1);

  const endpoint_abdomen_2 = makeAttachmentEndpoint(null);
  const node_abdomen_2 = new THREE.Group();
  node_abdomen_2.name = "Exposed midriff__pivot";
  node_abdomen_2.scale.set(1, 1, 1);
  if (endpoint_abdomen_2) {
    node_abdomen_2.position.copy(endpoint_abdomen_2.start);
    node_abdomen_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_abdomen_2.position.set(0.0, 0.112, 0.0);
    node_abdomen_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_abdomen_2.userData.sculptComponent = {"id": "abdomen", "name": "Exposed midriff", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Measured bare-skin band runs y 626-706 px on the sheet (0.365-0.459 units); it is bounded hard above by the halter top and below by the shorts.", "geometryDescriptor": {"topologyIntent": "Exposed midriff as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "pelvis", "dimensions": {"width": 0.196, "height": 0.155, "depth": 0.185, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, 0.112, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.196, 0.155, 0.185]}, "actionProfile": {"animationRole": "body", "pivot": {"mode": "root", "localPosition": [0.0, 0.112, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.196, 0.155, 0.185], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "abdomen", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 222, 210, 1.0)", "secondaryAlbedo": "rgba(214, 186, 170, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.92, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["navel"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "blockout"};
  node_abdomen_2.userData.actionProfile = {"animationRole": "body", "pivot": {"mode": "root", "localPosition": [0.0, 0.112, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.196, 0.155, 0.185], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "abdomen", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["pelvis"] ?? root).add(node_abdomen_2);
  nodes["abdomen"] = node_abdomen_2;
  const mesh_abdomen_2Geometry = endpoint_abdomen_2
    ? new THREE.CylinderGeometry(endpoint_abdomen_2.endRadius, endpoint_abdomen_2.baseRadius, endpoint_abdomen_2.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_abdomen_2) {
    mesh_abdomen_2Geometry.scale(0.196, 0.155, 0.185);
  }
  const mesh_abdomen_2 = new THREE.Mesh(
    mesh_abdomen_2Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_abdomen_2.name = "Exposed midriff";
  if (endpoint_abdomen_2) {
    mesh_abdomen_2.position.copy(endpoint_abdomen_2.midpoint);
    mesh_abdomen_2.quaternion.copy(endpoint_abdomen_2.quaternion);
  }
  mesh_abdomen_2.castShadow = options.castShadow ?? true;
  mesh_abdomen_2.receiveShadow = options.receiveShadow ?? true;
  mesh_abdomen_2.userData.sculptComponent = {"id": "abdomen", "name": "Exposed midriff", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Measured bare-skin band runs y 626-706 px on the sheet (0.365-0.459 units); it is bounded hard above by the halter top and below by the shorts.", "geometryDescriptor": {"topologyIntent": "Exposed midriff as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "pelvis", "dimensions": {"width": 0.196, "height": 0.155, "depth": 0.185, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, 0.112, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.196, 0.155, 0.185]}, "actionProfile": {"animationRole": "body", "pivot": {"mode": "root", "localPosition": [0.0, 0.112, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.196, 0.155, 0.185], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "abdomen", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 222, 210, 1.0)", "secondaryAlbedo": "rgba(214, 186, 170, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.92, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["navel"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "blockout"};
  node_abdomen_2.add(mesh_abdomen_2);
  meshes["abdomen"] = mesh_abdomen_2;
  colliders["abdomen"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.196, 0.155, 0.185], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["abdomen"] ??= [];
  destructionGroups["abdomen"].push(node_abdomen_2);

  const endpoint_chest_3 = makeAttachmentEndpoint(null);
  const node_chest_3 = new THREE.Group();
  node_chest_3.name = "Ribcage and halter top__pivot";
  node_chest_3.scale.set(1, 1, 1);
  if (endpoint_chest_3) {
    node_chest_3.position.copy(endpoint_chest_3.start);
    node_chest_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_chest_3.position.set(0.0, 0.093, 0.0);
    node_chest_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_chest_3.userData.sculptComponent = {"id": "chest", "name": "Ribcage and halter top", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Shoulder width measured at 242 px = 0.284 units, deliberately narrower than the 0.39 head width, which is the chibi read.", "geometryDescriptor": {"topologyIntent": "Ribcage and halter top as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "abdomen", "dimensions": {"width": 0.284, "height": 0.17, "depth": 0.235, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, 0.093, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.284, 0.17, 0.235]}, "actionProfile": {"animationRole": "body", "pivot": {"mode": "root", "localPosition": [0.0, 0.093, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.284, 0.17, 0.235], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chest", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["halterRing", "sternumSplit"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "blockout"};
  node_chest_3.userData.actionProfile = {"animationRole": "body", "pivot": {"mode": "root", "localPosition": [0.0, 0.093, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.284, 0.17, 0.235], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chest", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["abdomen"] ?? root).add(node_chest_3);
  nodes["chest"] = node_chest_3;
  const mesh_chest_3Geometry = endpoint_chest_3
    ? new THREE.CylinderGeometry(endpoint_chest_3.endRadius, endpoint_chest_3.baseRadius, endpoint_chest_3.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_chest_3) {
    mesh_chest_3Geometry.scale(0.284, 0.17, 0.235);
  }
  const mesh_chest_3 = new THREE.Mesh(
    mesh_chest_3Geometry,
    materialMap["cloth-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_chest_3.name = "Ribcage and halter top";
  if (endpoint_chest_3) {
    mesh_chest_3.position.copy(endpoint_chest_3.midpoint);
    mesh_chest_3.quaternion.copy(endpoint_chest_3.quaternion);
  }
  mesh_chest_3.castShadow = options.castShadow ?? true;
  mesh_chest_3.receiveShadow = options.receiveShadow ?? true;
  mesh_chest_3.userData.sculptComponent = {"id": "chest", "name": "Ribcage and halter top", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Shoulder width measured at 242 px = 0.284 units, deliberately narrower than the 0.39 head width, which is the chibi read.", "geometryDescriptor": {"topologyIntent": "Ribcage and halter top as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "abdomen", "dimensions": {"width": 0.284, "height": 0.17, "depth": 0.235, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, 0.093, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.284, 0.17, 0.235]}, "actionProfile": {"animationRole": "body", "pivot": {"mode": "root", "localPosition": [0.0, 0.093, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.284, 0.17, 0.235], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chest", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["halterRing", "sternumSplit"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "blockout"};
  node_chest_3.add(mesh_chest_3);
  meshes["chest"] = mesh_chest_3;
  colliders["chest"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.284, 0.17, 0.235], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["chest"] ??= [];
  destructionGroups["chest"].push(node_chest_3);

  const attachment_neck_4 = {"parentId": "chest", "parentSocket": "neck-base", "localStart": [0.0, -0.005, 0.0], "localEnd": [0.0, 0.135, 0.0], "contactType": "butt", "embedDepth": 0.012, "overlap": 0.012, "gapTolerance": 0.002, "baseRadius": 0.037, "endRadius": 0.034};
  const endpoint_neck_4 = makeAttachmentEndpoint(attachment_neck_4);
  const node_neck_4 = new THREE.Group();
  node_neck_4.name = "Neck and choker__pivot";
  node_neck_4.scale.set(1, 1, 1);
  if (endpoint_neck_4) {
    node_neck_4.position.copy(endpoint_neck_4.start);
    node_neck_4.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_neck_4.position.set(0.0, -0.005, 0.0);
    node_neck_4.rotation.set(0.0, 0.0, 0.0);
  }
  node_neck_4.userData.sculptComponent = {"id": "neck", "name": "Neck and choker", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Short visible neck column between the collar and the chin.", "geometryDescriptor": {"topologyIntent": "Neck and choker as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "chest", "dimensions": {"width": 0.072, "height": 0.095, "depth": 0.072, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, -0.005, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.072, 0.095, 0.072]}, "actionProfile": {"animationRole": "body", "pivot": {"mode": "root", "localPosition": [0.0, -0.005, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.072, 0.095, 0.072], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 222, 210, 1.0)", "secondaryAlbedo": "rgba(214, 186, 170, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.92, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["chokerRing"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "blockout", "attachment": {"parentId": "chest", "parentSocket": "neck-base", "localStart": [0.0, -0.005, 0.0], "localEnd": [0.0, 0.135, 0.0], "contactType": "butt", "embedDepth": 0.012, "overlap": 0.012, "gapTolerance": 0.002, "baseRadius": 0.037, "endRadius": 0.034}};
  node_neck_4.userData.actionProfile = {"animationRole": "body", "pivot": {"mode": "root", "localPosition": [0.0, -0.005, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.072, 0.095, 0.072], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["chest"] ?? root).add(node_neck_4);
  nodes["neck"] = node_neck_4;
  const mesh_neck_4Geometry = endpoint_neck_4
    ? new THREE.CylinderGeometry(endpoint_neck_4.endRadius, endpoint_neck_4.baseRadius, endpoint_neck_4.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_neck_4) {
    mesh_neck_4Geometry.scale(0.072, 0.095, 0.072);
  }
  const mesh_neck_4 = new THREE.Mesh(
    mesh_neck_4Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_neck_4.name = "Neck and choker";
  if (endpoint_neck_4) {
    mesh_neck_4.position.copy(endpoint_neck_4.midpoint);
    mesh_neck_4.quaternion.copy(endpoint_neck_4.quaternion);
  }
  mesh_neck_4.castShadow = options.castShadow ?? true;
  mesh_neck_4.receiveShadow = options.receiveShadow ?? true;
  mesh_neck_4.userData.sculptComponent = {"id": "neck", "name": "Neck and choker", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Short visible neck column between the collar and the chin.", "geometryDescriptor": {"topologyIntent": "Neck and choker as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "chest", "dimensions": {"width": 0.072, "height": 0.095, "depth": 0.072, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, -0.005, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.072, 0.095, 0.072]}, "actionProfile": {"animationRole": "body", "pivot": {"mode": "root", "localPosition": [0.0, -0.005, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.072, 0.095, 0.072], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 222, 210, 1.0)", "secondaryAlbedo": "rgba(214, 186, 170, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.92, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["chokerRing"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "blockout", "attachment": {"parentId": "chest", "parentSocket": "neck-base", "localStart": [0.0, -0.005, 0.0], "localEnd": [0.0, 0.135, 0.0], "contactType": "butt", "embedDepth": 0.012, "overlap": 0.012, "gapTolerance": 0.002, "baseRadius": 0.037, "endRadius": 0.034}};
  node_neck_4.add(mesh_neck_4);
  meshes["neck"] = mesh_neck_4;
  colliders["neck"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.072, 0.095, 0.072], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_neck_4);

  const endpoint_head_5 = makeAttachmentEndpoint(null);
  const node_head_5 = new THREE.Group();
  node_head_5.name = "Head and face__pivot";
  node_head_5.scale.set(1, 1, 1);
  if (endpoint_head_5) {
    node_head_5.position.copy(endpoint_head_5.start);
    node_head_5.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_head_5.position.set(0.0, 0.29, 0.0);
    node_head_5.rotation.set(0.0, 0.0, 0.0);
  }
  node_head_5.userData.sculptComponent = {"id": "head", "name": "Head and face", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.92, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Measured head+hair block is 369 px wide by 323 px tall on an 852 px figure; the bare skull is that block minus the hair shell, so the skin ellipsoid is set to 0.39 x 0.35 x 0.37.", "geometryDescriptor": {"topologyIntent": "Head and face as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "neck", "dimensions": {"width": 0.37, "height": 0.34, "depth": 0.34, "units": "relative", "confidence": 0.92}, "transform": {"position": [0.0, 0.29, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.37, 0.34, 0.34]}, "actionProfile": {"animationRole": "body", "pivot": {"mode": "root", "localPosition": [0.0, 0.29, 0.0], "axis": [0, 1, 0], "confidence": 0.92}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.37, 0.34, 0.34], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 222, 210, 1.0)", "secondaryAlbedo": "rgba(214, 186, 170, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.92, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["facePlate", "cheekPlane"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "blockout"};
  node_head_5.userData.actionProfile = {"animationRole": "body", "pivot": {"mode": "root", "localPosition": [0.0, 0.29, 0.0], "axis": [0, 1, 0], "confidence": 0.92}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.37, 0.34, 0.34], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["neck"] ?? root).add(node_head_5);
  nodes["head"] = node_head_5;
  const mesh_head_5Geometry = endpoint_head_5
    ? new THREE.CylinderGeometry(endpoint_head_5.endRadius, endpoint_head_5.baseRadius, endpoint_head_5.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_head_5) {
    mesh_head_5Geometry.scale(0.37, 0.34, 0.34);
  }
  const mesh_head_5 = new THREE.Mesh(
    mesh_head_5Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_head_5.name = "Head and face";
  if (endpoint_head_5) {
    mesh_head_5.position.copy(endpoint_head_5.midpoint);
    mesh_head_5.quaternion.copy(endpoint_head_5.quaternion);
  }
  mesh_head_5.castShadow = options.castShadow ?? true;
  mesh_head_5.receiveShadow = options.receiveShadow ?? true;
  mesh_head_5.userData.sculptComponent = {"id": "head", "name": "Head and face", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.92, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Measured head+hair block is 369 px wide by 323 px tall on an 852 px figure; the bare skull is that block minus the hair shell, so the skin ellipsoid is set to 0.39 x 0.35 x 0.37.", "geometryDescriptor": {"topologyIntent": "Head and face as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "neck", "dimensions": {"width": 0.37, "height": 0.34, "depth": 0.34, "units": "relative", "confidence": 0.92}, "transform": {"position": [0.0, 0.29, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.37, 0.34, 0.34]}, "actionProfile": {"animationRole": "body", "pivot": {"mode": "root", "localPosition": [0.0, 0.29, 0.0], "axis": [0, 1, 0], "confidence": 0.92}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.37, 0.34, 0.34], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 222, 210, 1.0)", "secondaryAlbedo": "rgba(214, 186, 170, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.92, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["facePlate", "cheekPlane"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "blockout"};
  node_head_5.add(mesh_head_5);
  meshes["head"] = mesh_head_5;
  colliders["head"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.37, 0.34, 0.34], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["head"] ??= [];
  destructionGroups["head"].push(node_head_5);

  const endpoint_hair_shell_6 = makeAttachmentEndpoint(null);
  const node_hair_shell_6 = new THREE.Group();
  node_hair_shell_6.name = "Faceted hair shell__pivot";
  node_hair_shell_6.scale.set(1, 1, 1);
  if (endpoint_hair_shell_6) {
    node_hair_shell_6.position.copy(endpoint_hair_shell_6.start);
    node_hair_shell_6.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_hair_shell_6.position.set(0.0, 0.098, -0.02);
    node_hair_shell_6.rotation.set(0.0, 0.0, 0.0);
  }
  node_hair_shell_6.userData.sculptComponent = {"id": "hair-shell", "name": "Faceted hair shell", "level": "macro", "role": "shell", "importance": 1.0, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The reference hair is a set of flat cuboid slabs with hard facet-to-facet value steps, not strands; the crown slab is the mass that sits on top of the skull.", "geometryDescriptor": {"topologyIntent": "a flat-topped crown slab carrying the blocky hair read", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.004, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "head", "dimensions": {"width": 0.4, "height": 0.205, "depth": 0.4, "units": "relative", "confidence": 0.9}, "transform": {"position": [0.0, 0.098, -0.02], "rotation": [0.0, 0.0, 0.0], "scale": [0.4, 0.205, 0.4]}, "actionProfile": {"animationRole": "body", "pivot": {"mode": "root", "localPosition": [0.0, 0.098, -0.02], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.4, 0.205, 0.4], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hair-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["crownBlocks", "facetSteps"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "blockout", "standProud": {"againstComponentId": "head", "clearance": 0.006, "maxPush": 0.06}};
  node_hair_shell_6.userData.actionProfile = {"animationRole": "body", "pivot": {"mode": "root", "localPosition": [0.0, 0.098, -0.02], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.4, 0.205, 0.4], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hair-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["head"] ?? root).add(node_hair_shell_6);
  nodes["hair-shell"] = node_hair_shell_6;
  const mesh_hair_shell_6Geometry = endpoint_hair_shell_6
    ? new THREE.CylinderGeometry(endpoint_hair_shell_6.endRadius, endpoint_hair_shell_6.baseRadius, endpoint_hair_shell_6.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_hair_shell_6) {
    mesh_hair_shell_6Geometry.scale(0.4, 0.205, 0.4);
  }
  const mesh_hair_shell_6 = new THREE.Mesh(
    mesh_hair_shell_6Geometry,
    materialMap["hair-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hair_shell_6.name = "Faceted hair shell";
  if (endpoint_hair_shell_6) {
    mesh_hair_shell_6.position.copy(endpoint_hair_shell_6.midpoint);
    mesh_hair_shell_6.quaternion.copy(endpoint_hair_shell_6.quaternion);
  }
  mesh_hair_shell_6.castShadow = options.castShadow ?? true;
  mesh_hair_shell_6.receiveShadow = options.receiveShadow ?? true;
  mesh_hair_shell_6.userData.sculptComponent = {"id": "hair-shell", "name": "Faceted hair shell", "level": "macro", "role": "shell", "importance": 1.0, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The reference hair is a set of flat cuboid slabs with hard facet-to-facet value steps, not strands; the crown slab is the mass that sits on top of the skull.", "geometryDescriptor": {"topologyIntent": "a flat-topped crown slab carrying the blocky hair read", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.004, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "head", "dimensions": {"width": 0.4, "height": 0.205, "depth": 0.4, "units": "relative", "confidence": 0.9}, "transform": {"position": [0.0, 0.098, -0.02], "rotation": [0.0, 0.0, 0.0], "scale": [0.4, 0.205, 0.4]}, "actionProfile": {"animationRole": "body", "pivot": {"mode": "root", "localPosition": [0.0, 0.098, -0.02], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.4, 0.205, 0.4], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hair-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["crownBlocks", "facetSteps"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "blockout", "standProud": {"againstComponentId": "head", "clearance": 0.006, "maxPush": 0.06}};
  node_hair_shell_6.add(mesh_hair_shell_6);
  meshes["hair-shell"] = mesh_hair_shell_6;
  colliders["hair-shell"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.4, 0.205, 0.4], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["hair-shell"] ??= [];
  destructionGroups["hair-shell"].push(node_hair_shell_6);

  const endpoint_coat_7 = makeAttachmentEndpoint(null);
  const node_coat_7 = new THREE.Group();
  node_coat_7.name = "Open coat__pivot";
  node_coat_7.scale.set(1, 1, 1);
  if (endpoint_coat_7) {
    node_coat_7.position.copy(endpoint_coat_7.start);
    node_coat_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_coat_7.position.set(0.0, -0.11, 0.0);
    node_coat_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_coat_7.userData.sculptComponent = {"id": "coat", "name": "Open coat", "level": "macro", "role": "garment", "importance": 0.95, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Panel-coloured garment whose white trim runs the full perimeter of every panel; authored as an open shell around the torso rather than a closed volume.", "geometryDescriptor": {"topologyIntent": "Open coat as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "chest", "dimensions": {"width": 0.3, "height": 0.44, "depth": 0.03, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, -0.11, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.3, 0.44, 0.03]}, "actionProfile": {"animationRole": "body", "pivot": {"mode": "root", "localPosition": [0.0, -0.11, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.3, 0.44, 0.03], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coat", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["trimChain", "backStar", "coatOpening", "hemLine"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "blockout"};
  node_coat_7.userData.actionProfile = {"animationRole": "body", "pivot": {"mode": "root", "localPosition": [0.0, -0.11, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.3, 0.44, 0.03], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coat", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["chest"] ?? root).add(node_coat_7);
  nodes["coat"] = node_coat_7;
  const mesh_coat_7Geometry = endpoint_coat_7
    ? new THREE.CylinderGeometry(endpoint_coat_7.endRadius, endpoint_coat_7.baseRadius, endpoint_coat_7.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_coat_7) {
    mesh_coat_7Geometry.scale(0.3, 0.44, 0.03);
  }
  const mesh_coat_7 = new THREE.Mesh(
    mesh_coat_7Geometry,
    materialMap["cloth-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_coat_7.name = "Open coat";
  if (endpoint_coat_7) {
    mesh_coat_7.position.copy(endpoint_coat_7.midpoint);
    mesh_coat_7.quaternion.copy(endpoint_coat_7.quaternion);
  }
  mesh_coat_7.castShadow = options.castShadow ?? true;
  mesh_coat_7.receiveShadow = options.receiveShadow ?? true;
  mesh_coat_7.userData.sculptComponent = {"id": "coat", "name": "Open coat", "level": "macro", "role": "garment", "importance": 0.95, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Panel-coloured garment whose white trim runs the full perimeter of every panel; authored as an open shell around the torso rather than a closed volume.", "geometryDescriptor": {"topologyIntent": "Open coat as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "chest", "dimensions": {"width": 0.3, "height": 0.44, "depth": 0.03, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, -0.11, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.3, 0.44, 0.03]}, "actionProfile": {"animationRole": "body", "pivot": {"mode": "root", "localPosition": [0.0, -0.11, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.3, 0.44, 0.03], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coat", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["trimChain", "backStar", "coatOpening", "hemLine"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "blockout"};
  node_coat_7.add(mesh_coat_7);
  meshes["coat"] = mesh_coat_7;
  colliders["coat"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.3, 0.44, 0.03], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["coat"] ??= [];
  destructionGroups["coat"].push(node_coat_7);

  const endpoint_tail_l_8 = makeAttachmentEndpoint(null);
  const node_tail_l_8 = new THREE.Group();
  node_tail_l_8.name = "Twin tail (character's left)__pivot";
  node_tail_l_8.scale.set(1, 1, 1);
  if (endpoint_tail_l_8) {
    node_tail_l_8.position.copy(endpoint_tail_l_8.start);
    node_tail_l_8.rotation.set(0.0, 0.0, 0.16);
  } else {
    node_tail_l_8.position.set(0.285, -0.315, -0.02);
    node_tail_l_8.rotation.set(0.0, 0.0, 0.16);
  }
  node_tail_l_8.userData.sculptComponent = {"id": "tail-l", "name": "Twin tail (character's left)", "level": "macro", "role": "shell", "importance": 0.8, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Front view is thin through the tail's screen-x while the rear view is thinner still through screen-y; the section reads as a flattened ribbon, confidence 0.55 as recorded in the assessment.", "geometryDescriptor": {"topologyIntent": "a flattened rectilinear ribbon of stacked angular slabs", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "head", "dimensions": {"width": 0.15, "height": 0.46, "depth": 0.11, "units": "relative", "confidence": 0.75}, "transform": {"position": [0.285, -0.315, -0.02], "rotation": [0.0, 0.0, 0.16], "scale": [0.15, 0.46, 0.11]}, "actionProfile": {"animationRole": "body", "pivot": {"mode": "root", "localPosition": [0.285, -0.315, -0.02], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.46, 0.11], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["slabChain", "distalFan"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "blockout", "standProud": {"againstComponentId": "head", "clearance": 0.004, "maxPush": 0.05}, "attachment": {"parentId": "head", "parentSocket": "tail-l-socket", "localStart": [0.285, -0.545, -0.02], "localEnd": [0.285, -0.085, -0.02], "contactType": "socket", "embedDepth": 0.015, "overlap": 0.015, "gapTolerance": 0.002}};
  node_tail_l_8.userData.actionProfile = {"animationRole": "body", "pivot": {"mode": "root", "localPosition": [0.285, -0.315, -0.02], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.46, 0.11], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["head"] ?? root).add(node_tail_l_8);
  nodes["tail-l"] = node_tail_l_8;
  const mesh_tail_l_8Geometry = endpoint_tail_l_8
    ? new THREE.CylinderGeometry(endpoint_tail_l_8.endRadius, endpoint_tail_l_8.baseRadius, endpoint_tail_l_8.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_tail_l_8) {
    mesh_tail_l_8Geometry.scale(0.15, 0.46, 0.11);
  }
  const mesh_tail_l_8 = new THREE.Mesh(
    mesh_tail_l_8Geometry,
    materialMap["hair-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tail_l_8.name = "Twin tail (character's left)";
  if (endpoint_tail_l_8) {
    mesh_tail_l_8.position.copy(endpoint_tail_l_8.midpoint);
    mesh_tail_l_8.quaternion.copy(endpoint_tail_l_8.quaternion);
  }
  mesh_tail_l_8.castShadow = options.castShadow ?? true;
  mesh_tail_l_8.receiveShadow = options.receiveShadow ?? true;
  mesh_tail_l_8.userData.sculptComponent = {"id": "tail-l", "name": "Twin tail (character's left)", "level": "macro", "role": "shell", "importance": 0.8, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Front view is thin through the tail's screen-x while the rear view is thinner still through screen-y; the section reads as a flattened ribbon, confidence 0.55 as recorded in the assessment.", "geometryDescriptor": {"topologyIntent": "a flattened rectilinear ribbon of stacked angular slabs", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "head", "dimensions": {"width": 0.15, "height": 0.46, "depth": 0.11, "units": "relative", "confidence": 0.75}, "transform": {"position": [0.285, -0.315, -0.02], "rotation": [0.0, 0.0, 0.16], "scale": [0.15, 0.46, 0.11]}, "actionProfile": {"animationRole": "body", "pivot": {"mode": "root", "localPosition": [0.285, -0.315, -0.02], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.46, 0.11], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["slabChain", "distalFan"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "blockout", "standProud": {"againstComponentId": "head", "clearance": 0.004, "maxPush": 0.05}, "attachment": {"parentId": "head", "parentSocket": "tail-l-socket", "localStart": [0.285, -0.545, -0.02], "localEnd": [0.285, -0.085, -0.02], "contactType": "socket", "embedDepth": 0.015, "overlap": 0.015, "gapTolerance": 0.002}};
  node_tail_l_8.add(mesh_tail_l_8);
  meshes["tail-l"] = mesh_tail_l_8;
  colliders["tail-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.46, 0.11], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["tail-l"] ??= [];
  destructionGroups["tail-l"].push(node_tail_l_8);

  const endpoint_tail_r_9 = makeAttachmentEndpoint(null);
  const node_tail_r_9 = new THREE.Group();
  node_tail_r_9.name = "Twin tail (character's right)__pivot";
  node_tail_r_9.scale.set(1, 1, 1);
  if (endpoint_tail_r_9) {
    node_tail_r_9.position.copy(endpoint_tail_r_9.start);
    node_tail_r_9.rotation.set(0.0, 0.0, -0.16);
  } else {
    node_tail_r_9.position.set(-0.285, -0.315, -0.02);
    node_tail_r_9.rotation.set(0.0, 0.0, -0.16);
  }
  node_tail_r_9.userData.sculptComponent = {"id": "tail-r", "name": "Twin tail (character's right)", "level": "macro", "role": "shell", "importance": 0.8, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Exact mirror of the left tail: (x, y, z) -> (-x, y, z), never a rotation.", "geometryDescriptor": {"topologyIntent": "a flattened rectilinear ribbon of stacked angular slabs, mirrored", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "head", "dimensions": {"width": 0.15, "height": 0.46, "depth": 0.11, "units": "relative", "confidence": 0.75}, "transform": {"position": [-0.285, -0.315, -0.02], "rotation": [0.0, 0.0, -0.16], "scale": [0.15, 0.46, 0.11]}, "actionProfile": {"animationRole": "body", "pivot": {"mode": "root", "localPosition": [-0.285, -0.315, -0.02], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.46, 0.11], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["slabChain", "distalFan"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "blockout", "standProud": {"againstComponentId": "head", "clearance": 0.004, "maxPush": 0.05}, "attachment": {"parentId": "head", "parentSocket": "tail-r-socket", "localStart": [-0.285, -0.545, -0.02], "localEnd": [-0.285, -0.085, -0.02], "contactType": "socket", "embedDepth": 0.015, "overlap": 0.015, "gapTolerance": 0.002}};
  node_tail_r_9.userData.actionProfile = {"animationRole": "body", "pivot": {"mode": "root", "localPosition": [-0.285, -0.315, -0.02], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.46, 0.11], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["head"] ?? root).add(node_tail_r_9);
  nodes["tail-r"] = node_tail_r_9;
  const mesh_tail_r_9Geometry = endpoint_tail_r_9
    ? new THREE.CylinderGeometry(endpoint_tail_r_9.endRadius, endpoint_tail_r_9.baseRadius, endpoint_tail_r_9.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_tail_r_9) {
    mesh_tail_r_9Geometry.scale(0.15, 0.46, 0.11);
  }
  const mesh_tail_r_9 = new THREE.Mesh(
    mesh_tail_r_9Geometry,
    materialMap["hair-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tail_r_9.name = "Twin tail (character's right)";
  if (endpoint_tail_r_9) {
    mesh_tail_r_9.position.copy(endpoint_tail_r_9.midpoint);
    mesh_tail_r_9.quaternion.copy(endpoint_tail_r_9.quaternion);
  }
  mesh_tail_r_9.castShadow = options.castShadow ?? true;
  mesh_tail_r_9.receiveShadow = options.receiveShadow ?? true;
  mesh_tail_r_9.userData.sculptComponent = {"id": "tail-r", "name": "Twin tail (character's right)", "level": "macro", "role": "shell", "importance": 0.8, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Exact mirror of the left tail: (x, y, z) -> (-x, y, z), never a rotation.", "geometryDescriptor": {"topologyIntent": "a flattened rectilinear ribbon of stacked angular slabs, mirrored", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "head", "dimensions": {"width": 0.15, "height": 0.46, "depth": 0.11, "units": "relative", "confidence": 0.75}, "transform": {"position": [-0.285, -0.315, -0.02], "rotation": [0.0, 0.0, -0.16], "scale": [0.15, 0.46, 0.11]}, "actionProfile": {"animationRole": "body", "pivot": {"mode": "root", "localPosition": [-0.285, -0.315, -0.02], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.46, 0.11], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["slabChain", "distalFan"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "blockout", "standProud": {"againstComponentId": "head", "clearance": 0.004, "maxPush": 0.05}, "attachment": {"parentId": "head", "parentSocket": "tail-r-socket", "localStart": [-0.285, -0.545, -0.02], "localEnd": [-0.285, -0.085, -0.02], "contactType": "socket", "embedDepth": 0.015, "overlap": 0.015, "gapTolerance": 0.002}};
  node_tail_r_9.add(mesh_tail_r_9);
  meshes["tail-r"] = mesh_tail_r_9;
  colliders["tail-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.46, 0.11], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["tail-r"] ??= [];
  destructionGroups["tail-r"].push(node_tail_r_9);

  const attachment_eye_white_l_10 = {"parentId": "head", "parentSocket": "eye-plate-l", "localStart": [0.0827, -0.086, 0.118], "localEnd": [0.0827, -0.086, 0.138], "contactType": "embed", "embedDepth": 0.006, "overlap": 0.006, "gapTolerance": 0.002, "baseRadius": 0.0365, "endRadius": 0.0365};
  const endpoint_eye_white_l_10 = makeAttachmentEndpoint(attachment_eye_white_l_10);
  const node_eye_white_l_10 = new THREE.Group();
  node_eye_white_l_10.name = "Eye sclera (l)__pivot";
  node_eye_white_l_10.scale.set(1, 1, 1);
  if (endpoint_eye_white_l_10) {
    node_eye_white_l_10.position.copy(endpoint_eye_white_l_10.start);
    node_eye_white_l_10.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_eye_white_l_10.position.set(0.0827, -0.086, 0.118);
    node_eye_white_l_10.rotation.set(0.0, 0.0, 0.0);
  }
  node_eye_white_l_10.userData.sculptComponent = {"id": "eye-white-l", "name": "Eye sclera (l)", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.95, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Eye white blob located at (356, 417) and (497, 417) px, 62 px diameter = 0.0728 units: a disc, with no iris and no pupil anywhere in the reference.", "geometryDescriptor": {"topologyIntent": "a blank white disc seated on the face plane", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "dimensions": {"width": 0.073, "height": 0.022, "depth": 0.073, "units": "relative", "confidence": 0.95}, "transform": {"position": [0.0827, -0.086, 0.118], "rotation": [0.0, 0.0, 0.0], "scale": [0.073, 0.022, 0.073]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0827, -0.086, 0.118], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.073, 0.022, 0.073], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-white-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "eye-white", "materialLayers": ["eye-white"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(251, 251, 251, 1.0)", "secondaryAlbedo": "rgba(226, 231, 238, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["blankSclera"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "head", "parentSocket": "eye-plate-l", "localStart": [0.0827, -0.086, 0.118], "localEnd": [0.0827, -0.086, 0.138], "contactType": "embed", "embedDepth": 0.006, "overlap": 0.006, "gapTolerance": 0.002, "baseRadius": 0.0365, "endRadius": 0.0365}};
  node_eye_white_l_10.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0827, -0.086, 0.118], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.073, 0.022, 0.073], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-white-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["head"] ?? root).add(node_eye_white_l_10);
  nodes["eye-white-l"] = node_eye_white_l_10;
  const mesh_eye_white_l_10Geometry = endpoint_eye_white_l_10
    ? new THREE.CylinderGeometry(endpoint_eye_white_l_10.endRadius, endpoint_eye_white_l_10.baseRadius, endpoint_eye_white_l_10.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_eye_white_l_10) {
    mesh_eye_white_l_10Geometry.scale(0.073, 0.022, 0.073);
  }
  const mesh_eye_white_l_10 = new THREE.Mesh(
    mesh_eye_white_l_10Geometry,
    materialMap["eye-white"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_eye_white_l_10.name = "Eye sclera (l)";
  if (endpoint_eye_white_l_10) {
    mesh_eye_white_l_10.position.copy(endpoint_eye_white_l_10.midpoint);
    mesh_eye_white_l_10.quaternion.copy(endpoint_eye_white_l_10.quaternion);
  }
  mesh_eye_white_l_10.castShadow = options.castShadow ?? true;
  mesh_eye_white_l_10.receiveShadow = options.receiveShadow ?? true;
  mesh_eye_white_l_10.userData.sculptComponent = {"id": "eye-white-l", "name": "Eye sclera (l)", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.95, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Eye white blob located at (356, 417) and (497, 417) px, 62 px diameter = 0.0728 units: a disc, with no iris and no pupil anywhere in the reference.", "geometryDescriptor": {"topologyIntent": "a blank white disc seated on the face plane", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "dimensions": {"width": 0.073, "height": 0.022, "depth": 0.073, "units": "relative", "confidence": 0.95}, "transform": {"position": [0.0827, -0.086, 0.118], "rotation": [0.0, 0.0, 0.0], "scale": [0.073, 0.022, 0.073]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0827, -0.086, 0.118], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.073, 0.022, 0.073], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-white-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "eye-white", "materialLayers": ["eye-white"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(251, 251, 251, 1.0)", "secondaryAlbedo": "rgba(226, 231, 238, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["blankSclera"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "head", "parentSocket": "eye-plate-l", "localStart": [0.0827, -0.086, 0.118], "localEnd": [0.0827, -0.086, 0.138], "contactType": "embed", "embedDepth": 0.006, "overlap": 0.006, "gapTolerance": 0.002, "baseRadius": 0.0365, "endRadius": 0.0365}};
  node_eye_white_l_10.add(mesh_eye_white_l_10);
  meshes["eye-white-l"] = mesh_eye_white_l_10;
  colliders["eye-white-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.073, 0.022, 0.073], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["eye-white-l"] ??= [];
  destructionGroups["eye-white-l"].push(node_eye_white_l_10);

  const endpoint_eye_ring_l_11 = makeAttachmentEndpoint(null);
  const node_eye_ring_l_11 = new THREE.Group();
  node_eye_ring_l_11.name = "Eye limbal ring (l)__pivot";
  node_eye_ring_l_11.scale.set(1, 1, 1);
  if (endpoint_eye_ring_l_11) {
    node_eye_ring_l_11.position.copy(endpoint_eye_ring_l_11.start);
    node_eye_ring_l_11.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_eye_ring_l_11.position.set(0.0827, -0.086, 0.142);
    node_eye_ring_l_11.rotation.set(0.0, 0.0, 0.0);
  }
  node_eye_ring_l_11.userData.sculptComponent = {"id": "eye-ring-l", "name": "Eye limbal ring (l)", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.93, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "The ring is roughly 13% of the eye's diameter - about 8 px at reference scale - and is the feature that makes the eye read as blank rather than empty.", "geometryDescriptor": {"topologyIntent": "a thick black ring enclosing the sclera", "torusTubeRatio": 0.128, "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "dimensions": {"width": 0.0867, "height": 0.0867, "depth": 0.0867, "units": "relative", "confidence": 0.93}, "transform": {"position": [0.0827, -0.086, 0.142], "rotation": [0.0, 0.0, 0.0], "scale": [0.0867, 0.0867, 0.0867]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0827, -0.086, 0.142], "axis": [0, 1, 0], "confidence": 0.93}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.0867, 0.0867, 0.0867], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-ring-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "line-black", "materialLayers": ["line-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(10, 10, 10, 1.0)", "secondaryAlbedo": "rgba(32, 32, 34, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["limbalRing"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_eye_ring_l_11.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0827, -0.086, 0.142], "axis": [0, 1, 0], "confidence": 0.93}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.0867, 0.0867, 0.0867], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-ring-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["head"] ?? root).add(node_eye_ring_l_11);
  nodes["eye-ring-l"] = node_eye_ring_l_11;
  const mesh_eye_ring_l_11Geometry = endpoint_eye_ring_l_11
    ? new THREE.CylinderGeometry(endpoint_eye_ring_l_11.endRadius, endpoint_eye_ring_l_11.baseRadius, endpoint_eye_ring_l_11.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.0576, 24, 96);
  if (!endpoint_eye_ring_l_11) {
    mesh_eye_ring_l_11Geometry.scale(0.0867, 0.0867, 0.0867);
  }
  const mesh_eye_ring_l_11 = new THREE.Mesh(
    mesh_eye_ring_l_11Geometry,
    materialMap["line-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_eye_ring_l_11.name = "Eye limbal ring (l)";
  if (endpoint_eye_ring_l_11) {
    mesh_eye_ring_l_11.position.copy(endpoint_eye_ring_l_11.midpoint);
    mesh_eye_ring_l_11.quaternion.copy(endpoint_eye_ring_l_11.quaternion);
  }
  mesh_eye_ring_l_11.castShadow = options.castShadow ?? true;
  mesh_eye_ring_l_11.receiveShadow = options.receiveShadow ?? true;
  mesh_eye_ring_l_11.userData.sculptComponent = {"id": "eye-ring-l", "name": "Eye limbal ring (l)", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.93, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "The ring is roughly 13% of the eye's diameter - about 8 px at reference scale - and is the feature that makes the eye read as blank rather than empty.", "geometryDescriptor": {"topologyIntent": "a thick black ring enclosing the sclera", "torusTubeRatio": 0.128, "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "dimensions": {"width": 0.0867, "height": 0.0867, "depth": 0.0867, "units": "relative", "confidence": 0.93}, "transform": {"position": [0.0827, -0.086, 0.142], "rotation": [0.0, 0.0, 0.0], "scale": [0.0867, 0.0867, 0.0867]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0827, -0.086, 0.142], "axis": [0, 1, 0], "confidence": 0.93}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.0867, 0.0867, 0.0867], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-ring-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "line-black", "materialLayers": ["line-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(10, 10, 10, 1.0)", "secondaryAlbedo": "rgba(32, 32, 34, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["limbalRing"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_eye_ring_l_11.add(mesh_eye_ring_l_11);
  meshes["eye-ring-l"] = mesh_eye_ring_l_11;
  colliders["eye-ring-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.0867, 0.0867, 0.0867], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["eye-ring-l"] ??= [];
  destructionGroups["eye-ring-l"].push(node_eye_ring_l_11);

  const attachment_eye_white_r_12 = {"parentId": "head", "parentSocket": "eye-plate-r", "localStart": [-0.0827, -0.086, 0.118], "localEnd": [-0.0827, -0.086, 0.138], "contactType": "embed", "embedDepth": 0.006, "overlap": 0.006, "gapTolerance": 0.002, "baseRadius": 0.0365, "endRadius": 0.0365};
  const endpoint_eye_white_r_12 = makeAttachmentEndpoint(attachment_eye_white_r_12);
  const node_eye_white_r_12 = new THREE.Group();
  node_eye_white_r_12.name = "Eye sclera (r)__pivot";
  node_eye_white_r_12.scale.set(1, 1, 1);
  if (endpoint_eye_white_r_12) {
    node_eye_white_r_12.position.copy(endpoint_eye_white_r_12.start);
    node_eye_white_r_12.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_eye_white_r_12.position.set(-0.0827, -0.086, 0.118);
    node_eye_white_r_12.rotation.set(0.0, 0.0, 0.0);
  }
  node_eye_white_r_12.userData.sculptComponent = {"id": "eye-white-r", "name": "Eye sclera (r)", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.95, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Eye white blob located at (356, 417) and (497, 417) px, 62 px diameter = 0.0728 units: a disc, with no iris and no pupil anywhere in the reference.", "geometryDescriptor": {"topologyIntent": "a blank white disc seated on the face plane", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "dimensions": {"width": 0.073, "height": 0.022, "depth": 0.073, "units": "relative", "confidence": 0.95}, "transform": {"position": [-0.0827, -0.086, 0.118], "rotation": [0.0, 0.0, 0.0], "scale": [0.073, 0.022, 0.073]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.0827, -0.086, 0.118], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.073, 0.022, 0.073], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-white-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "eye-white", "materialLayers": ["eye-white"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(251, 251, 251, 1.0)", "secondaryAlbedo": "rgba(226, 231, 238, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["blankSclera"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "head", "parentSocket": "eye-plate-r", "localStart": [-0.0827, -0.086, 0.118], "localEnd": [-0.0827, -0.086, 0.138], "contactType": "embed", "embedDepth": 0.006, "overlap": 0.006, "gapTolerance": 0.002, "baseRadius": 0.0365, "endRadius": 0.0365}};
  node_eye_white_r_12.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.0827, -0.086, 0.118], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.073, 0.022, 0.073], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-white-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["head"] ?? root).add(node_eye_white_r_12);
  nodes["eye-white-r"] = node_eye_white_r_12;
  const mesh_eye_white_r_12Geometry = endpoint_eye_white_r_12
    ? new THREE.CylinderGeometry(endpoint_eye_white_r_12.endRadius, endpoint_eye_white_r_12.baseRadius, endpoint_eye_white_r_12.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_eye_white_r_12) {
    mesh_eye_white_r_12Geometry.scale(0.073, 0.022, 0.073);
  }
  const mesh_eye_white_r_12 = new THREE.Mesh(
    mesh_eye_white_r_12Geometry,
    materialMap["eye-white"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_eye_white_r_12.name = "Eye sclera (r)";
  if (endpoint_eye_white_r_12) {
    mesh_eye_white_r_12.position.copy(endpoint_eye_white_r_12.midpoint);
    mesh_eye_white_r_12.quaternion.copy(endpoint_eye_white_r_12.quaternion);
  }
  mesh_eye_white_r_12.castShadow = options.castShadow ?? true;
  mesh_eye_white_r_12.receiveShadow = options.receiveShadow ?? true;
  mesh_eye_white_r_12.userData.sculptComponent = {"id": "eye-white-r", "name": "Eye sclera (r)", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.95, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Eye white blob located at (356, 417) and (497, 417) px, 62 px diameter = 0.0728 units: a disc, with no iris and no pupil anywhere in the reference.", "geometryDescriptor": {"topologyIntent": "a blank white disc seated on the face plane", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "dimensions": {"width": 0.073, "height": 0.022, "depth": 0.073, "units": "relative", "confidence": 0.95}, "transform": {"position": [-0.0827, -0.086, 0.118], "rotation": [0.0, 0.0, 0.0], "scale": [0.073, 0.022, 0.073]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.0827, -0.086, 0.118], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.073, 0.022, 0.073], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-white-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "eye-white", "materialLayers": ["eye-white"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(251, 251, 251, 1.0)", "secondaryAlbedo": "rgba(226, 231, 238, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["blankSclera"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "head", "parentSocket": "eye-plate-r", "localStart": [-0.0827, -0.086, 0.118], "localEnd": [-0.0827, -0.086, 0.138], "contactType": "embed", "embedDepth": 0.006, "overlap": 0.006, "gapTolerance": 0.002, "baseRadius": 0.0365, "endRadius": 0.0365}};
  node_eye_white_r_12.add(mesh_eye_white_r_12);
  meshes["eye-white-r"] = mesh_eye_white_r_12;
  colliders["eye-white-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.073, 0.022, 0.073], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["eye-white-r"] ??= [];
  destructionGroups["eye-white-r"].push(node_eye_white_r_12);

  const endpoint_eye_ring_r_13 = makeAttachmentEndpoint(null);
  const node_eye_ring_r_13 = new THREE.Group();
  node_eye_ring_r_13.name = "Eye limbal ring (r)__pivot";
  node_eye_ring_r_13.scale.set(1, 1, 1);
  if (endpoint_eye_ring_r_13) {
    node_eye_ring_r_13.position.copy(endpoint_eye_ring_r_13.start);
    node_eye_ring_r_13.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_eye_ring_r_13.position.set(-0.0827, -0.086, 0.142);
    node_eye_ring_r_13.rotation.set(0.0, 0.0, 0.0);
  }
  node_eye_ring_r_13.userData.sculptComponent = {"id": "eye-ring-r", "name": "Eye limbal ring (r)", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.93, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "The ring is roughly 13% of the eye's diameter - about 8 px at reference scale - and is the feature that makes the eye read as blank rather than empty.", "geometryDescriptor": {"topologyIntent": "a thick black ring enclosing the sclera", "torusTubeRatio": 0.128, "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "dimensions": {"width": 0.0867, "height": 0.0867, "depth": 0.0867, "units": "relative", "confidence": 0.93}, "transform": {"position": [-0.0827, -0.086, 0.142], "rotation": [0.0, 0.0, 0.0], "scale": [0.0867, 0.0867, 0.0867]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.0827, -0.086, 0.142], "axis": [0, 1, 0], "confidence": 0.93}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.0867, 0.0867, 0.0867], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-ring-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "line-black", "materialLayers": ["line-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(10, 10, 10, 1.0)", "secondaryAlbedo": "rgba(32, 32, 34, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["limbalRing"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_eye_ring_r_13.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.0827, -0.086, 0.142], "axis": [0, 1, 0], "confidence": 0.93}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.0867, 0.0867, 0.0867], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-ring-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["head"] ?? root).add(node_eye_ring_r_13);
  nodes["eye-ring-r"] = node_eye_ring_r_13;
  const mesh_eye_ring_r_13Geometry = endpoint_eye_ring_r_13
    ? new THREE.CylinderGeometry(endpoint_eye_ring_r_13.endRadius, endpoint_eye_ring_r_13.baseRadius, endpoint_eye_ring_r_13.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.0576, 24, 96);
  if (!endpoint_eye_ring_r_13) {
    mesh_eye_ring_r_13Geometry.scale(0.0867, 0.0867, 0.0867);
  }
  const mesh_eye_ring_r_13 = new THREE.Mesh(
    mesh_eye_ring_r_13Geometry,
    materialMap["line-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_eye_ring_r_13.name = "Eye limbal ring (r)";
  if (endpoint_eye_ring_r_13) {
    mesh_eye_ring_r_13.position.copy(endpoint_eye_ring_r_13.midpoint);
    mesh_eye_ring_r_13.quaternion.copy(endpoint_eye_ring_r_13.quaternion);
  }
  mesh_eye_ring_r_13.castShadow = options.castShadow ?? true;
  mesh_eye_ring_r_13.receiveShadow = options.receiveShadow ?? true;
  mesh_eye_ring_r_13.userData.sculptComponent = {"id": "eye-ring-r", "name": "Eye limbal ring (r)", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.93, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "The ring is roughly 13% of the eye's diameter - about 8 px at reference scale - and is the feature that makes the eye read as blank rather than empty.", "geometryDescriptor": {"topologyIntent": "a thick black ring enclosing the sclera", "torusTubeRatio": 0.128, "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "dimensions": {"width": 0.0867, "height": 0.0867, "depth": 0.0867, "units": "relative", "confidence": 0.93}, "transform": {"position": [-0.0827, -0.086, 0.142], "rotation": [0.0, 0.0, 0.0], "scale": [0.0867, 0.0867, 0.0867]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.0827, -0.086, 0.142], "axis": [0, 1, 0], "confidence": 0.93}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.0867, 0.0867, 0.0867], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-ring-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "line-black", "materialLayers": ["line-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(10, 10, 10, 1.0)", "secondaryAlbedo": "rgba(32, 32, 34, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["limbalRing"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_eye_ring_r_13.add(mesh_eye_ring_r_13);
  meshes["eye-ring-r"] = mesh_eye_ring_r_13;
  colliders["eye-ring-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.0867, 0.0867, 0.0867], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["eye-ring-r"] ??= [];
  destructionGroups["eye-ring-r"].push(node_eye_ring_r_13);

  const endpoint_mouth_14 = makeAttachmentEndpoint(null);
  const node_mouth_14 = new THREE.Group();
  node_mouth_14.name = "Mouth line__pivot";
  node_mouth_14.scale.set(1, 1, 1);
  if (endpoint_mouth_14) {
    node_mouth_14.position.copy(endpoint_mouth_14.start);
    node_mouth_14.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_mouth_14.position.set(0.0, -0.142, 0.1);
    node_mouth_14.rotation.set(0.0, 0.0, 0.0);
  }
  node_mouth_14.userData.sculptComponent = {"id": "mouth", "name": "Mouth line", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A short horizontal dark line at 0.93 of the head box, below the eye line.", "geometryDescriptor": {"topologyIntent": "Mouth line as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "head", "dimensions": {"width": 0.045, "height": 0.007, "depth": 0.012, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, -0.142, 0.1], "rotation": [0.0, 0.0, 0.0], "scale": [0.045, 0.007, 0.012]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, -0.142, 0.1], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.045, 0.01, 0.012], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouth", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "line-black", "materialLayers": ["line-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(10, 10, 10, 1.0)", "secondaryAlbedo": "rgba(32, 32, 34, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["mouthLine"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_mouth_14.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, -0.142, 0.1], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.045, 0.01, 0.012], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouth", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["head"] ?? root).add(node_mouth_14);
  nodes["mouth"] = node_mouth_14;
  const mesh_mouth_14Geometry = endpoint_mouth_14
    ? new THREE.CylinderGeometry(endpoint_mouth_14.endRadius, endpoint_mouth_14.baseRadius, endpoint_mouth_14.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_mouth_14) {
    mesh_mouth_14Geometry.scale(0.045, 0.007, 0.012);
  }
  const mesh_mouth_14 = new THREE.Mesh(
    mesh_mouth_14Geometry,
    materialMap["line-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mouth_14.name = "Mouth line";
  if (endpoint_mouth_14) {
    mesh_mouth_14.position.copy(endpoint_mouth_14.midpoint);
    mesh_mouth_14.quaternion.copy(endpoint_mouth_14.quaternion);
  }
  mesh_mouth_14.castShadow = options.castShadow ?? true;
  mesh_mouth_14.receiveShadow = options.receiveShadow ?? true;
  mesh_mouth_14.userData.sculptComponent = {"id": "mouth", "name": "Mouth line", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A short horizontal dark line at 0.93 of the head box, below the eye line.", "geometryDescriptor": {"topologyIntent": "Mouth line as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "head", "dimensions": {"width": 0.045, "height": 0.007, "depth": 0.012, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, -0.142, 0.1], "rotation": [0.0, 0.0, 0.0], "scale": [0.045, 0.007, 0.012]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, -0.142, 0.1], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.045, 0.01, 0.012], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouth", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "line-black", "materialLayers": ["line-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(10, 10, 10, 1.0)", "secondaryAlbedo": "rgba(32, 32, 34, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["mouthLine"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_mouth_14.add(mesh_mouth_14);
  meshes["mouth"] = mesh_mouth_14;
  colliders["mouth"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.045, 0.01, 0.012], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["mouth"] ??= [];
  destructionGroups["mouth"].push(node_mouth_14);

  const endpoint_fringe_15 = makeAttachmentEndpoint(null);
  const node_fringe_15 = new THREE.Group();
  node_fringe_15.name = "Fringe locks__pivot";
  node_fringe_15.scale.set(1, 1, 1);
  if (endpoint_fringe_15) {
    node_fringe_15.position.copy(endpoint_fringe_15.start);
    node_fringe_15.rotation.set(0.06, 0.0, 0.0);
  } else {
    node_fringe_15.position.set(0.0, -0.008, 0.17);
    node_fringe_15.rotation.set(0.06, 0.0, 0.0);
  }
  node_fringe_15.userData.sculptComponent = {"id": "fringe", "name": "Fringe locks", "level": "meso", "role": "shell", "importance": 0.95, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bangs stop at the measured hairline, 0.597 of the head box from the crown, i.e. y 0.774 - above the eye line at 0.704, so the eyes stay uncovered. One lock overlaps the character's left eye, cutting its visible width to 52 px from 69 px.", "geometryDescriptor": {"topologyIntent": "a slab of angular fringe locks across the brow", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.003, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "hair-shell", "dimensions": {"width": 0.34, "height": 0.22, "depth": 0.075, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, -0.008, 0.17], "rotation": [0.06, 0.0, 0.0], "scale": [0.34, 0.22, 0.075]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, -0.008, 0.17], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.34, 0.22, 0.075], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["fringeLocks", "asymmetricOverlap"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_fringe_15.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, -0.008, 0.17], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.34, 0.22, 0.075], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["hair-shell"] ?? root).add(node_fringe_15);
  nodes["fringe"] = node_fringe_15;
  const mesh_fringe_15Geometry = endpoint_fringe_15
    ? new THREE.CylinderGeometry(endpoint_fringe_15.endRadius, endpoint_fringe_15.baseRadius, endpoint_fringe_15.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_fringe_15) {
    mesh_fringe_15Geometry.scale(0.34, 0.22, 0.075);
  }
  const mesh_fringe_15 = new THREE.Mesh(
    mesh_fringe_15Geometry,
    materialMap["hair-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fringe_15.name = "Fringe locks";
  if (endpoint_fringe_15) {
    mesh_fringe_15.position.copy(endpoint_fringe_15.midpoint);
    mesh_fringe_15.quaternion.copy(endpoint_fringe_15.quaternion);
  }
  mesh_fringe_15.castShadow = options.castShadow ?? true;
  mesh_fringe_15.receiveShadow = options.receiveShadow ?? true;
  mesh_fringe_15.userData.sculptComponent = {"id": "fringe", "name": "Fringe locks", "level": "meso", "role": "shell", "importance": 0.95, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bangs stop at the measured hairline, 0.597 of the head box from the crown, i.e. y 0.774 - above the eye line at 0.704, so the eyes stay uncovered. One lock overlaps the character's left eye, cutting its visible width to 52 px from 69 px.", "geometryDescriptor": {"topologyIntent": "a slab of angular fringe locks across the brow", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.003, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "hair-shell", "dimensions": {"width": 0.34, "height": 0.22, "depth": 0.075, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, -0.008, 0.17], "rotation": [0.06, 0.0, 0.0], "scale": [0.34, 0.22, 0.075]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, -0.008, 0.17], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.34, 0.22, 0.075], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["fringeLocks", "asymmetricOverlap"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_fringe_15.add(mesh_fringe_15);
  meshes["fringe"] = mesh_fringe_15;
  colliders["fringe"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.34, 0.22, 0.075], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["fringe"] ??= [];
  destructionGroups["fringe"].push(node_fringe_15);

  const endpoint_hair_crown_block_16 = makeAttachmentEndpoint(null);
  const node_hair_crown_block_16 = new THREE.Group();
  node_hair_crown_block_16.name = "Raised crown block__pivot";
  node_hair_crown_block_16.scale.set(1, 1, 1);
  if (endpoint_hair_crown_block_16) {
    node_hair_crown_block_16.position.copy(endpoint_hair_crown_block_16.start);
    node_hair_crown_block_16.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_hair_crown_block_16.position.set(0.0, 0.097, -0.025);
    node_hair_crown_block_16.rotation.set(0.0, 0.0, 0.0);
  }
  node_hair_crown_block_16.userData.sculptComponent = {"id": "hair-crown-block", "name": "Raised crown block", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The crown is one raised block flanked by two lower slabs, which is what produces the stepped top edge in all three views.", "geometryDescriptor": {"topologyIntent": "the raised central crown slab", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "hair-shell", "dimensions": {"width": 0.3, "height": 0.075, "depth": 0.33, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, 0.097, -0.025], "rotation": [0.0, 0.0, 0.0], "scale": [0.3, 0.075, 0.33]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.097, -0.025], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.3, 0.075, 0.33], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hair-crown-block", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["crownBlocks"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_hair_crown_block_16.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.097, -0.025], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.3, 0.075, 0.33], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hair-crown-block", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["hair-shell"] ?? root).add(node_hair_crown_block_16);
  nodes["hair-crown-block"] = node_hair_crown_block_16;
  const mesh_hair_crown_block_16Geometry = endpoint_hair_crown_block_16
    ? new THREE.CylinderGeometry(endpoint_hair_crown_block_16.endRadius, endpoint_hair_crown_block_16.baseRadius, endpoint_hair_crown_block_16.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_hair_crown_block_16) {
    mesh_hair_crown_block_16Geometry.scale(0.3, 0.075, 0.33);
  }
  const mesh_hair_crown_block_16 = new THREE.Mesh(
    mesh_hair_crown_block_16Geometry,
    materialMap["hair-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hair_crown_block_16.name = "Raised crown block";
  if (endpoint_hair_crown_block_16) {
    mesh_hair_crown_block_16.position.copy(endpoint_hair_crown_block_16.midpoint);
    mesh_hair_crown_block_16.quaternion.copy(endpoint_hair_crown_block_16.quaternion);
  }
  mesh_hair_crown_block_16.castShadow = options.castShadow ?? true;
  mesh_hair_crown_block_16.receiveShadow = options.receiveShadow ?? true;
  mesh_hair_crown_block_16.userData.sculptComponent = {"id": "hair-crown-block", "name": "Raised crown block", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The crown is one raised block flanked by two lower slabs, which is what produces the stepped top edge in all three views.", "geometryDescriptor": {"topologyIntent": "the raised central crown slab", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "hair-shell", "dimensions": {"width": 0.3, "height": 0.075, "depth": 0.33, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, 0.097, -0.025], "rotation": [0.0, 0.0, 0.0], "scale": [0.3, 0.075, 0.33]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.097, -0.025], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.3, 0.075, 0.33], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hair-crown-block", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["crownBlocks"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_hair_crown_block_16.add(mesh_hair_crown_block_16);
  meshes["hair-crown-block"] = mesh_hair_crown_block_16;
  colliders["hair-crown-block"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.3, 0.075, 0.33], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["hair-crown-block"] ??= [];
  destructionGroups["hair-crown-block"].push(node_hair_crown_block_16);

  const endpoint_hair_nape_17 = makeAttachmentEndpoint(null);
  const node_hair_nape_17 = new THREE.Group();
  node_hair_nape_17.name = "Nape hair slab__pivot";
  node_hair_nape_17.scale.set(1, 1, 1);
  if (endpoint_hair_nape_17) {
    node_hair_nape_17.position.copy(endpoint_hair_nape_17.start);
    node_hair_nape_17.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_hair_nape_17.position.set(0.0, -0.188, -0.135);
    node_hair_nape_17.rotation.set(0.0, 0.0, 0.0);
  }
  node_hair_nape_17.userData.sculptComponent = {"id": "hair-nape", "name": "Nape hair slab", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The back view shows hair, not skin, between the crown and the collar; this slab closes that gap so no bare skull shows from behind.", "geometryDescriptor": {"topologyIntent": "a slab covering the back of the skull down to the nape", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "hair-shell", "dimensions": {"width": 0.28, "height": 0.2, "depth": 0.075, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.0, -0.188, -0.135], "rotation": [0.0, 0.0, 0.0], "scale": [0.28, 0.2, 0.075]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, -0.188, -0.135], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.28, 0.2, 0.075], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hair-nape", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["napeSlab"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_hair_nape_17.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, -0.188, -0.135], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.28, 0.2, 0.075], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hair-nape", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["hair-shell"] ?? root).add(node_hair_nape_17);
  nodes["hair-nape"] = node_hair_nape_17;
  const mesh_hair_nape_17Geometry = endpoint_hair_nape_17
    ? new THREE.CylinderGeometry(endpoint_hair_nape_17.endRadius, endpoint_hair_nape_17.baseRadius, endpoint_hair_nape_17.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_hair_nape_17) {
    mesh_hair_nape_17Geometry.scale(0.28, 0.2, 0.075);
  }
  const mesh_hair_nape_17 = new THREE.Mesh(
    mesh_hair_nape_17Geometry,
    materialMap["hair-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hair_nape_17.name = "Nape hair slab";
  if (endpoint_hair_nape_17) {
    mesh_hair_nape_17.position.copy(endpoint_hair_nape_17.midpoint);
    mesh_hair_nape_17.quaternion.copy(endpoint_hair_nape_17.quaternion);
  }
  mesh_hair_nape_17.castShadow = options.castShadow ?? true;
  mesh_hair_nape_17.receiveShadow = options.receiveShadow ?? true;
  mesh_hair_nape_17.userData.sculptComponent = {"id": "hair-nape", "name": "Nape hair slab", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The back view shows hair, not skin, between the crown and the collar; this slab closes that gap so no bare skull shows from behind.", "geometryDescriptor": {"topologyIntent": "a slab covering the back of the skull down to the nape", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "hair-shell", "dimensions": {"width": 0.28, "height": 0.2, "depth": 0.075, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.0, -0.188, -0.135], "rotation": [0.0, 0.0, 0.0], "scale": [0.28, 0.2, 0.075]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, -0.188, -0.135], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.28, 0.2, 0.075], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hair-nape", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["napeSlab"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_hair_nape_17.add(mesh_hair_nape_17);
  meshes["hair-nape"] = mesh_hair_nape_17;
  colliders["hair-nape"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.28, 0.2, 0.075], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["hair-nape"] ??= [];
  destructionGroups["hair-nape"].push(node_hair_nape_17);

  const endpoint_side_lock_l_18 = makeAttachmentEndpoint(null);
  const node_side_lock_l_18 = new THREE.Group();
  node_side_lock_l_18.name = "Side hair lock (l)__pivot";
  node_side_lock_l_18.scale.set(1, 1, 1);
  if (endpoint_side_lock_l_18) {
    node_side_lock_l_18.position.copy(endpoint_side_lock_l_18.start);
    node_side_lock_l_18.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_side_lock_l_18.position.set(0.165, -0.143, 0.06);
    node_side_lock_l_18.rotation.set(0.0, 0.0, 0.0);
  }
  node_side_lock_l_18.userData.sculptComponent = {"id": "side-lock-l", "name": "Side hair lock (l)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A flat slab descending past the jaw on each side, ending level with the chin; its inner edge is what narrows the visible face to the measured 216 px (0.254 units) of skin.", "geometryDescriptor": {"topologyIntent": "a vertical hair slab framing the cheek", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "hair-shell", "dimensions": {"width": 0.06, "height": 0.29, "depth": 0.3, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.165, -0.143, 0.06], "rotation": [0.0, 0.0, 0.0], "scale": [0.06, 0.29, 0.3]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.165, -0.143, 0.06], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.06, 0.29, 0.3], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "side-lock-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["sideLock"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_side_lock_l_18.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.165, -0.143, 0.06], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.06, 0.29, 0.3], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "side-lock-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["hair-shell"] ?? root).add(node_side_lock_l_18);
  nodes["side-lock-l"] = node_side_lock_l_18;
  const mesh_side_lock_l_18Geometry = endpoint_side_lock_l_18
    ? new THREE.CylinderGeometry(endpoint_side_lock_l_18.endRadius, endpoint_side_lock_l_18.baseRadius, endpoint_side_lock_l_18.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_side_lock_l_18) {
    mesh_side_lock_l_18Geometry.scale(0.06, 0.29, 0.3);
  }
  const mesh_side_lock_l_18 = new THREE.Mesh(
    mesh_side_lock_l_18Geometry,
    materialMap["hair-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_side_lock_l_18.name = "Side hair lock (l)";
  if (endpoint_side_lock_l_18) {
    mesh_side_lock_l_18.position.copy(endpoint_side_lock_l_18.midpoint);
    mesh_side_lock_l_18.quaternion.copy(endpoint_side_lock_l_18.quaternion);
  }
  mesh_side_lock_l_18.castShadow = options.castShadow ?? true;
  mesh_side_lock_l_18.receiveShadow = options.receiveShadow ?? true;
  mesh_side_lock_l_18.userData.sculptComponent = {"id": "side-lock-l", "name": "Side hair lock (l)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A flat slab descending past the jaw on each side, ending level with the chin; its inner edge is what narrows the visible face to the measured 216 px (0.254 units) of skin.", "geometryDescriptor": {"topologyIntent": "a vertical hair slab framing the cheek", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "hair-shell", "dimensions": {"width": 0.06, "height": 0.29, "depth": 0.3, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.165, -0.143, 0.06], "rotation": [0.0, 0.0, 0.0], "scale": [0.06, 0.29, 0.3]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.165, -0.143, 0.06], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.06, 0.29, 0.3], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "side-lock-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["sideLock"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_side_lock_l_18.add(mesh_side_lock_l_18);
  meshes["side-lock-l"] = mesh_side_lock_l_18;
  colliders["side-lock-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.06, 0.29, 0.3], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["side-lock-l"] ??= [];
  destructionGroups["side-lock-l"].push(node_side_lock_l_18);

  const endpoint_ear_cup_l_19 = makeAttachmentEndpoint(null);
  const node_ear_cup_l_19 = new THREE.Group();
  node_ear_cup_l_19.name = "Lateral ear-cup plate (l)__pivot";
  node_ear_cup_l_19.scale.set(1, 1, 1);
  if (endpoint_ear_cup_l_19) {
    node_ear_cup_l_19.position.copy(endpoint_ear_cup_l_19.start);
    node_ear_cup_l_19.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_ear_cup_l_19.position.set(0.2, -0.153, -0.01);
    node_ear_cup_l_19.rotation.set(0.0, 0.0, 0.0);
  }
  node_ear_cup_l_19.userData.sculptComponent = {"id": "ear-cup-l", "name": "Lateral ear-cup plate (l)", "level": "meso", "role": "shell", "importance": 0.9, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "In all three views a flat rectangular plate projects laterally from the head over the ear, its outer face reaching the measured 0.216 lateral extent.", "geometryDescriptor": {"topologyIntent": "a thin rectangular plate projecting laterally over the ear position", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "hair-shell", "dimensions": {"width": 0.03, "height": 0.19, "depth": 0.24, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.2, -0.153, -0.01], "rotation": [0.0, 0.0, 0.0], "scale": [0.03, 0.19, 0.24]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.2, -0.153, -0.01], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.03, 0.19, 0.24], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ear-cup-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["earCups"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_ear_cup_l_19.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.2, -0.153, -0.01], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.03, 0.19, 0.24], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ear-cup-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["hair-shell"] ?? root).add(node_ear_cup_l_19);
  nodes["ear-cup-l"] = node_ear_cup_l_19;
  const mesh_ear_cup_l_19Geometry = endpoint_ear_cup_l_19
    ? new THREE.CylinderGeometry(endpoint_ear_cup_l_19.endRadius, endpoint_ear_cup_l_19.baseRadius, endpoint_ear_cup_l_19.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_ear_cup_l_19) {
    mesh_ear_cup_l_19Geometry.scale(0.03, 0.19, 0.24);
  }
  const mesh_ear_cup_l_19 = new THREE.Mesh(
    mesh_ear_cup_l_19Geometry,
    materialMap["hair-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_ear_cup_l_19.name = "Lateral ear-cup plate (l)";
  if (endpoint_ear_cup_l_19) {
    mesh_ear_cup_l_19.position.copy(endpoint_ear_cup_l_19.midpoint);
    mesh_ear_cup_l_19.quaternion.copy(endpoint_ear_cup_l_19.quaternion);
  }
  mesh_ear_cup_l_19.castShadow = options.castShadow ?? true;
  mesh_ear_cup_l_19.receiveShadow = options.receiveShadow ?? true;
  mesh_ear_cup_l_19.userData.sculptComponent = {"id": "ear-cup-l", "name": "Lateral ear-cup plate (l)", "level": "meso", "role": "shell", "importance": 0.9, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "In all three views a flat rectangular plate projects laterally from the head over the ear, its outer face reaching the measured 0.216 lateral extent.", "geometryDescriptor": {"topologyIntent": "a thin rectangular plate projecting laterally over the ear position", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "hair-shell", "dimensions": {"width": 0.03, "height": 0.19, "depth": 0.24, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.2, -0.153, -0.01], "rotation": [0.0, 0.0, 0.0], "scale": [0.03, 0.19, 0.24]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.2, -0.153, -0.01], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.03, 0.19, 0.24], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ear-cup-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["earCups"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_ear_cup_l_19.add(mesh_ear_cup_l_19);
  meshes["ear-cup-l"] = mesh_ear_cup_l_19;
  colliders["ear-cup-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.03, 0.19, 0.24], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["ear-cup-l"] ??= [];
  destructionGroups["ear-cup-l"].push(node_ear_cup_l_19);

  const endpoint_tail_slab_1_l_20 = makeAttachmentEndpoint(null);
  const node_tail_slab_1_l_20 = new THREE.Group();
  node_tail_slab_1_l_20.name = "Tail slab 1 (l)__pivot";
  node_tail_slab_1_l_20.scale.set(1, 1, 1);
  if (endpoint_tail_slab_1_l_20) {
    node_tail_slab_1_l_20.position.copy(endpoint_tail_slab_1_l_20.start);
    node_tail_slab_1_l_20.rotation.set(0.0, 0.0, 0.29);
  } else {
    node_tail_slab_1_l_20.position.set(0.015, 0.27, 0.0);
    node_tail_slab_1_l_20.rotation.set(0.0, 0.0, 0.29);
  }
  node_tail_slab_1_l_20.userData.sculptComponent = {"id": "tail-slab-1-l", "name": "Tail slab 1 (l)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The tail flares outward immediately from the ear cup and reaches its widest lateral extent here (0.44 units), which is where the reference's front profile is widest - 398 px off centre at y 346 px. The chain then holds that width rather than growing.", "geometryDescriptor": {"topologyIntent": "the proximal tail slab", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "tail-l", "dimensions": {"width": 0.2, "height": 0.22, "depth": 0.095, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.015, 0.27, 0.0], "rotation": [0.0, 0.0, 0.29], "scale": [0.2, 0.22, 0.095]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.015, 0.27, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.2, 0.22, 0.095], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-slab-1-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["slabChain"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "tail-l", "parentSocket": "tail-slab-1-l-socket", "localStart": [0.015, 0.16, 0.0], "localEnd": [0.015, 0.38, 0.0], "contactType": "socket", "embedDepth": 0.015, "overlap": 0.015, "gapTolerance": 0.002}};
  node_tail_slab_1_l_20.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.015, 0.27, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.2, 0.22, 0.095], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-slab-1-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["tail-l"] ?? root).add(node_tail_slab_1_l_20);
  nodes["tail-slab-1-l"] = node_tail_slab_1_l_20;
  const mesh_tail_slab_1_l_20Geometry = endpoint_tail_slab_1_l_20
    ? new THREE.CylinderGeometry(endpoint_tail_slab_1_l_20.endRadius, endpoint_tail_slab_1_l_20.baseRadius, endpoint_tail_slab_1_l_20.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_tail_slab_1_l_20) {
    mesh_tail_slab_1_l_20Geometry.scale(0.2, 0.22, 0.095);
  }
  const mesh_tail_slab_1_l_20 = new THREE.Mesh(
    mesh_tail_slab_1_l_20Geometry,
    materialMap["hair-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tail_slab_1_l_20.name = "Tail slab 1 (l)";
  if (endpoint_tail_slab_1_l_20) {
    mesh_tail_slab_1_l_20.position.copy(endpoint_tail_slab_1_l_20.midpoint);
    mesh_tail_slab_1_l_20.quaternion.copy(endpoint_tail_slab_1_l_20.quaternion);
  }
  mesh_tail_slab_1_l_20.castShadow = options.castShadow ?? true;
  mesh_tail_slab_1_l_20.receiveShadow = options.receiveShadow ?? true;
  mesh_tail_slab_1_l_20.userData.sculptComponent = {"id": "tail-slab-1-l", "name": "Tail slab 1 (l)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The tail flares outward immediately from the ear cup and reaches its widest lateral extent here (0.44 units), which is where the reference's front profile is widest - 398 px off centre at y 346 px. The chain then holds that width rather than growing.", "geometryDescriptor": {"topologyIntent": "the proximal tail slab", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "tail-l", "dimensions": {"width": 0.2, "height": 0.22, "depth": 0.095, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.015, 0.27, 0.0], "rotation": [0.0, 0.0, 0.29], "scale": [0.2, 0.22, 0.095]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.015, 0.27, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.2, 0.22, 0.095], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-slab-1-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["slabChain"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "tail-l", "parentSocket": "tail-slab-1-l-socket", "localStart": [0.015, 0.16, 0.0], "localEnd": [0.015, 0.38, 0.0], "contactType": "socket", "embedDepth": 0.015, "overlap": 0.015, "gapTolerance": 0.002}};
  node_tail_slab_1_l_20.add(mesh_tail_slab_1_l_20);
  meshes["tail-slab-1-l"] = mesh_tail_slab_1_l_20;
  colliders["tail-slab-1-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.2, 0.22, 0.095], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["tail-slab-1-l"] ??= [];
  destructionGroups["tail-slab-1-l"].push(node_tail_slab_1_l_20);

  const endpoint_tail_slab_2_l_21 = makeAttachmentEndpoint(null);
  const node_tail_slab_2_l_21 = new THREE.Group();
  node_tail_slab_2_l_21.name = "Tail slab 2 (l)__pivot";
  node_tail_slab_2_l_21.scale.set(1, 1, 1);
  if (endpoint_tail_slab_2_l_21) {
    node_tail_slab_2_l_21.position.copy(endpoint_tail_slab_2_l_21.start);
    node_tail_slab_2_l_21.rotation.set(0.0, 0.0, 0.06);
  } else {
    node_tail_slab_2_l_21.position.set(0.05, 0.085, 0.0);
    node_tail_slab_2_l_21.rotation.set(0.0, 0.0, 0.06);
  }
  node_tail_slab_2_l_21.userData.sculptComponent = {"id": "tail-slab-2-l", "name": "Tail slab 2 (l)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Second of four stacked slabs; it holds the 0.44-unit lateral extent the root established instead of widening.", "geometryDescriptor": {"topologyIntent": "the second tail slab", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "tail-l", "dimensions": {"width": 0.175, "height": 0.26, "depth": 0.092, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.05, 0.085, 0.0], "rotation": [0.0, 0.0, 0.06], "scale": [0.175, 0.26, 0.092]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.05, 0.085, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.175, 0.26, 0.092], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-slab-2-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["slabChain"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "tail-l", "parentSocket": "tail-slab-2-l-socket", "localStart": [0.05, -0.045, 0.0], "localEnd": [0.05, 0.215, 0.0], "contactType": "socket", "embedDepth": 0.015, "overlap": 0.015, "gapTolerance": 0.002}};
  node_tail_slab_2_l_21.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.05, 0.085, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.175, 0.26, 0.092], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-slab-2-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["tail-l"] ?? root).add(node_tail_slab_2_l_21);
  nodes["tail-slab-2-l"] = node_tail_slab_2_l_21;
  const mesh_tail_slab_2_l_21Geometry = endpoint_tail_slab_2_l_21
    ? new THREE.CylinderGeometry(endpoint_tail_slab_2_l_21.endRadius, endpoint_tail_slab_2_l_21.baseRadius, endpoint_tail_slab_2_l_21.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_tail_slab_2_l_21) {
    mesh_tail_slab_2_l_21Geometry.scale(0.175, 0.26, 0.092);
  }
  const mesh_tail_slab_2_l_21 = new THREE.Mesh(
    mesh_tail_slab_2_l_21Geometry,
    materialMap["hair-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tail_slab_2_l_21.name = "Tail slab 2 (l)";
  if (endpoint_tail_slab_2_l_21) {
    mesh_tail_slab_2_l_21.position.copy(endpoint_tail_slab_2_l_21.midpoint);
    mesh_tail_slab_2_l_21.quaternion.copy(endpoint_tail_slab_2_l_21.quaternion);
  }
  mesh_tail_slab_2_l_21.castShadow = options.castShadow ?? true;
  mesh_tail_slab_2_l_21.receiveShadow = options.receiveShadow ?? true;
  mesh_tail_slab_2_l_21.userData.sculptComponent = {"id": "tail-slab-2-l", "name": "Tail slab 2 (l)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Second of four stacked slabs; it holds the 0.44-unit lateral extent the root established instead of widening.", "geometryDescriptor": {"topologyIntent": "the second tail slab", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "tail-l", "dimensions": {"width": 0.175, "height": 0.26, "depth": 0.092, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.05, 0.085, 0.0], "rotation": [0.0, 0.0, 0.06], "scale": [0.175, 0.26, 0.092]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.05, 0.085, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.175, 0.26, 0.092], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-slab-2-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["slabChain"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "tail-l", "parentSocket": "tail-slab-2-l-socket", "localStart": [0.05, -0.045, 0.0], "localEnd": [0.05, 0.215, 0.0], "contactType": "socket", "embedDepth": 0.015, "overlap": 0.015, "gapTolerance": 0.002}};
  node_tail_slab_2_l_21.add(mesh_tail_slab_2_l_21);
  meshes["tail-slab-2-l"] = mesh_tail_slab_2_l_21;
  colliders["tail-slab-2-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.175, 0.26, 0.092], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["tail-slab-2-l"] ??= [];
  destructionGroups["tail-slab-2-l"].push(node_tail_slab_2_l_21);

  const endpoint_tail_slab_3_l_22 = makeAttachmentEndpoint(null);
  const node_tail_slab_3_l_22 = new THREE.Group();
  node_tail_slab_3_l_22.name = "Tail slab 3 (l)__pivot";
  node_tail_slab_3_l_22.scale.set(1, 1, 1);
  if (endpoint_tail_slab_3_l_22) {
    node_tail_slab_3_l_22.position.copy(endpoint_tail_slab_3_l_22.start);
    node_tail_slab_3_l_22.rotation.set(0.0, 0.0, -0.08);
  } else {
    node_tail_slab_3_l_22.position.set(0.065, -0.1, 0.0);
    node_tail_slab_3_l_22.rotation.set(0.0, 0.0, -0.08);
  }
  node_tail_slab_3_l_22.userData.sculptComponent = {"id": "tail-slab-3-l", "name": "Tail slab 3 (l)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Third slab; still holding 0.43 units, matching the measured 720 px width at y 650 px.", "geometryDescriptor": {"topologyIntent": "the third tail slab", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "tail-l", "dimensions": {"width": 0.15, "height": 0.26, "depth": 0.088, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.065, -0.1, 0.0], "rotation": [0.0, 0.0, -0.08], "scale": [0.15, 0.26, 0.088]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.065, -0.1, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.26, 0.088], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-slab-3-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["slabChain"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "tail-l", "parentSocket": "tail-slab-3-l-socket", "localStart": [0.065, -0.23, 0.0], "localEnd": [0.065, 0.03, 0.0], "contactType": "socket", "embedDepth": 0.015, "overlap": 0.015, "gapTolerance": 0.002}};
  node_tail_slab_3_l_22.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.065, -0.1, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.26, 0.088], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-slab-3-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["tail-l"] ?? root).add(node_tail_slab_3_l_22);
  nodes["tail-slab-3-l"] = node_tail_slab_3_l_22;
  const mesh_tail_slab_3_l_22Geometry = endpoint_tail_slab_3_l_22
    ? new THREE.CylinderGeometry(endpoint_tail_slab_3_l_22.endRadius, endpoint_tail_slab_3_l_22.baseRadius, endpoint_tail_slab_3_l_22.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_tail_slab_3_l_22) {
    mesh_tail_slab_3_l_22Geometry.scale(0.15, 0.26, 0.088);
  }
  const mesh_tail_slab_3_l_22 = new THREE.Mesh(
    mesh_tail_slab_3_l_22Geometry,
    materialMap["hair-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tail_slab_3_l_22.name = "Tail slab 3 (l)";
  if (endpoint_tail_slab_3_l_22) {
    mesh_tail_slab_3_l_22.position.copy(endpoint_tail_slab_3_l_22.midpoint);
    mesh_tail_slab_3_l_22.quaternion.copy(endpoint_tail_slab_3_l_22.quaternion);
  }
  mesh_tail_slab_3_l_22.castShadow = options.castShadow ?? true;
  mesh_tail_slab_3_l_22.receiveShadow = options.receiveShadow ?? true;
  mesh_tail_slab_3_l_22.userData.sculptComponent = {"id": "tail-slab-3-l", "name": "Tail slab 3 (l)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Third slab; still holding 0.43 units, matching the measured 720 px width at y 650 px.", "geometryDescriptor": {"topologyIntent": "the third tail slab", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "tail-l", "dimensions": {"width": 0.15, "height": 0.26, "depth": 0.088, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.065, -0.1, 0.0], "rotation": [0.0, 0.0, -0.08], "scale": [0.15, 0.26, 0.088]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.065, -0.1, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.26, 0.088], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-slab-3-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["slabChain"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "tail-l", "parentSocket": "tail-slab-3-l-socket", "localStart": [0.065, -0.23, 0.0], "localEnd": [0.065, 0.03, 0.0], "contactType": "socket", "embedDepth": 0.015, "overlap": 0.015, "gapTolerance": 0.002}};
  node_tail_slab_3_l_22.add(mesh_tail_slab_3_l_22);
  meshes["tail-slab-3-l"] = mesh_tail_slab_3_l_22;
  colliders["tail-slab-3-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.26, 0.088], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["tail-slab-3-l"] ??= [];
  destructionGroups["tail-slab-3-l"].push(node_tail_slab_3_l_22);

  const endpoint_tail_slab_4_l_23 = makeAttachmentEndpoint(null);
  const node_tail_slab_4_l_23 = new THREE.Group();
  node_tail_slab_4_l_23.name = "Tail fan (l)__pivot";
  node_tail_slab_4_l_23.scale.set(1, 1, 1);
  if (endpoint_tail_slab_4_l_23) {
    node_tail_slab_4_l_23.position.copy(endpoint_tail_slab_4_l_23.start);
    node_tail_slab_4_l_23.rotation.set(0.0, 0.0, -0.14);
  } else {
    node_tail_slab_4_l_23.position.set(0.06, -0.235, 0.0);
    node_tail_slab_4_l_23.rotation.set(0.0, 0.0, -0.14);
  }
  node_tail_slab_4_l_23.userData.sculptComponent = {"id": "tail-slab-4-l", "name": "Tail fan (l)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Distal end of the chain: the reference's profile collapses from 701 px to 341 px between y 793 and 838 px, so the tail tapers and terminates here, above the boot top at y 0.243.", "geometryDescriptor": {"topologyIntent": "the notched spiky fan at the tail tip", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "tail-l", "dimensions": {"width": 0.105, "height": 0.2, "depth": 0.08, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.06, -0.235, 0.0], "rotation": [0.0, 0.0, -0.14], "scale": [0.105, 0.2, 0.08]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.06, -0.235, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.2, 0.08], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-slab-4-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["distalFan"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "tail-l", "parentSocket": "tail-slab-4-l-socket", "localStart": [0.06, -0.335, 0.0], "localEnd": [0.06, -0.135, 0.0], "contactType": "socket", "embedDepth": 0.015, "overlap": 0.015, "gapTolerance": 0.002}};
  node_tail_slab_4_l_23.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.06, -0.235, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.2, 0.08], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-slab-4-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["tail-l"] ?? root).add(node_tail_slab_4_l_23);
  nodes["tail-slab-4-l"] = node_tail_slab_4_l_23;
  const mesh_tail_slab_4_l_23Geometry = endpoint_tail_slab_4_l_23
    ? new THREE.CylinderGeometry(endpoint_tail_slab_4_l_23.endRadius, endpoint_tail_slab_4_l_23.baseRadius, endpoint_tail_slab_4_l_23.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_tail_slab_4_l_23) {
    mesh_tail_slab_4_l_23Geometry.scale(0.105, 0.2, 0.08);
  }
  const mesh_tail_slab_4_l_23 = new THREE.Mesh(
    mesh_tail_slab_4_l_23Geometry,
    materialMap["hair-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tail_slab_4_l_23.name = "Tail fan (l)";
  if (endpoint_tail_slab_4_l_23) {
    mesh_tail_slab_4_l_23.position.copy(endpoint_tail_slab_4_l_23.midpoint);
    mesh_tail_slab_4_l_23.quaternion.copy(endpoint_tail_slab_4_l_23.quaternion);
  }
  mesh_tail_slab_4_l_23.castShadow = options.castShadow ?? true;
  mesh_tail_slab_4_l_23.receiveShadow = options.receiveShadow ?? true;
  mesh_tail_slab_4_l_23.userData.sculptComponent = {"id": "tail-slab-4-l", "name": "Tail fan (l)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Distal end of the chain: the reference's profile collapses from 701 px to 341 px between y 793 and 838 px, so the tail tapers and terminates here, above the boot top at y 0.243.", "geometryDescriptor": {"topologyIntent": "the notched spiky fan at the tail tip", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "tail-l", "dimensions": {"width": 0.105, "height": 0.2, "depth": 0.08, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.06, -0.235, 0.0], "rotation": [0.0, 0.0, -0.14], "scale": [0.105, 0.2, 0.08]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.06, -0.235, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.2, 0.08], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-slab-4-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["distalFan"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "tail-l", "parentSocket": "tail-slab-4-l-socket", "localStart": [0.06, -0.335, 0.0], "localEnd": [0.06, -0.135, 0.0], "contactType": "socket", "embedDepth": 0.015, "overlap": 0.015, "gapTolerance": 0.002}};
  node_tail_slab_4_l_23.add(mesh_tail_slab_4_l_23);
  meshes["tail-slab-4-l"] = mesh_tail_slab_4_l_23;
  colliders["tail-slab-4-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.2, 0.08], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["tail-slab-4-l"] ??= [];
  destructionGroups["tail-slab-4-l"].push(node_tail_slab_4_l_23);

  const endpoint_tail_spike_l_24 = makeAttachmentEndpoint(null);
  const node_tail_spike_l_24 = new THREE.Group();
  node_tail_spike_l_24.name = "Tail crest spike (l)__pivot";
  node_tail_spike_l_24.scale.set(1, 1, 1);
  if (endpoint_tail_spike_l_24) {
    node_tail_spike_l_24.position.copy(endpoint_tail_spike_l_24.start);
    node_tail_spike_l_24.rotation.set(0.0, 0.0, 0.46);
  } else {
    node_tail_spike_l_24.position.set(0.005, 0.545, -0.01);
    node_tail_spike_l_24.rotation.set(0.0, 0.0, 0.46);
  }
  node_tail_spike_l_24.userData.sculptComponent = {"id": "tail-spike-l", "name": "Tail crest spike (l)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Two spikes rise above the crown to y 1.049 and reach laterally outward, which is what produces the two large reference-only triangles at the top of the silhouette overlay.", "geometryDescriptor": {"topologyIntent": "an angular spike rising above the crown", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "tail-l", "dimensions": {"width": 0.115, "height": 0.15, "depth": 0.095, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.005, 0.545, -0.01], "rotation": [0.0, 0.0, 0.46], "scale": [0.115, 0.15, 0.095]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.005, 0.545, -0.01], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.115, 0.15, 0.095], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-spike-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["crestSpike"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "tail-l", "parentSocket": "tail-spike-l-socket", "localStart": [0.005, 0.47, -0.01], "localEnd": [0.005, 0.62, -0.01], "contactType": "socket", "embedDepth": 0.015, "overlap": 0.015, "gapTolerance": 0.002}};
  node_tail_spike_l_24.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.005, 0.545, -0.01], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.115, 0.15, 0.095], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-spike-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["tail-l"] ?? root).add(node_tail_spike_l_24);
  nodes["tail-spike-l"] = node_tail_spike_l_24;
  const mesh_tail_spike_l_24Geometry = endpoint_tail_spike_l_24
    ? new THREE.CylinderGeometry(endpoint_tail_spike_l_24.endRadius, endpoint_tail_spike_l_24.baseRadius, endpoint_tail_spike_l_24.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_tail_spike_l_24) {
    mesh_tail_spike_l_24Geometry.scale(0.115, 0.15, 0.095);
  }
  const mesh_tail_spike_l_24 = new THREE.Mesh(
    mesh_tail_spike_l_24Geometry,
    materialMap["hair-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tail_spike_l_24.name = "Tail crest spike (l)";
  if (endpoint_tail_spike_l_24) {
    mesh_tail_spike_l_24.position.copy(endpoint_tail_spike_l_24.midpoint);
    mesh_tail_spike_l_24.quaternion.copy(endpoint_tail_spike_l_24.quaternion);
  }
  mesh_tail_spike_l_24.castShadow = options.castShadow ?? true;
  mesh_tail_spike_l_24.receiveShadow = options.receiveShadow ?? true;
  mesh_tail_spike_l_24.userData.sculptComponent = {"id": "tail-spike-l", "name": "Tail crest spike (l)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Two spikes rise above the crown to y 1.049 and reach laterally outward, which is what produces the two large reference-only triangles at the top of the silhouette overlay.", "geometryDescriptor": {"topologyIntent": "an angular spike rising above the crown", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "tail-l", "dimensions": {"width": 0.115, "height": 0.15, "depth": 0.095, "units": "relative", "confidence": 0.7}, "transform": {"position": [0.005, 0.545, -0.01], "rotation": [0.0, 0.0, 0.46], "scale": [0.115, 0.15, 0.095]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.005, 0.545, -0.01], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.115, 0.15, 0.095], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-spike-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["crestSpike"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "tail-l", "parentSocket": "tail-spike-l-socket", "localStart": [0.005, 0.47, -0.01], "localEnd": [0.005, 0.62, -0.01], "contactType": "socket", "embedDepth": 0.015, "overlap": 0.015, "gapTolerance": 0.002}};
  node_tail_spike_l_24.add(mesh_tail_spike_l_24);
  meshes["tail-spike-l"] = mesh_tail_spike_l_24;
  colliders["tail-spike-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.115, 0.15, 0.095], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["tail-spike-l"] ??= [];
  destructionGroups["tail-spike-l"].push(node_tail_spike_l_24);

  const endpoint_side_lock_r_25 = makeAttachmentEndpoint(null);
  const node_side_lock_r_25 = new THREE.Group();
  node_side_lock_r_25.name = "Side hair lock (r)__pivot";
  node_side_lock_r_25.scale.set(1, 1, 1);
  if (endpoint_side_lock_r_25) {
    node_side_lock_r_25.position.copy(endpoint_side_lock_r_25.start);
    node_side_lock_r_25.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_side_lock_r_25.position.set(-0.165, -0.143, 0.06);
    node_side_lock_r_25.rotation.set(0.0, 0.0, 0.0);
  }
  node_side_lock_r_25.userData.sculptComponent = {"id": "side-lock-r", "name": "Side hair lock (r)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A flat slab descending past the jaw on each side, ending level with the chin; its inner edge is what narrows the visible face to the measured 216 px (0.254 units) of skin.", "geometryDescriptor": {"topologyIntent": "a vertical hair slab framing the cheek", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "hair-shell", "dimensions": {"width": 0.06, "height": 0.29, "depth": 0.3, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.165, -0.143, 0.06], "rotation": [0.0, 0.0, 0.0], "scale": [0.06, 0.29, 0.3]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.165, -0.143, 0.06], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.06, 0.29, 0.3], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "side-lock-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["sideLock"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_side_lock_r_25.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.165, -0.143, 0.06], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.06, 0.29, 0.3], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "side-lock-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["hair-shell"] ?? root).add(node_side_lock_r_25);
  nodes["side-lock-r"] = node_side_lock_r_25;
  const mesh_side_lock_r_25Geometry = endpoint_side_lock_r_25
    ? new THREE.CylinderGeometry(endpoint_side_lock_r_25.endRadius, endpoint_side_lock_r_25.baseRadius, endpoint_side_lock_r_25.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_side_lock_r_25) {
    mesh_side_lock_r_25Geometry.scale(0.06, 0.29, 0.3);
  }
  const mesh_side_lock_r_25 = new THREE.Mesh(
    mesh_side_lock_r_25Geometry,
    materialMap["hair-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_side_lock_r_25.name = "Side hair lock (r)";
  if (endpoint_side_lock_r_25) {
    mesh_side_lock_r_25.position.copy(endpoint_side_lock_r_25.midpoint);
    mesh_side_lock_r_25.quaternion.copy(endpoint_side_lock_r_25.quaternion);
  }
  mesh_side_lock_r_25.castShadow = options.castShadow ?? true;
  mesh_side_lock_r_25.receiveShadow = options.receiveShadow ?? true;
  mesh_side_lock_r_25.userData.sculptComponent = {"id": "side-lock-r", "name": "Side hair lock (r)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A flat slab descending past the jaw on each side, ending level with the chin; its inner edge is what narrows the visible face to the measured 216 px (0.254 units) of skin.", "geometryDescriptor": {"topologyIntent": "a vertical hair slab framing the cheek", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "hair-shell", "dimensions": {"width": 0.06, "height": 0.29, "depth": 0.3, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.165, -0.143, 0.06], "rotation": [0.0, 0.0, 0.0], "scale": [0.06, 0.29, 0.3]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.165, -0.143, 0.06], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.06, 0.29, 0.3], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "side-lock-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["sideLock"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_side_lock_r_25.add(mesh_side_lock_r_25);
  meshes["side-lock-r"] = mesh_side_lock_r_25;
  colliders["side-lock-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.06, 0.29, 0.3], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["side-lock-r"] ??= [];
  destructionGroups["side-lock-r"].push(node_side_lock_r_25);

  const endpoint_ear_cup_r_26 = makeAttachmentEndpoint(null);
  const node_ear_cup_r_26 = new THREE.Group();
  node_ear_cup_r_26.name = "Lateral ear-cup plate (r)__pivot";
  node_ear_cup_r_26.scale.set(1, 1, 1);
  if (endpoint_ear_cup_r_26) {
    node_ear_cup_r_26.position.copy(endpoint_ear_cup_r_26.start);
    node_ear_cup_r_26.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_ear_cup_r_26.position.set(-0.2, -0.153, -0.01);
    node_ear_cup_r_26.rotation.set(0.0, 0.0, 0.0);
  }
  node_ear_cup_r_26.userData.sculptComponent = {"id": "ear-cup-r", "name": "Lateral ear-cup plate (r)", "level": "meso", "role": "shell", "importance": 0.9, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "In all three views a flat rectangular plate projects laterally from the head over the ear, its outer face reaching the measured 0.216 lateral extent.", "geometryDescriptor": {"topologyIntent": "a thin rectangular plate projecting laterally over the ear position", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "hair-shell", "dimensions": {"width": 0.03, "height": 0.19, "depth": 0.24, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.2, -0.153, -0.01], "rotation": [0.0, 0.0, 0.0], "scale": [0.03, 0.19, 0.24]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.2, -0.153, -0.01], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.03, 0.19, 0.24], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ear-cup-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["earCups"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_ear_cup_r_26.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.2, -0.153, -0.01], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.03, 0.19, 0.24], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ear-cup-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["hair-shell"] ?? root).add(node_ear_cup_r_26);
  nodes["ear-cup-r"] = node_ear_cup_r_26;
  const mesh_ear_cup_r_26Geometry = endpoint_ear_cup_r_26
    ? new THREE.CylinderGeometry(endpoint_ear_cup_r_26.endRadius, endpoint_ear_cup_r_26.baseRadius, endpoint_ear_cup_r_26.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_ear_cup_r_26) {
    mesh_ear_cup_r_26Geometry.scale(0.03, 0.19, 0.24);
  }
  const mesh_ear_cup_r_26 = new THREE.Mesh(
    mesh_ear_cup_r_26Geometry,
    materialMap["hair-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_ear_cup_r_26.name = "Lateral ear-cup plate (r)";
  if (endpoint_ear_cup_r_26) {
    mesh_ear_cup_r_26.position.copy(endpoint_ear_cup_r_26.midpoint);
    mesh_ear_cup_r_26.quaternion.copy(endpoint_ear_cup_r_26.quaternion);
  }
  mesh_ear_cup_r_26.castShadow = options.castShadow ?? true;
  mesh_ear_cup_r_26.receiveShadow = options.receiveShadow ?? true;
  mesh_ear_cup_r_26.userData.sculptComponent = {"id": "ear-cup-r", "name": "Lateral ear-cup plate (r)", "level": "meso", "role": "shell", "importance": 0.9, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "In all three views a flat rectangular plate projects laterally from the head over the ear, its outer face reaching the measured 0.216 lateral extent.", "geometryDescriptor": {"topologyIntent": "a thin rectangular plate projecting laterally over the ear position", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "hair-shell", "dimensions": {"width": 0.03, "height": 0.19, "depth": 0.24, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.2, -0.153, -0.01], "rotation": [0.0, 0.0, 0.0], "scale": [0.03, 0.19, 0.24]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.2, -0.153, -0.01], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.03, 0.19, 0.24], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ear-cup-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["earCups"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_ear_cup_r_26.add(mesh_ear_cup_r_26);
  meshes["ear-cup-r"] = mesh_ear_cup_r_26;
  colliders["ear-cup-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.03, 0.19, 0.24], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["ear-cup-r"] ??= [];
  destructionGroups["ear-cup-r"].push(node_ear_cup_r_26);

  const endpoint_tail_slab_1_r_27 = makeAttachmentEndpoint(null);
  const node_tail_slab_1_r_27 = new THREE.Group();
  node_tail_slab_1_r_27.name = "Tail slab 1 (r)__pivot";
  node_tail_slab_1_r_27.scale.set(1, 1, 1);
  if (endpoint_tail_slab_1_r_27) {
    node_tail_slab_1_r_27.position.copy(endpoint_tail_slab_1_r_27.start);
    node_tail_slab_1_r_27.rotation.set(0.0, 0.0, -0.29);
  } else {
    node_tail_slab_1_r_27.position.set(-0.015, 0.27, 0.0);
    node_tail_slab_1_r_27.rotation.set(0.0, 0.0, -0.29);
  }
  node_tail_slab_1_r_27.userData.sculptComponent = {"id": "tail-slab-1-r", "name": "Tail slab 1 (r)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The tail flares outward immediately from the ear cup and reaches its widest lateral extent here (0.44 units), which is where the reference's front profile is widest - 398 px off centre at y 346 px. The chain then holds that width rather than growing.", "geometryDescriptor": {"topologyIntent": "the proximal tail slab", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "tail-r", "dimensions": {"width": 0.2, "height": 0.22, "depth": 0.095, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.015, 0.27, 0.0], "rotation": [0.0, 0.0, -0.29], "scale": [0.2, 0.22, 0.095]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.015, 0.27, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.2, 0.22, 0.095], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-slab-1-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["slabChain"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "tail-r", "parentSocket": "tail-slab-1-r-socket", "localStart": [-0.015, 0.16, 0.0], "localEnd": [-0.015, 0.38, 0.0], "contactType": "socket", "embedDepth": 0.015, "overlap": 0.015, "gapTolerance": 0.002}};
  node_tail_slab_1_r_27.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.015, 0.27, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.2, 0.22, 0.095], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-slab-1-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["tail-r"] ?? root).add(node_tail_slab_1_r_27);
  nodes["tail-slab-1-r"] = node_tail_slab_1_r_27;
  const mesh_tail_slab_1_r_27Geometry = endpoint_tail_slab_1_r_27
    ? new THREE.CylinderGeometry(endpoint_tail_slab_1_r_27.endRadius, endpoint_tail_slab_1_r_27.baseRadius, endpoint_tail_slab_1_r_27.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_tail_slab_1_r_27) {
    mesh_tail_slab_1_r_27Geometry.scale(0.2, 0.22, 0.095);
  }
  const mesh_tail_slab_1_r_27 = new THREE.Mesh(
    mesh_tail_slab_1_r_27Geometry,
    materialMap["hair-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tail_slab_1_r_27.name = "Tail slab 1 (r)";
  if (endpoint_tail_slab_1_r_27) {
    mesh_tail_slab_1_r_27.position.copy(endpoint_tail_slab_1_r_27.midpoint);
    mesh_tail_slab_1_r_27.quaternion.copy(endpoint_tail_slab_1_r_27.quaternion);
  }
  mesh_tail_slab_1_r_27.castShadow = options.castShadow ?? true;
  mesh_tail_slab_1_r_27.receiveShadow = options.receiveShadow ?? true;
  mesh_tail_slab_1_r_27.userData.sculptComponent = {"id": "tail-slab-1-r", "name": "Tail slab 1 (r)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The tail flares outward immediately from the ear cup and reaches its widest lateral extent here (0.44 units), which is where the reference's front profile is widest - 398 px off centre at y 346 px. The chain then holds that width rather than growing.", "geometryDescriptor": {"topologyIntent": "the proximal tail slab", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "tail-r", "dimensions": {"width": 0.2, "height": 0.22, "depth": 0.095, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.015, 0.27, 0.0], "rotation": [0.0, 0.0, -0.29], "scale": [0.2, 0.22, 0.095]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.015, 0.27, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.2, 0.22, 0.095], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-slab-1-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["slabChain"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "tail-r", "parentSocket": "tail-slab-1-r-socket", "localStart": [-0.015, 0.16, 0.0], "localEnd": [-0.015, 0.38, 0.0], "contactType": "socket", "embedDepth": 0.015, "overlap": 0.015, "gapTolerance": 0.002}};
  node_tail_slab_1_r_27.add(mesh_tail_slab_1_r_27);
  meshes["tail-slab-1-r"] = mesh_tail_slab_1_r_27;
  colliders["tail-slab-1-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.2, 0.22, 0.095], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["tail-slab-1-r"] ??= [];
  destructionGroups["tail-slab-1-r"].push(node_tail_slab_1_r_27);

  const endpoint_tail_slab_2_r_28 = makeAttachmentEndpoint(null);
  const node_tail_slab_2_r_28 = new THREE.Group();
  node_tail_slab_2_r_28.name = "Tail slab 2 (r)__pivot";
  node_tail_slab_2_r_28.scale.set(1, 1, 1);
  if (endpoint_tail_slab_2_r_28) {
    node_tail_slab_2_r_28.position.copy(endpoint_tail_slab_2_r_28.start);
    node_tail_slab_2_r_28.rotation.set(0.0, 0.0, -0.06);
  } else {
    node_tail_slab_2_r_28.position.set(-0.05, 0.085, 0.0);
    node_tail_slab_2_r_28.rotation.set(0.0, 0.0, -0.06);
  }
  node_tail_slab_2_r_28.userData.sculptComponent = {"id": "tail-slab-2-r", "name": "Tail slab 2 (r)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Second of four stacked slabs; it holds the 0.44-unit lateral extent the root established instead of widening.", "geometryDescriptor": {"topologyIntent": "the second tail slab", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "tail-r", "dimensions": {"width": 0.175, "height": 0.26, "depth": 0.092, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.05, 0.085, 0.0], "rotation": [0.0, 0.0, -0.06], "scale": [0.175, 0.26, 0.092]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.05, 0.085, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.175, 0.26, 0.092], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-slab-2-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["slabChain"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "tail-r", "parentSocket": "tail-slab-2-r-socket", "localStart": [-0.05, -0.045, 0.0], "localEnd": [-0.05, 0.215, 0.0], "contactType": "socket", "embedDepth": 0.015, "overlap": 0.015, "gapTolerance": 0.002}};
  node_tail_slab_2_r_28.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.05, 0.085, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.175, 0.26, 0.092], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-slab-2-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["tail-r"] ?? root).add(node_tail_slab_2_r_28);
  nodes["tail-slab-2-r"] = node_tail_slab_2_r_28;
  const mesh_tail_slab_2_r_28Geometry = endpoint_tail_slab_2_r_28
    ? new THREE.CylinderGeometry(endpoint_tail_slab_2_r_28.endRadius, endpoint_tail_slab_2_r_28.baseRadius, endpoint_tail_slab_2_r_28.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_tail_slab_2_r_28) {
    mesh_tail_slab_2_r_28Geometry.scale(0.175, 0.26, 0.092);
  }
  const mesh_tail_slab_2_r_28 = new THREE.Mesh(
    mesh_tail_slab_2_r_28Geometry,
    materialMap["hair-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tail_slab_2_r_28.name = "Tail slab 2 (r)";
  if (endpoint_tail_slab_2_r_28) {
    mesh_tail_slab_2_r_28.position.copy(endpoint_tail_slab_2_r_28.midpoint);
    mesh_tail_slab_2_r_28.quaternion.copy(endpoint_tail_slab_2_r_28.quaternion);
  }
  mesh_tail_slab_2_r_28.castShadow = options.castShadow ?? true;
  mesh_tail_slab_2_r_28.receiveShadow = options.receiveShadow ?? true;
  mesh_tail_slab_2_r_28.userData.sculptComponent = {"id": "tail-slab-2-r", "name": "Tail slab 2 (r)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Second of four stacked slabs; it holds the 0.44-unit lateral extent the root established instead of widening.", "geometryDescriptor": {"topologyIntent": "the second tail slab", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "tail-r", "dimensions": {"width": 0.175, "height": 0.26, "depth": 0.092, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.05, 0.085, 0.0], "rotation": [0.0, 0.0, -0.06], "scale": [0.175, 0.26, 0.092]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.05, 0.085, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.175, 0.26, 0.092], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-slab-2-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["slabChain"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "tail-r", "parentSocket": "tail-slab-2-r-socket", "localStart": [-0.05, -0.045, 0.0], "localEnd": [-0.05, 0.215, 0.0], "contactType": "socket", "embedDepth": 0.015, "overlap": 0.015, "gapTolerance": 0.002}};
  node_tail_slab_2_r_28.add(mesh_tail_slab_2_r_28);
  meshes["tail-slab-2-r"] = mesh_tail_slab_2_r_28;
  colliders["tail-slab-2-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.175, 0.26, 0.092], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["tail-slab-2-r"] ??= [];
  destructionGroups["tail-slab-2-r"].push(node_tail_slab_2_r_28);

  const endpoint_tail_slab_3_r_29 = makeAttachmentEndpoint(null);
  const node_tail_slab_3_r_29 = new THREE.Group();
  node_tail_slab_3_r_29.name = "Tail slab 3 (r)__pivot";
  node_tail_slab_3_r_29.scale.set(1, 1, 1);
  if (endpoint_tail_slab_3_r_29) {
    node_tail_slab_3_r_29.position.copy(endpoint_tail_slab_3_r_29.start);
    node_tail_slab_3_r_29.rotation.set(0.0, 0.0, 0.08);
  } else {
    node_tail_slab_3_r_29.position.set(-0.065, -0.1, 0.0);
    node_tail_slab_3_r_29.rotation.set(0.0, 0.0, 0.08);
  }
  node_tail_slab_3_r_29.userData.sculptComponent = {"id": "tail-slab-3-r", "name": "Tail slab 3 (r)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Third slab; still holding 0.43 units, matching the measured 720 px width at y 650 px.", "geometryDescriptor": {"topologyIntent": "the third tail slab", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "tail-r", "dimensions": {"width": 0.15, "height": 0.26, "depth": 0.088, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.065, -0.1, 0.0], "rotation": [0.0, 0.0, 0.08], "scale": [0.15, 0.26, 0.088]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.065, -0.1, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.26, 0.088], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-slab-3-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["slabChain"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "tail-r", "parentSocket": "tail-slab-3-r-socket", "localStart": [-0.065, -0.23, 0.0], "localEnd": [-0.065, 0.03, 0.0], "contactType": "socket", "embedDepth": 0.015, "overlap": 0.015, "gapTolerance": 0.002}};
  node_tail_slab_3_r_29.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.065, -0.1, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.26, 0.088], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-slab-3-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["tail-r"] ?? root).add(node_tail_slab_3_r_29);
  nodes["tail-slab-3-r"] = node_tail_slab_3_r_29;
  const mesh_tail_slab_3_r_29Geometry = endpoint_tail_slab_3_r_29
    ? new THREE.CylinderGeometry(endpoint_tail_slab_3_r_29.endRadius, endpoint_tail_slab_3_r_29.baseRadius, endpoint_tail_slab_3_r_29.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_tail_slab_3_r_29) {
    mesh_tail_slab_3_r_29Geometry.scale(0.15, 0.26, 0.088);
  }
  const mesh_tail_slab_3_r_29 = new THREE.Mesh(
    mesh_tail_slab_3_r_29Geometry,
    materialMap["hair-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tail_slab_3_r_29.name = "Tail slab 3 (r)";
  if (endpoint_tail_slab_3_r_29) {
    mesh_tail_slab_3_r_29.position.copy(endpoint_tail_slab_3_r_29.midpoint);
    mesh_tail_slab_3_r_29.quaternion.copy(endpoint_tail_slab_3_r_29.quaternion);
  }
  mesh_tail_slab_3_r_29.castShadow = options.castShadow ?? true;
  mesh_tail_slab_3_r_29.receiveShadow = options.receiveShadow ?? true;
  mesh_tail_slab_3_r_29.userData.sculptComponent = {"id": "tail-slab-3-r", "name": "Tail slab 3 (r)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Third slab; still holding 0.43 units, matching the measured 720 px width at y 650 px.", "geometryDescriptor": {"topologyIntent": "the third tail slab", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "tail-r", "dimensions": {"width": 0.15, "height": 0.26, "depth": 0.088, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.065, -0.1, 0.0], "rotation": [0.0, 0.0, 0.08], "scale": [0.15, 0.26, 0.088]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.065, -0.1, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.26, 0.088], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-slab-3-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["slabChain"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "tail-r", "parentSocket": "tail-slab-3-r-socket", "localStart": [-0.065, -0.23, 0.0], "localEnd": [-0.065, 0.03, 0.0], "contactType": "socket", "embedDepth": 0.015, "overlap": 0.015, "gapTolerance": 0.002}};
  node_tail_slab_3_r_29.add(mesh_tail_slab_3_r_29);
  meshes["tail-slab-3-r"] = mesh_tail_slab_3_r_29;
  colliders["tail-slab-3-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.26, 0.088], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["tail-slab-3-r"] ??= [];
  destructionGroups["tail-slab-3-r"].push(node_tail_slab_3_r_29);

  const endpoint_tail_slab_4_r_30 = makeAttachmentEndpoint(null);
  const node_tail_slab_4_r_30 = new THREE.Group();
  node_tail_slab_4_r_30.name = "Tail fan (r)__pivot";
  node_tail_slab_4_r_30.scale.set(1, 1, 1);
  if (endpoint_tail_slab_4_r_30) {
    node_tail_slab_4_r_30.position.copy(endpoint_tail_slab_4_r_30.start);
    node_tail_slab_4_r_30.rotation.set(0.0, 0.0, 0.14);
  } else {
    node_tail_slab_4_r_30.position.set(-0.06, -0.235, 0.0);
    node_tail_slab_4_r_30.rotation.set(0.0, 0.0, 0.14);
  }
  node_tail_slab_4_r_30.userData.sculptComponent = {"id": "tail-slab-4-r", "name": "Tail fan (r)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Distal end of the chain: the reference's profile collapses from 701 px to 341 px between y 793 and 838 px, so the tail tapers and terminates here, above the boot top at y 0.243.", "geometryDescriptor": {"topologyIntent": "the notched spiky fan at the tail tip", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "tail-r", "dimensions": {"width": 0.105, "height": 0.2, "depth": 0.08, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.06, -0.235, 0.0], "rotation": [0.0, 0.0, 0.14], "scale": [0.105, 0.2, 0.08]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.06, -0.235, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.2, 0.08], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-slab-4-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["distalFan"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "tail-r", "parentSocket": "tail-slab-4-r-socket", "localStart": [-0.06, -0.335, 0.0], "localEnd": [-0.06, -0.135, 0.0], "contactType": "socket", "embedDepth": 0.015, "overlap": 0.015, "gapTolerance": 0.002}};
  node_tail_slab_4_r_30.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.06, -0.235, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.2, 0.08], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-slab-4-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["tail-r"] ?? root).add(node_tail_slab_4_r_30);
  nodes["tail-slab-4-r"] = node_tail_slab_4_r_30;
  const mesh_tail_slab_4_r_30Geometry = endpoint_tail_slab_4_r_30
    ? new THREE.CylinderGeometry(endpoint_tail_slab_4_r_30.endRadius, endpoint_tail_slab_4_r_30.baseRadius, endpoint_tail_slab_4_r_30.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_tail_slab_4_r_30) {
    mesh_tail_slab_4_r_30Geometry.scale(0.105, 0.2, 0.08);
  }
  const mesh_tail_slab_4_r_30 = new THREE.Mesh(
    mesh_tail_slab_4_r_30Geometry,
    materialMap["hair-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tail_slab_4_r_30.name = "Tail fan (r)";
  if (endpoint_tail_slab_4_r_30) {
    mesh_tail_slab_4_r_30.position.copy(endpoint_tail_slab_4_r_30.midpoint);
    mesh_tail_slab_4_r_30.quaternion.copy(endpoint_tail_slab_4_r_30.quaternion);
  }
  mesh_tail_slab_4_r_30.castShadow = options.castShadow ?? true;
  mesh_tail_slab_4_r_30.receiveShadow = options.receiveShadow ?? true;
  mesh_tail_slab_4_r_30.userData.sculptComponent = {"id": "tail-slab-4-r", "name": "Tail fan (r)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Distal end of the chain: the reference's profile collapses from 701 px to 341 px between y 793 and 838 px, so the tail tapers and terminates here, above the boot top at y 0.243.", "geometryDescriptor": {"topologyIntent": "the notched spiky fan at the tail tip", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "tail-r", "dimensions": {"width": 0.105, "height": 0.2, "depth": 0.08, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.06, -0.235, 0.0], "rotation": [0.0, 0.0, 0.14], "scale": [0.105, 0.2, 0.08]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.06, -0.235, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.2, 0.08], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-slab-4-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["distalFan"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "tail-r", "parentSocket": "tail-slab-4-r-socket", "localStart": [-0.06, -0.335, 0.0], "localEnd": [-0.06, -0.135, 0.0], "contactType": "socket", "embedDepth": 0.015, "overlap": 0.015, "gapTolerance": 0.002}};
  node_tail_slab_4_r_30.add(mesh_tail_slab_4_r_30);
  meshes["tail-slab-4-r"] = mesh_tail_slab_4_r_30;
  colliders["tail-slab-4-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.2, 0.08], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["tail-slab-4-r"] ??= [];
  destructionGroups["tail-slab-4-r"].push(node_tail_slab_4_r_30);

  const endpoint_tail_spike_r_31 = makeAttachmentEndpoint(null);
  const node_tail_spike_r_31 = new THREE.Group();
  node_tail_spike_r_31.name = "Tail crest spike (r)__pivot";
  node_tail_spike_r_31.scale.set(1, 1, 1);
  if (endpoint_tail_spike_r_31) {
    node_tail_spike_r_31.position.copy(endpoint_tail_spike_r_31.start);
    node_tail_spike_r_31.rotation.set(0.0, 0.0, -0.46);
  } else {
    node_tail_spike_r_31.position.set(-0.005, 0.545, -0.01);
    node_tail_spike_r_31.rotation.set(0.0, 0.0, -0.46);
  }
  node_tail_spike_r_31.userData.sculptComponent = {"id": "tail-spike-r", "name": "Tail crest spike (r)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Two spikes rise above the crown to y 1.049 and reach laterally outward, which is what produces the two large reference-only triangles at the top of the silhouette overlay.", "geometryDescriptor": {"topologyIntent": "an angular spike rising above the crown", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "tail-r", "dimensions": {"width": 0.115, "height": 0.15, "depth": 0.095, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.005, 0.545, -0.01], "rotation": [0.0, 0.0, -0.46], "scale": [0.115, 0.15, 0.095]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.005, 0.545, -0.01], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.115, 0.15, 0.095], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-spike-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["crestSpike"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "tail-r", "parentSocket": "tail-spike-r-socket", "localStart": [-0.005, 0.47, -0.01], "localEnd": [-0.005, 0.62, -0.01], "contactType": "socket", "embedDepth": 0.015, "overlap": 0.015, "gapTolerance": 0.002}};
  node_tail_spike_r_31.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.005, 0.545, -0.01], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.115, 0.15, 0.095], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-spike-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["tail-r"] ?? root).add(node_tail_spike_r_31);
  nodes["tail-spike-r"] = node_tail_spike_r_31;
  const mesh_tail_spike_r_31Geometry = endpoint_tail_spike_r_31
    ? new THREE.CylinderGeometry(endpoint_tail_spike_r_31.endRadius, endpoint_tail_spike_r_31.baseRadius, endpoint_tail_spike_r_31.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_tail_spike_r_31) {
    mesh_tail_spike_r_31Geometry.scale(0.115, 0.15, 0.095);
  }
  const mesh_tail_spike_r_31 = new THREE.Mesh(
    mesh_tail_spike_r_31Geometry,
    materialMap["hair-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tail_spike_r_31.name = "Tail crest spike (r)";
  if (endpoint_tail_spike_r_31) {
    mesh_tail_spike_r_31.position.copy(endpoint_tail_spike_r_31.midpoint);
    mesh_tail_spike_r_31.quaternion.copy(endpoint_tail_spike_r_31.quaternion);
  }
  mesh_tail_spike_r_31.castShadow = options.castShadow ?? true;
  mesh_tail_spike_r_31.receiveShadow = options.receiveShadow ?? true;
  mesh_tail_spike_r_31.userData.sculptComponent = {"id": "tail-spike-r", "name": "Tail crest spike (r)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Two spikes rise above the crown to y 1.049 and reach laterally outward, which is what produces the two large reference-only triangles at the top of the silhouette overlay.", "geometryDescriptor": {"topologyIntent": "an angular spike rising above the crown", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "tail-r", "dimensions": {"width": 0.115, "height": 0.15, "depth": 0.095, "units": "relative", "confidence": 0.7}, "transform": {"position": [-0.005, 0.545, -0.01], "rotation": [0.0, 0.0, -0.46], "scale": [0.115, 0.15, 0.095]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.005, 0.545, -0.01], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.115, 0.15, 0.095], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tail-spike-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair-black", "materialLayers": ["hair-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 20, 20, 1.0)", "secondaryAlbedo": "rgba(40, 40, 45, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["crestSpike"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "tail-r", "parentSocket": "tail-spike-r-socket", "localStart": [-0.005, 0.47, -0.01], "localEnd": [-0.005, 0.62, -0.01], "contactType": "socket", "embedDepth": 0.015, "overlap": 0.015, "gapTolerance": 0.002}};
  node_tail_spike_r_31.add(mesh_tail_spike_r_31);
  meshes["tail-spike-r"] = mesh_tail_spike_r_31;
  colliders["tail-spike-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.115, 0.15, 0.095], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["tail-spike-r"] ??= [];
  destructionGroups["tail-spike-r"].push(node_tail_spike_r_31);

  const endpoint_coat_front_l_32 = makeAttachmentEndpoint(null);
  const node_coat_front_l_32 = new THREE.Group();
  node_coat_front_l_32.name = "Coat front panel (l)__pivot";
  node_coat_front_l_32.scale.set(1, 1, 1);
  if (endpoint_coat_front_l_32) {
    node_coat_front_l_32.position.copy(endpoint_coat_front_l_32.start);
    node_coat_front_l_32.rotation.set(0.0, 0.1, 0.0);
  } else {
    node_coat_front_l_32.position.set(0.128, 0.005, 0.14);
    node_coat_front_l_32.rotation.set(0.0, 0.1, 0.0);
  }
  node_coat_front_l_32.userData.sculptComponent = {"id": "coat-front-l", "name": "Coat front panel (l)", "level": "meso", "role": "garment", "importance": 0.9, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Two front panels hang open; their inner edges at +/-0.0705 leave an opening wide enough to reveal the belt, the halter top and the midriff, as the reference shows.", "geometryDescriptor": {"topologyIntent": "a flat coat panel with a hard white edge along its opening", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "coat", "dimensions": {"width": 0.115, "height": 0.46, "depth": 0.025, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.128, 0.005, 0.14], "rotation": [0.0, 0.1, 0.0], "scale": [0.115, 0.46, 0.025]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.128, 0.005, 0.14], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.115, 0.46, 0.025], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coat-front-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["coatOpening"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_coat_front_l_32.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.128, 0.005, 0.14], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.115, 0.46, 0.025], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coat-front-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["coat"] ?? root).add(node_coat_front_l_32);
  nodes["coat-front-l"] = node_coat_front_l_32;
  const mesh_coat_front_l_32Geometry = endpoint_coat_front_l_32
    ? new THREE.CylinderGeometry(endpoint_coat_front_l_32.endRadius, endpoint_coat_front_l_32.baseRadius, endpoint_coat_front_l_32.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_coat_front_l_32) {
    mesh_coat_front_l_32Geometry.scale(0.115, 0.46, 0.025);
  }
  const mesh_coat_front_l_32 = new THREE.Mesh(
    mesh_coat_front_l_32Geometry,
    materialMap["cloth-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_coat_front_l_32.name = "Coat front panel (l)";
  if (endpoint_coat_front_l_32) {
    mesh_coat_front_l_32.position.copy(endpoint_coat_front_l_32.midpoint);
    mesh_coat_front_l_32.quaternion.copy(endpoint_coat_front_l_32.quaternion);
  }
  mesh_coat_front_l_32.castShadow = options.castShadow ?? true;
  mesh_coat_front_l_32.receiveShadow = options.receiveShadow ?? true;
  mesh_coat_front_l_32.userData.sculptComponent = {"id": "coat-front-l", "name": "Coat front panel (l)", "level": "meso", "role": "garment", "importance": 0.9, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Two front panels hang open; their inner edges at +/-0.0705 leave an opening wide enough to reveal the belt, the halter top and the midriff, as the reference shows.", "geometryDescriptor": {"topologyIntent": "a flat coat panel with a hard white edge along its opening", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "coat", "dimensions": {"width": 0.115, "height": 0.46, "depth": 0.025, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.128, 0.005, 0.14], "rotation": [0.0, 0.1, 0.0], "scale": [0.115, 0.46, 0.025]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.128, 0.005, 0.14], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.115, 0.46, 0.025], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coat-front-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["coatOpening"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_coat_front_l_32.add(mesh_coat_front_l_32);
  meshes["coat-front-l"] = mesh_coat_front_l_32;
  colliders["coat-front-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.115, 0.46, 0.025], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["coat-front-l"] ??= [];
  destructionGroups["coat-front-l"].push(node_coat_front_l_32);

  const endpoint_coat_hem_l_33 = makeAttachmentEndpoint(null);
  const node_coat_hem_l_33 = new THREE.Group();
  node_coat_hem_l_33.name = "Coat hem flare (l)__pivot";
  node_coat_hem_l_33.scale.set(1, 1, 1);
  if (endpoint_coat_hem_l_33) {
    node_coat_hem_l_33.position.copy(endpoint_coat_hem_l_33.start);
    node_coat_hem_l_33.rotation.set(0.12, 0.0, 0.12);
  } else {
    node_coat_hem_l_33.position.set(0.15, -0.205, 0.055);
    node_coat_hem_l_33.rotation.set(0.12, 0.0, 0.12);
  }
  node_coat_hem_l_33.userData.sculptComponent = {"id": "coat-hem-l", "name": "Coat hem flare (l)", "level": "meso", "role": "garment", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Below the belt the coat flares outward and forward, which is what keeps the silhouette wide at 0.75 of the figure's height.", "geometryDescriptor": {"topologyIntent": "the flared lower coat panel", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "coat", "dimensions": {"width": 0.14, "height": 0.235, "depth": 0.075, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.15, -0.205, 0.055], "rotation": [0.12, 0.0, 0.12], "scale": [0.14, 0.235, 0.075]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.15, -0.205, 0.055], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.14, 0.235, 0.075], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coat-hem-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["hemLine"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_coat_hem_l_33.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.15, -0.205, 0.055], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.14, 0.235, 0.075], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coat-hem-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["coat"] ?? root).add(node_coat_hem_l_33);
  nodes["coat-hem-l"] = node_coat_hem_l_33;
  const mesh_coat_hem_l_33Geometry = endpoint_coat_hem_l_33
    ? new THREE.CylinderGeometry(endpoint_coat_hem_l_33.endRadius, endpoint_coat_hem_l_33.baseRadius, endpoint_coat_hem_l_33.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_coat_hem_l_33) {
    mesh_coat_hem_l_33Geometry.scale(0.14, 0.235, 0.075);
  }
  const mesh_coat_hem_l_33 = new THREE.Mesh(
    mesh_coat_hem_l_33Geometry,
    materialMap["cloth-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_coat_hem_l_33.name = "Coat hem flare (l)";
  if (endpoint_coat_hem_l_33) {
    mesh_coat_hem_l_33.position.copy(endpoint_coat_hem_l_33.midpoint);
    mesh_coat_hem_l_33.quaternion.copy(endpoint_coat_hem_l_33.quaternion);
  }
  mesh_coat_hem_l_33.castShadow = options.castShadow ?? true;
  mesh_coat_hem_l_33.receiveShadow = options.receiveShadow ?? true;
  mesh_coat_hem_l_33.userData.sculptComponent = {"id": "coat-hem-l", "name": "Coat hem flare (l)", "level": "meso", "role": "garment", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Below the belt the coat flares outward and forward, which is what keeps the silhouette wide at 0.75 of the figure's height.", "geometryDescriptor": {"topologyIntent": "the flared lower coat panel", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "coat", "dimensions": {"width": 0.14, "height": 0.235, "depth": 0.075, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.15, -0.205, 0.055], "rotation": [0.12, 0.0, 0.12], "scale": [0.14, 0.235, 0.075]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.15, -0.205, 0.055], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.14, 0.235, 0.075], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coat-hem-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["hemLine"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_coat_hem_l_33.add(mesh_coat_hem_l_33);
  meshes["coat-hem-l"] = mesh_coat_hem_l_33;
  colliders["coat-hem-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.14, 0.235, 0.075], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["coat-hem-l"] ??= [];
  destructionGroups["coat-hem-l"].push(node_coat_hem_l_33);

  const endpoint_coat_trim_front_l_34 = makeAttachmentEndpoint(null);
  const node_coat_trim_front_l_34 = new THREE.Group();
  node_coat_trim_front_l_34.name = "Coat edge trim (l)__pivot";
  node_coat_trim_front_l_34.scale.set(1, 1, 1);
  if (endpoint_coat_trim_front_l_34) {
    node_coat_trim_front_l_34.position.copy(endpoint_coat_trim_front_l_34.start);
    node_coat_trim_front_l_34.rotation.set(0.0, 0.1, 0.0);
  } else {
    node_coat_trim_front_l_34.position.set(0.078, 0.005, 0.154);
    node_coat_trim_front_l_34.rotation.set(0.0, 0.1, 0.0);
  }
  node_coat_trim_front_l_34.userData.sculptComponent = {"id": "coat-trim-front-l", "name": "Coat edge trim (l)", "level": "meso", "role": "garment", "importance": 0.9, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The white edge linework is a bounded region on the black panel and is required to be GEOMETRY, not a painted texture.", "geometryDescriptor": {"topologyIntent": "a white trim strip tracing the panel opening", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "coat", "dimensions": {"width": 0.009, "height": 0.46, "depth": 0.01, "units": "relative", "confidence": 0.9}, "transform": {"position": [0.078, 0.005, 0.154], "rotation": [0.0, 0.1, 0.0], "scale": [0.009, 0.46, 0.01]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.078, 0.005, 0.154], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.01, 0.46, 0.01], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coat-trim-front-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "trim-white", "materialLayers": ["trim-white"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 233, 233, 1.0)", "secondaryAlbedo": "rgba(198, 198, 204, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.86, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["trimChain"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_coat_trim_front_l_34.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.078, 0.005, 0.154], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.01, 0.46, 0.01], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coat-trim-front-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["coat"] ?? root).add(node_coat_trim_front_l_34);
  nodes["coat-trim-front-l"] = node_coat_trim_front_l_34;
  const mesh_coat_trim_front_l_34Geometry = endpoint_coat_trim_front_l_34
    ? new THREE.CylinderGeometry(endpoint_coat_trim_front_l_34.endRadius, endpoint_coat_trim_front_l_34.baseRadius, endpoint_coat_trim_front_l_34.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_coat_trim_front_l_34) {
    mesh_coat_trim_front_l_34Geometry.scale(0.009, 0.46, 0.01);
  }
  const mesh_coat_trim_front_l_34 = new THREE.Mesh(
    mesh_coat_trim_front_l_34Geometry,
    materialMap["trim-white"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_coat_trim_front_l_34.name = "Coat edge trim (l)";
  if (endpoint_coat_trim_front_l_34) {
    mesh_coat_trim_front_l_34.position.copy(endpoint_coat_trim_front_l_34.midpoint);
    mesh_coat_trim_front_l_34.quaternion.copy(endpoint_coat_trim_front_l_34.quaternion);
  }
  mesh_coat_trim_front_l_34.castShadow = options.castShadow ?? true;
  mesh_coat_trim_front_l_34.receiveShadow = options.receiveShadow ?? true;
  mesh_coat_trim_front_l_34.userData.sculptComponent = {"id": "coat-trim-front-l", "name": "Coat edge trim (l)", "level": "meso", "role": "garment", "importance": 0.9, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The white edge linework is a bounded region on the black panel and is required to be GEOMETRY, not a painted texture.", "geometryDescriptor": {"topologyIntent": "a white trim strip tracing the panel opening", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "coat", "dimensions": {"width": 0.009, "height": 0.46, "depth": 0.01, "units": "relative", "confidence": 0.9}, "transform": {"position": [0.078, 0.005, 0.154], "rotation": [0.0, 0.1, 0.0], "scale": [0.009, 0.46, 0.01]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.078, 0.005, 0.154], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.01, 0.46, 0.01], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coat-trim-front-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "trim-white", "materialLayers": ["trim-white"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 233, 233, 1.0)", "secondaryAlbedo": "rgba(198, 198, 204, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.86, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["trimChain"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_coat_trim_front_l_34.add(mesh_coat_trim_front_l_34);
  meshes["coat-trim-front-l"] = mesh_coat_trim_front_l_34;
  colliders["coat-trim-front-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.01, 0.46, 0.01], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["coat-trim-front-l"] ??= [];
  destructionGroups["coat-trim-front-l"].push(node_coat_trim_front_l_34);

  const endpoint_sleeve_band_l_35 = makeAttachmentEndpoint(null);
  const node_sleeve_band_l_35 = new THREE.Group();
  node_sleeve_band_l_35.name = "Sleeve trim band (l)__pivot";
  node_sleeve_band_l_35.scale.set(1, 1, 1);
  if (endpoint_sleeve_band_l_35) {
    node_sleeve_band_l_35.position.copy(endpoint_sleeve_band_l_35.start);
    node_sleeve_band_l_35.rotation.set(0.0, 0.0, 0.38051);
  } else {
    node_sleeve_band_l_35.position.set(0.262, -0.175, 0.0);
    node_sleeve_band_l_35.rotation.set(0.0, 0.0, 0.38051);
  }
  node_sleeve_band_l_35.userData.sculptComponent = {"id": "sleeve-band-l", "name": "Sleeve trim band (l)", "level": "meso", "role": "garment", "importance": 0.8, "confidence": 0.85, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "A white band sits on each forearm just above the glove in the front and side views.", "geometryDescriptor": {"topologyIntent": "a white band wrapping the forearm where the sleeve meets the glove", "torusTubeRatio": 0.16, "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "chest", "dimensions": {"width": 0.105, "height": 0.105, "depth": 0.105, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.262, -0.175, 0.0], "rotation": [0.0, 0.0, 0.38051], "scale": [0.105, 0.105, 0.105]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.262, -0.175, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.105, 0.105], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sleeve-band-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "trim-white", "materialLayers": ["trim-white"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 233, 233, 1.0)", "secondaryAlbedo": "rgba(198, 198, 204, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.86, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["sleeveBands"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_sleeve_band_l_35.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.262, -0.175, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.105, 0.105], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sleeve-band-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["chest"] ?? root).add(node_sleeve_band_l_35);
  nodes["sleeve-band-l"] = node_sleeve_band_l_35;
  const mesh_sleeve_band_l_35Geometry = endpoint_sleeve_band_l_35
    ? new THREE.CylinderGeometry(endpoint_sleeve_band_l_35.endRadius, endpoint_sleeve_band_l_35.baseRadius, endpoint_sleeve_band_l_35.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.072, 24, 96);
  if (!endpoint_sleeve_band_l_35) {
    mesh_sleeve_band_l_35Geometry.scale(0.105, 0.105, 0.105);
  }
  const mesh_sleeve_band_l_35 = new THREE.Mesh(
    mesh_sleeve_band_l_35Geometry,
    materialMap["trim-white"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_sleeve_band_l_35.name = "Sleeve trim band (l)";
  if (endpoint_sleeve_band_l_35) {
    mesh_sleeve_band_l_35.position.copy(endpoint_sleeve_band_l_35.midpoint);
    mesh_sleeve_band_l_35.quaternion.copy(endpoint_sleeve_band_l_35.quaternion);
  }
  mesh_sleeve_band_l_35.castShadow = options.castShadow ?? true;
  mesh_sleeve_band_l_35.receiveShadow = options.receiveShadow ?? true;
  mesh_sleeve_band_l_35.userData.sculptComponent = {"id": "sleeve-band-l", "name": "Sleeve trim band (l)", "level": "meso", "role": "garment", "importance": 0.8, "confidence": 0.85, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "A white band sits on each forearm just above the glove in the front and side views.", "geometryDescriptor": {"topologyIntent": "a white band wrapping the forearm where the sleeve meets the glove", "torusTubeRatio": 0.16, "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "chest", "dimensions": {"width": 0.105, "height": 0.105, "depth": 0.105, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.262, -0.175, 0.0], "rotation": [0.0, 0.0, 0.38051], "scale": [0.105, 0.105, 0.105]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.262, -0.175, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.105, 0.105], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sleeve-band-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "trim-white", "materialLayers": ["trim-white"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 233, 233, 1.0)", "secondaryAlbedo": "rgba(198, 198, 204, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.86, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["sleeveBands"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_sleeve_band_l_35.add(mesh_sleeve_band_l_35);
  meshes["sleeve-band-l"] = mesh_sleeve_band_l_35;
  colliders["sleeve-band-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.105, 0.105], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["sleeve-band-l"] ??= [];
  destructionGroups["sleeve-band-l"].push(node_sleeve_band_l_35);

  const endpoint_coat_front_r_36 = makeAttachmentEndpoint(null);
  const node_coat_front_r_36 = new THREE.Group();
  node_coat_front_r_36.name = "Coat front panel (r)__pivot";
  node_coat_front_r_36.scale.set(1, 1, 1);
  if (endpoint_coat_front_r_36) {
    node_coat_front_r_36.position.copy(endpoint_coat_front_r_36.start);
    node_coat_front_r_36.rotation.set(0.0, -0.1, 0.0);
  } else {
    node_coat_front_r_36.position.set(-0.128, 0.005, 0.14);
    node_coat_front_r_36.rotation.set(0.0, -0.1, 0.0);
  }
  node_coat_front_r_36.userData.sculptComponent = {"id": "coat-front-r", "name": "Coat front panel (r)", "level": "meso", "role": "garment", "importance": 0.9, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Two front panels hang open; their inner edges at +/-0.0705 leave an opening wide enough to reveal the belt, the halter top and the midriff, as the reference shows.", "geometryDescriptor": {"topologyIntent": "a flat coat panel with a hard white edge along its opening", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "coat", "dimensions": {"width": 0.115, "height": 0.46, "depth": 0.025, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.128, 0.005, 0.14], "rotation": [0.0, -0.1, 0.0], "scale": [0.115, 0.46, 0.025]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.128, 0.005, 0.14], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.115, 0.46, 0.025], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coat-front-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["coatOpening"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_coat_front_r_36.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.128, 0.005, 0.14], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.115, 0.46, 0.025], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coat-front-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["coat"] ?? root).add(node_coat_front_r_36);
  nodes["coat-front-r"] = node_coat_front_r_36;
  const mesh_coat_front_r_36Geometry = endpoint_coat_front_r_36
    ? new THREE.CylinderGeometry(endpoint_coat_front_r_36.endRadius, endpoint_coat_front_r_36.baseRadius, endpoint_coat_front_r_36.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_coat_front_r_36) {
    mesh_coat_front_r_36Geometry.scale(0.115, 0.46, 0.025);
  }
  const mesh_coat_front_r_36 = new THREE.Mesh(
    mesh_coat_front_r_36Geometry,
    materialMap["cloth-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_coat_front_r_36.name = "Coat front panel (r)";
  if (endpoint_coat_front_r_36) {
    mesh_coat_front_r_36.position.copy(endpoint_coat_front_r_36.midpoint);
    mesh_coat_front_r_36.quaternion.copy(endpoint_coat_front_r_36.quaternion);
  }
  mesh_coat_front_r_36.castShadow = options.castShadow ?? true;
  mesh_coat_front_r_36.receiveShadow = options.receiveShadow ?? true;
  mesh_coat_front_r_36.userData.sculptComponent = {"id": "coat-front-r", "name": "Coat front panel (r)", "level": "meso", "role": "garment", "importance": 0.9, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Two front panels hang open; their inner edges at +/-0.0705 leave an opening wide enough to reveal the belt, the halter top and the midriff, as the reference shows.", "geometryDescriptor": {"topologyIntent": "a flat coat panel with a hard white edge along its opening", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "coat", "dimensions": {"width": 0.115, "height": 0.46, "depth": 0.025, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.128, 0.005, 0.14], "rotation": [0.0, -0.1, 0.0], "scale": [0.115, 0.46, 0.025]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.128, 0.005, 0.14], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.115, 0.46, 0.025], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coat-front-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["coatOpening"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_coat_front_r_36.add(mesh_coat_front_r_36);
  meshes["coat-front-r"] = mesh_coat_front_r_36;
  colliders["coat-front-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.115, 0.46, 0.025], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["coat-front-r"] ??= [];
  destructionGroups["coat-front-r"].push(node_coat_front_r_36);

  const endpoint_coat_hem_r_37 = makeAttachmentEndpoint(null);
  const node_coat_hem_r_37 = new THREE.Group();
  node_coat_hem_r_37.name = "Coat hem flare (r)__pivot";
  node_coat_hem_r_37.scale.set(1, 1, 1);
  if (endpoint_coat_hem_r_37) {
    node_coat_hem_r_37.position.copy(endpoint_coat_hem_r_37.start);
    node_coat_hem_r_37.rotation.set(0.12, 0.0, -0.12);
  } else {
    node_coat_hem_r_37.position.set(-0.15, -0.205, 0.055);
    node_coat_hem_r_37.rotation.set(0.12, 0.0, -0.12);
  }
  node_coat_hem_r_37.userData.sculptComponent = {"id": "coat-hem-r", "name": "Coat hem flare (r)", "level": "meso", "role": "garment", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Below the belt the coat flares outward and forward, which is what keeps the silhouette wide at 0.75 of the figure's height.", "geometryDescriptor": {"topologyIntent": "the flared lower coat panel", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "coat", "dimensions": {"width": 0.14, "height": 0.235, "depth": 0.075, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.15, -0.205, 0.055], "rotation": [0.12, 0.0, -0.12], "scale": [0.14, 0.235, 0.075]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.15, -0.205, 0.055], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.14, 0.235, 0.075], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coat-hem-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["hemLine"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_coat_hem_r_37.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.15, -0.205, 0.055], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.14, 0.235, 0.075], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coat-hem-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["coat"] ?? root).add(node_coat_hem_r_37);
  nodes["coat-hem-r"] = node_coat_hem_r_37;
  const mesh_coat_hem_r_37Geometry = endpoint_coat_hem_r_37
    ? new THREE.CylinderGeometry(endpoint_coat_hem_r_37.endRadius, endpoint_coat_hem_r_37.baseRadius, endpoint_coat_hem_r_37.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_coat_hem_r_37) {
    mesh_coat_hem_r_37Geometry.scale(0.14, 0.235, 0.075);
  }
  const mesh_coat_hem_r_37 = new THREE.Mesh(
    mesh_coat_hem_r_37Geometry,
    materialMap["cloth-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_coat_hem_r_37.name = "Coat hem flare (r)";
  if (endpoint_coat_hem_r_37) {
    mesh_coat_hem_r_37.position.copy(endpoint_coat_hem_r_37.midpoint);
    mesh_coat_hem_r_37.quaternion.copy(endpoint_coat_hem_r_37.quaternion);
  }
  mesh_coat_hem_r_37.castShadow = options.castShadow ?? true;
  mesh_coat_hem_r_37.receiveShadow = options.receiveShadow ?? true;
  mesh_coat_hem_r_37.userData.sculptComponent = {"id": "coat-hem-r", "name": "Coat hem flare (r)", "level": "meso", "role": "garment", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Below the belt the coat flares outward and forward, which is what keeps the silhouette wide at 0.75 of the figure's height.", "geometryDescriptor": {"topologyIntent": "the flared lower coat panel", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "coat", "dimensions": {"width": 0.14, "height": 0.235, "depth": 0.075, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.15, -0.205, 0.055], "rotation": [0.12, 0.0, -0.12], "scale": [0.14, 0.235, 0.075]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.15, -0.205, 0.055], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.14, 0.235, 0.075], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coat-hem-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["hemLine"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_coat_hem_r_37.add(mesh_coat_hem_r_37);
  meshes["coat-hem-r"] = mesh_coat_hem_r_37;
  colliders["coat-hem-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.14, 0.235, 0.075], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["coat-hem-r"] ??= [];
  destructionGroups["coat-hem-r"].push(node_coat_hem_r_37);

  const endpoint_coat_trim_front_r_38 = makeAttachmentEndpoint(null);
  const node_coat_trim_front_r_38 = new THREE.Group();
  node_coat_trim_front_r_38.name = "Coat edge trim (r)__pivot";
  node_coat_trim_front_r_38.scale.set(1, 1, 1);
  if (endpoint_coat_trim_front_r_38) {
    node_coat_trim_front_r_38.position.copy(endpoint_coat_trim_front_r_38.start);
    node_coat_trim_front_r_38.rotation.set(0.0, -0.1, 0.0);
  } else {
    node_coat_trim_front_r_38.position.set(-0.078, 0.005, 0.154);
    node_coat_trim_front_r_38.rotation.set(0.0, -0.1, 0.0);
  }
  node_coat_trim_front_r_38.userData.sculptComponent = {"id": "coat-trim-front-r", "name": "Coat edge trim (r)", "level": "meso", "role": "garment", "importance": 0.9, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The white edge linework is a bounded region on the black panel and is required to be GEOMETRY, not a painted texture.", "geometryDescriptor": {"topologyIntent": "a white trim strip tracing the panel opening", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "coat", "dimensions": {"width": 0.009, "height": 0.46, "depth": 0.01, "units": "relative", "confidence": 0.9}, "transform": {"position": [-0.078, 0.005, 0.154], "rotation": [0.0, -0.1, 0.0], "scale": [0.009, 0.46, 0.01]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.078, 0.005, 0.154], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.01, 0.46, 0.01], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coat-trim-front-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "trim-white", "materialLayers": ["trim-white"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 233, 233, 1.0)", "secondaryAlbedo": "rgba(198, 198, 204, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.86, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["trimChain"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_coat_trim_front_r_38.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.078, 0.005, 0.154], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.01, 0.46, 0.01], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coat-trim-front-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["coat"] ?? root).add(node_coat_trim_front_r_38);
  nodes["coat-trim-front-r"] = node_coat_trim_front_r_38;
  const mesh_coat_trim_front_r_38Geometry = endpoint_coat_trim_front_r_38
    ? new THREE.CylinderGeometry(endpoint_coat_trim_front_r_38.endRadius, endpoint_coat_trim_front_r_38.baseRadius, endpoint_coat_trim_front_r_38.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_coat_trim_front_r_38) {
    mesh_coat_trim_front_r_38Geometry.scale(0.009, 0.46, 0.01);
  }
  const mesh_coat_trim_front_r_38 = new THREE.Mesh(
    mesh_coat_trim_front_r_38Geometry,
    materialMap["trim-white"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_coat_trim_front_r_38.name = "Coat edge trim (r)";
  if (endpoint_coat_trim_front_r_38) {
    mesh_coat_trim_front_r_38.position.copy(endpoint_coat_trim_front_r_38.midpoint);
    mesh_coat_trim_front_r_38.quaternion.copy(endpoint_coat_trim_front_r_38.quaternion);
  }
  mesh_coat_trim_front_r_38.castShadow = options.castShadow ?? true;
  mesh_coat_trim_front_r_38.receiveShadow = options.receiveShadow ?? true;
  mesh_coat_trim_front_r_38.userData.sculptComponent = {"id": "coat-trim-front-r", "name": "Coat edge trim (r)", "level": "meso", "role": "garment", "importance": 0.9, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The white edge linework is a bounded region on the black panel and is required to be GEOMETRY, not a painted texture.", "geometryDescriptor": {"topologyIntent": "a white trim strip tracing the panel opening", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "coat", "dimensions": {"width": 0.009, "height": 0.46, "depth": 0.01, "units": "relative", "confidence": 0.9}, "transform": {"position": [-0.078, 0.005, 0.154], "rotation": [0.0, -0.1, 0.0], "scale": [0.009, 0.46, 0.01]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.078, 0.005, 0.154], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.01, 0.46, 0.01], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coat-trim-front-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "trim-white", "materialLayers": ["trim-white"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 233, 233, 1.0)", "secondaryAlbedo": "rgba(198, 198, 204, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.86, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["trimChain"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_coat_trim_front_r_38.add(mesh_coat_trim_front_r_38);
  meshes["coat-trim-front-r"] = mesh_coat_trim_front_r_38;
  colliders["coat-trim-front-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.01, 0.46, 0.01], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["coat-trim-front-r"] ??= [];
  destructionGroups["coat-trim-front-r"].push(node_coat_trim_front_r_38);

  const endpoint_sleeve_band_r_39 = makeAttachmentEndpoint(null);
  const node_sleeve_band_r_39 = new THREE.Group();
  node_sleeve_band_r_39.name = "Sleeve trim band (r)__pivot";
  node_sleeve_band_r_39.scale.set(1, 1, 1);
  if (endpoint_sleeve_band_r_39) {
    node_sleeve_band_r_39.position.copy(endpoint_sleeve_band_r_39.start);
    node_sleeve_band_r_39.rotation.set(0.0, 0.0, -0.38051);
  } else {
    node_sleeve_band_r_39.position.set(-0.262, -0.175, 0.0);
    node_sleeve_band_r_39.rotation.set(0.0, 0.0, -0.38051);
  }
  node_sleeve_band_r_39.userData.sculptComponent = {"id": "sleeve-band-r", "name": "Sleeve trim band (r)", "level": "meso", "role": "garment", "importance": 0.8, "confidence": 0.85, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "A white band sits on each forearm just above the glove in the front and side views.", "geometryDescriptor": {"topologyIntent": "a white band wrapping the forearm where the sleeve meets the glove", "torusTubeRatio": 0.16, "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "chest", "dimensions": {"width": 0.105, "height": 0.105, "depth": 0.105, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.262, -0.175, 0.0], "rotation": [0.0, 0.0, -0.38051], "scale": [0.105, 0.105, 0.105]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.262, -0.175, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.105, 0.105], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sleeve-band-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "trim-white", "materialLayers": ["trim-white"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 233, 233, 1.0)", "secondaryAlbedo": "rgba(198, 198, 204, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.86, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["sleeveBands"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_sleeve_band_r_39.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.262, -0.175, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.105, 0.105], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sleeve-band-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["chest"] ?? root).add(node_sleeve_band_r_39);
  nodes["sleeve-band-r"] = node_sleeve_band_r_39;
  const mesh_sleeve_band_r_39Geometry = endpoint_sleeve_band_r_39
    ? new THREE.CylinderGeometry(endpoint_sleeve_band_r_39.endRadius, endpoint_sleeve_band_r_39.baseRadius, endpoint_sleeve_band_r_39.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.072, 24, 96);
  if (!endpoint_sleeve_band_r_39) {
    mesh_sleeve_band_r_39Geometry.scale(0.105, 0.105, 0.105);
  }
  const mesh_sleeve_band_r_39 = new THREE.Mesh(
    mesh_sleeve_band_r_39Geometry,
    materialMap["trim-white"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_sleeve_band_r_39.name = "Sleeve trim band (r)";
  if (endpoint_sleeve_band_r_39) {
    mesh_sleeve_band_r_39.position.copy(endpoint_sleeve_band_r_39.midpoint);
    mesh_sleeve_band_r_39.quaternion.copy(endpoint_sleeve_band_r_39.quaternion);
  }
  mesh_sleeve_band_r_39.castShadow = options.castShadow ?? true;
  mesh_sleeve_band_r_39.receiveShadow = options.receiveShadow ?? true;
  mesh_sleeve_band_r_39.userData.sculptComponent = {"id": "sleeve-band-r", "name": "Sleeve trim band (r)", "level": "meso", "role": "garment", "importance": 0.8, "confidence": 0.85, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "A white band sits on each forearm just above the glove in the front and side views.", "geometryDescriptor": {"topologyIntent": "a white band wrapping the forearm where the sleeve meets the glove", "torusTubeRatio": 0.16, "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "chest", "dimensions": {"width": 0.105, "height": 0.105, "depth": 0.105, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.262, -0.175, 0.0], "rotation": [0.0, 0.0, -0.38051], "scale": [0.105, 0.105, 0.105]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.262, -0.175, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.105, 0.105], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sleeve-band-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "trim-white", "materialLayers": ["trim-white"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 233, 233, 1.0)", "secondaryAlbedo": "rgba(198, 198, 204, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.86, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["sleeveBands"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_sleeve_band_r_39.add(mesh_sleeve_band_r_39);
  meshes["sleeve-band-r"] = mesh_sleeve_band_r_39;
  colliders["sleeve-band-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.105, 0.105], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["sleeve-band-r"] ??= [];
  destructionGroups["sleeve-band-r"].push(node_sleeve_band_r_39);

  const endpoint_coat_back_40 = makeAttachmentEndpoint(null);
  const node_coat_back_40 = new THREE.Group();
  node_coat_back_40.name = "Coat back panel__pivot";
  node_coat_back_40.scale.set(1, 1, 1);
  if (endpoint_coat_back_40) {
    node_coat_back_40.position.copy(endpoint_coat_back_40.start);
    node_coat_back_40.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_coat_back_40.position.set(0.0, 0.005, -0.142);
    node_coat_back_40.rotation.set(0.0, 0.0, 0.0);
  }
  node_coat_back_40.userData.sculptComponent = {"id": "coat-back", "name": "Coat back panel", "level": "meso", "role": "garment", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The back panel is a single wide sheet carrying the star and the rear vent.", "geometryDescriptor": {"topologyIntent": "the coat's back panel", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "coat", "dimensions": {"width": 0.285, "height": 0.46, "depth": 0.025, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, 0.005, -0.142], "rotation": [0.0, 0.0, 0.0], "scale": [0.285, 0.46, 0.025]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.005, -0.142], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.285, 0.46, 0.025], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coat-back", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["backPanel"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_coat_back_40.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.005, -0.142], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.285, 0.46, 0.025], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coat-back", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["coat"] ?? root).add(node_coat_back_40);
  nodes["coat-back"] = node_coat_back_40;
  const mesh_coat_back_40Geometry = endpoint_coat_back_40
    ? new THREE.CylinderGeometry(endpoint_coat_back_40.endRadius, endpoint_coat_back_40.baseRadius, endpoint_coat_back_40.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_coat_back_40) {
    mesh_coat_back_40Geometry.scale(0.285, 0.46, 0.025);
  }
  const mesh_coat_back_40 = new THREE.Mesh(
    mesh_coat_back_40Geometry,
    materialMap["cloth-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_coat_back_40.name = "Coat back panel";
  if (endpoint_coat_back_40) {
    mesh_coat_back_40.position.copy(endpoint_coat_back_40.midpoint);
    mesh_coat_back_40.quaternion.copy(endpoint_coat_back_40.quaternion);
  }
  mesh_coat_back_40.castShadow = options.castShadow ?? true;
  mesh_coat_back_40.receiveShadow = options.receiveShadow ?? true;
  mesh_coat_back_40.userData.sculptComponent = {"id": "coat-back", "name": "Coat back panel", "level": "meso", "role": "garment", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The back panel is a single wide sheet carrying the star and the rear vent.", "geometryDescriptor": {"topologyIntent": "the coat's back panel", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "coat", "dimensions": {"width": 0.285, "height": 0.46, "depth": 0.025, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, 0.005, -0.142], "rotation": [0.0, 0.0, 0.0], "scale": [0.285, 0.46, 0.025]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.005, -0.142], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.285, 0.46, 0.025], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coat-back", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["backPanel"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_coat_back_40.add(mesh_coat_back_40);
  meshes["coat-back"] = mesh_coat_back_40;
  colliders["coat-back"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.285, 0.46, 0.025], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["coat-back"] ??= [];
  destructionGroups["coat-back"].push(node_coat_back_40);

  const endpoint_coat_collar_41 = makeAttachmentEndpoint(null);
  const node_coat_collar_41 = new THREE.Group();
  node_coat_collar_41.name = "Coat collar__pivot";
  node_coat_collar_41.scale.set(1, 1, 1);
  if (endpoint_coat_collar_41) {
    node_coat_collar_41.position.copy(endpoint_coat_collar_41.start);
    node_coat_collar_41.rotation.set(1.5708, 0.0, 0.0);
  } else {
    node_coat_collar_41.position.set(0.0, 0.1, -0.005);
    node_coat_collar_41.rotation.set(1.5708, 0.0, 0.0);
  }
  node_coat_collar_41.userData.sculptComponent = {"id": "coat-collar", "name": "Coat collar", "level": "meso", "role": "garment", "importance": 0.8, "confidence": 0.85, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "A raised collar band wraps the neck just above the choker; its tube is kept thin so it reads as a collar rather than a stack of rings.", "geometryDescriptor": {"topologyIntent": "a raised band around the throat with a small pull tab at its centre front", "torusTubeRatio": 0.11, "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "chest", "dimensions": {"width": 0.15, "height": 0.1, "depth": 0.15, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, 0.1, -0.005], "rotation": [1.5708, 0.0, 0.0], "scale": [0.15, 0.1, 0.15]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.1, -0.005], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.1, 0.15], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coat-collar", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["collar", "zipperPull"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_coat_collar_41.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.1, -0.005], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.1, 0.15], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coat-collar", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["chest"] ?? root).add(node_coat_collar_41);
  nodes["coat-collar"] = node_coat_collar_41;
  const mesh_coat_collar_41Geometry = endpoint_coat_collar_41
    ? new THREE.CylinderGeometry(endpoint_coat_collar_41.endRadius, endpoint_coat_collar_41.baseRadius, endpoint_coat_collar_41.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.0495, 24, 96);
  if (!endpoint_coat_collar_41) {
    mesh_coat_collar_41Geometry.scale(0.15, 0.1, 0.15);
  }
  const mesh_coat_collar_41 = new THREE.Mesh(
    mesh_coat_collar_41Geometry,
    materialMap["cloth-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_coat_collar_41.name = "Coat collar";
  if (endpoint_coat_collar_41) {
    mesh_coat_collar_41.position.copy(endpoint_coat_collar_41.midpoint);
    mesh_coat_collar_41.quaternion.copy(endpoint_coat_collar_41.quaternion);
  }
  mesh_coat_collar_41.castShadow = options.castShadow ?? true;
  mesh_coat_collar_41.receiveShadow = options.receiveShadow ?? true;
  mesh_coat_collar_41.userData.sculptComponent = {"id": "coat-collar", "name": "Coat collar", "level": "meso", "role": "garment", "importance": 0.8, "confidence": 0.85, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "A raised collar band wraps the neck just above the choker; its tube is kept thin so it reads as a collar rather than a stack of rings.", "geometryDescriptor": {"topologyIntent": "a raised band around the throat with a small pull tab at its centre front", "torusTubeRatio": 0.11, "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "chest", "dimensions": {"width": 0.15, "height": 0.1, "depth": 0.15, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, 0.1, -0.005], "rotation": [1.5708, 0.0, 0.0], "scale": [0.15, 0.1, 0.15]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.1, -0.005], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.1, 0.15], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coat-collar", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["collar", "zipperPull"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_coat_collar_41.add(mesh_coat_collar_41);
  meshes["coat-collar"] = mesh_coat_collar_41;
  colliders["coat-collar"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.1, 0.15], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["coat-collar"] ??= [];
  destructionGroups["coat-collar"].push(node_coat_collar_41);

  const endpoint_hood_42 = makeAttachmentEndpoint(null);
  const node_hood_42 = new THREE.Group();
  node_hood_42.name = "Collapsed hood__pivot";
  node_hood_42.scale.set(1, 1, 1);
  if (endpoint_hood_42) {
    node_hood_42.position.copy(endpoint_hood_42.start);
    node_hood_42.rotation.set(-0.25, 0.0, 0.0);
  } else {
    node_hood_42.position.set(0.0, 0.223, -0.155);
    node_hood_42.rotation.set(-0.25, 0.0, 0.0);
  }
  node_hood_42.userData.sculptComponent = {"id": "hood", "name": "Collapsed hood", "level": "meso", "role": "garment", "importance": 0.8, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Only the hood's outer boundary is visible, from the side view; its interior fold is inferred, recorded at confidence 0.5. It is sized and placed so it does not occlude the back star.", "geometryDescriptor": {"topologyIntent": "a collapsed hood mass resting behind the shoulders", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "coat", "dimensions": {"width": 0.25, "height": 0.11, "depth": 0.085, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.0, 0.223, -0.155], "rotation": [-0.25, 0.0, 0.0], "scale": [0.25, 0.11, 0.085]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.223, -0.155], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.25, 0.11, 0.085], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hood", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["hoodFold"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_hood_42.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.223, -0.155], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.25, 0.11, 0.085], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hood", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["coat"] ?? root).add(node_hood_42);
  nodes["hood"] = node_hood_42;
  const mesh_hood_42Geometry = endpoint_hood_42
    ? new THREE.CylinderGeometry(endpoint_hood_42.endRadius, endpoint_hood_42.baseRadius, endpoint_hood_42.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_hood_42) {
    mesh_hood_42Geometry.scale(0.25, 0.11, 0.085);
  }
  const mesh_hood_42 = new THREE.Mesh(
    mesh_hood_42Geometry,
    materialMap["cloth-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hood_42.name = "Collapsed hood";
  if (endpoint_hood_42) {
    mesh_hood_42.position.copy(endpoint_hood_42.midpoint);
    mesh_hood_42.quaternion.copy(endpoint_hood_42.quaternion);
  }
  mesh_hood_42.castShadow = options.castShadow ?? true;
  mesh_hood_42.receiveShadow = options.receiveShadow ?? true;
  mesh_hood_42.userData.sculptComponent = {"id": "hood", "name": "Collapsed hood", "level": "meso", "role": "garment", "importance": 0.8, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Only the hood's outer boundary is visible, from the side view; its interior fold is inferred, recorded at confidence 0.5. It is sized and placed so it does not occlude the back star.", "geometryDescriptor": {"topologyIntent": "a collapsed hood mass resting behind the shoulders", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "coat", "dimensions": {"width": 0.25, "height": 0.11, "depth": 0.085, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.0, 0.223, -0.155], "rotation": [-0.25, 0.0, 0.0], "scale": [0.25, 0.11, 0.085]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.223, -0.155], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.25, 0.11, 0.085], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hood", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["hoodFold"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_hood_42.add(mesh_hood_42);
  meshes["hood"] = mesh_hood_42;
  colliders["hood"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.25, 0.11, 0.085], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["hood"] ??= [];
  destructionGroups["hood"].push(node_hood_42);

  const endpoint_back_star_43 = makeAttachmentEndpoint(null);
  const node_back_star_43 = new THREE.Group();
  node_back_star_43.name = "Back star applique__pivot";
  node_back_star_43.scale.set(1, 1, 1);
  if (endpoint_back_star_43) {
    node_back_star_43.position.copy(endpoint_back_star_43.start);
    node_back_star_43.rotation.set(0.0, 3.14159, 0.0);
  } else {
    node_back_star_43.position.set(0.0, 0.0, -0.021);
    node_back_star_43.rotation.set(0.0, 3.14159, 0.0);
  }
  node_back_star_43.userData.sculptComponent = {"id": "back-star", "name": "Back star applique", "level": "meso", "role": "garment", "importance": 1.0, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A single hard-edged white five-point star centred on the back of the coat; the only large white area in the whole design.", "geometryDescriptor": {"topologyIntent": "a flat five-point star with hard edges", "profile2D": {"points": [[0.0, -0.5], [0.11756, -0.1618], [0.47553, -0.15451], [0.19021, 0.0618], [0.29389, 0.40451], [0.0, 0.2], [-0.29389, 0.40451], [-0.19021, 0.0618], [-0.47553, -0.15451], [-0.11756, -0.1618]], "depth": 0.12}, "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "coat-back", "dimensions": {"width": 0.24, "height": 0.24, "depth": 0.24, "units": "relative", "confidence": 0.9}, "transform": {"position": [0.0, 0.0, -0.021], "rotation": [0.0, 3.14159, 0.0], "scale": [0.24, 0.24, 0.24]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.0, -0.021], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.24, 0.24, 0.24], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "back-star", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "trim-white", "materialLayers": ["trim-white"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 233, 233, 1.0)", "secondaryAlbedo": "rgba(198, 198, 204, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.86, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["backStar"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_back_star_43.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.0, -0.021], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.24, 0.24, 0.24], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "back-star", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["coat-back"] ?? root).add(node_back_star_43);
  nodes["back-star"] = node_back_star_43;
  const mesh_back_star_43Geometry = endpoint_back_star_43
    ? new THREE.CylinderGeometry(endpoint_back_star_43.endRadius, endpoint_back_star_43.baseRadius, endpoint_back_star_43.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.0, -0.5], [0.11756, -0.1618], [0.47553, -0.15451], [0.19021, 0.0618], [0.29389, 0.40451], [0.0, 0.2], [-0.29389, 0.40451], [-0.19021, 0.0618], [-0.47553, -0.15451], [-0.11756, -0.1618]], "depth": 0.12});
  if (!endpoint_back_star_43) {
    mesh_back_star_43Geometry.scale(0.24, 0.24, 0.24);
  }
  const mesh_back_star_43 = new THREE.Mesh(
    mesh_back_star_43Geometry,
    materialMap["trim-white"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_back_star_43.name = "Back star applique";
  if (endpoint_back_star_43) {
    mesh_back_star_43.position.copy(endpoint_back_star_43.midpoint);
    mesh_back_star_43.quaternion.copy(endpoint_back_star_43.quaternion);
  }
  mesh_back_star_43.castShadow = options.castShadow ?? true;
  mesh_back_star_43.receiveShadow = options.receiveShadow ?? true;
  mesh_back_star_43.userData.sculptComponent = {"id": "back-star", "name": "Back star applique", "level": "meso", "role": "garment", "importance": 1.0, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A single hard-edged white five-point star centred on the back of the coat; the only large white area in the whole design.", "geometryDescriptor": {"topologyIntent": "a flat five-point star with hard edges", "profile2D": {"points": [[0.0, -0.5], [0.11756, -0.1618], [0.47553, -0.15451], [0.19021, 0.0618], [0.29389, 0.40451], [0.0, 0.2], [-0.29389, 0.40451], [-0.19021, 0.0618], [-0.47553, -0.15451], [-0.11756, -0.1618]], "depth": 0.12}, "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "coat-back", "dimensions": {"width": 0.24, "height": 0.24, "depth": 0.24, "units": "relative", "confidence": 0.9}, "transform": {"position": [0.0, 0.0, -0.021], "rotation": [0.0, 3.14159, 0.0], "scale": [0.24, 0.24, 0.24]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.0, -0.021], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.24, 0.24, 0.24], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "back-star", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "trim-white", "materialLayers": ["trim-white"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 233, 233, 1.0)", "secondaryAlbedo": "rgba(198, 198, 204, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.86, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["backStar"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_back_star_43.add(mesh_back_star_43);
  meshes["back-star"] = mesh_back_star_43;
  colliders["back-star"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.24, 0.24, 0.24], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["back-star"] ??= [];
  destructionGroups["back-star"].push(node_back_star_43);

  const endpoint_halter_top_44 = makeAttachmentEndpoint(null);
  const node_halter_top_44 = new THREE.Group();
  node_halter_top_44.name = "Halter top__pivot";
  node_halter_top_44.scale.set(1, 1, 1);
  if (endpoint_halter_top_44) {
    node_halter_top_44.position.copy(endpoint_halter_top_44.start);
    node_halter_top_44.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_halter_top_44.position.set(0.0, 0.003, 0.105);
    node_halter_top_44.rotation.set(0.0, 0.0, 0.0);
  }
  node_halter_top_44.userData.sculptComponent = {"id": "halter-top", "name": "Halter top", "level": "meso", "role": "garment", "importance": 0.9, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A black bandeau covering the chest, bounded sharply by bare skin above and below.", "geometryDescriptor": {"topologyIntent": "a compact halter cup shell over the chest", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "chest", "dimensions": {"width": 0.175, "height": 0.085, "depth": 0.075, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, 0.003, 0.105], "rotation": [0.0, 0.0, 0.0], "scale": [0.175, 0.085, 0.075]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.003, 0.105], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.175, 0.085, 0.075], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "halter-top", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["halterCups"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_halter_top_44.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.003, 0.105], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.175, 0.085, 0.075], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "halter-top", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["chest"] ?? root).add(node_halter_top_44);
  nodes["halter-top"] = node_halter_top_44;
  const mesh_halter_top_44Geometry = endpoint_halter_top_44
    ? new THREE.CylinderGeometry(endpoint_halter_top_44.endRadius, endpoint_halter_top_44.baseRadius, endpoint_halter_top_44.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_halter_top_44) {
    mesh_halter_top_44Geometry.scale(0.175, 0.085, 0.075);
  }
  const mesh_halter_top_44 = new THREE.Mesh(
    mesh_halter_top_44Geometry,
    materialMap["cloth-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_halter_top_44.name = "Halter top";
  if (endpoint_halter_top_44) {
    mesh_halter_top_44.position.copy(endpoint_halter_top_44.midpoint);
    mesh_halter_top_44.quaternion.copy(endpoint_halter_top_44.quaternion);
  }
  mesh_halter_top_44.castShadow = options.castShadow ?? true;
  mesh_halter_top_44.receiveShadow = options.receiveShadow ?? true;
  mesh_halter_top_44.userData.sculptComponent = {"id": "halter-top", "name": "Halter top", "level": "meso", "role": "garment", "importance": 0.9, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A black bandeau covering the chest, bounded sharply by bare skin above and below.", "geometryDescriptor": {"topologyIntent": "a compact halter cup shell over the chest", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "chest", "dimensions": {"width": 0.175, "height": 0.085, "depth": 0.075, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, 0.003, 0.105], "rotation": [0.0, 0.0, 0.0], "scale": [0.175, 0.085, 0.075]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.003, 0.105], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.175, 0.085, 0.075], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "halter-top", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["halterCups"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_halter_top_44.add(mesh_halter_top_44);
  meshes["halter-top"] = mesh_halter_top_44;
  colliders["halter-top"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.175, 0.085, 0.075], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["halter-top"] ??= [];
  destructionGroups["halter-top"].push(node_halter_top_44);

  const endpoint_halter_strap_l_45 = makeAttachmentEndpoint(null);
  const node_halter_strap_l_45 = new THREE.Group();
  node_halter_strap_l_45.name = "Halter strap (l)__pivot";
  node_halter_strap_l_45.scale.set(1, 1, 1);
  if (endpoint_halter_strap_l_45) {
    node_halter_strap_l_45.position.copy(endpoint_halter_strap_l_45.start);
    node_halter_strap_l_45.rotation.set(0.0, 0.0, 0.22);
  } else {
    node_halter_strap_l_45.position.set(0.045, 0.051, 0.093);
    node_halter_strap_l_45.rotation.set(0.0, 0.0, 0.22);
  }
  node_halter_strap_l_45.userData.sculptComponent = {"id": "halter-strap-l", "name": "Halter strap (l)", "level": "meso", "role": "garment", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Two thin straps run from the cups up to the throat, crossing under the choker.", "geometryDescriptor": {"topologyIntent": "a narrow strap rising from the cup to the neck", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "chest", "dimensions": {"width": 0.028, "height": 0.115, "depth": 0.028, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.045, 0.051, 0.093], "rotation": [0.0, 0.0, 0.22], "scale": [0.028, 0.115, 0.028]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.045, 0.051, 0.093], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.028, 0.115, 0.028], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "halter-strap-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["halterStraps"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_halter_strap_l_45.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.045, 0.051, 0.093], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.028, 0.115, 0.028], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "halter-strap-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["chest"] ?? root).add(node_halter_strap_l_45);
  nodes["halter-strap-l"] = node_halter_strap_l_45;
  const mesh_halter_strap_l_45Geometry = endpoint_halter_strap_l_45
    ? new THREE.CylinderGeometry(endpoint_halter_strap_l_45.endRadius, endpoint_halter_strap_l_45.baseRadius, endpoint_halter_strap_l_45.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_halter_strap_l_45) {
    mesh_halter_strap_l_45Geometry.scale(0.028, 0.115, 0.028);
  }
  const mesh_halter_strap_l_45 = new THREE.Mesh(
    mesh_halter_strap_l_45Geometry,
    materialMap["cloth-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_halter_strap_l_45.name = "Halter strap (l)";
  if (endpoint_halter_strap_l_45) {
    mesh_halter_strap_l_45.position.copy(endpoint_halter_strap_l_45.midpoint);
    mesh_halter_strap_l_45.quaternion.copy(endpoint_halter_strap_l_45.quaternion);
  }
  mesh_halter_strap_l_45.castShadow = options.castShadow ?? true;
  mesh_halter_strap_l_45.receiveShadow = options.receiveShadow ?? true;
  mesh_halter_strap_l_45.userData.sculptComponent = {"id": "halter-strap-l", "name": "Halter strap (l)", "level": "meso", "role": "garment", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Two thin straps run from the cups up to the throat, crossing under the choker.", "geometryDescriptor": {"topologyIntent": "a narrow strap rising from the cup to the neck", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "chest", "dimensions": {"width": 0.028, "height": 0.115, "depth": 0.028, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.045, 0.051, 0.093], "rotation": [0.0, 0.0, 0.22], "scale": [0.028, 0.115, 0.028]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.045, 0.051, 0.093], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.028, 0.115, 0.028], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "halter-strap-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["halterStraps"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_halter_strap_l_45.add(mesh_halter_strap_l_45);
  meshes["halter-strap-l"] = mesh_halter_strap_l_45;
  colliders["halter-strap-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.028, 0.115, 0.028], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["halter-strap-l"] ??= [];
  destructionGroups["halter-strap-l"].push(node_halter_strap_l_45);

  const endpoint_halter_strap_r_46 = makeAttachmentEndpoint(null);
  const node_halter_strap_r_46 = new THREE.Group();
  node_halter_strap_r_46.name = "Halter strap (r)__pivot";
  node_halter_strap_r_46.scale.set(1, 1, 1);
  if (endpoint_halter_strap_r_46) {
    node_halter_strap_r_46.position.copy(endpoint_halter_strap_r_46.start);
    node_halter_strap_r_46.rotation.set(0.0, 0.0, -0.22);
  } else {
    node_halter_strap_r_46.position.set(-0.045, 0.051, 0.093);
    node_halter_strap_r_46.rotation.set(0.0, 0.0, -0.22);
  }
  node_halter_strap_r_46.userData.sculptComponent = {"id": "halter-strap-r", "name": "Halter strap (r)", "level": "meso", "role": "garment", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Two thin straps run from the cups up to the throat, crossing under the choker.", "geometryDescriptor": {"topologyIntent": "a narrow strap rising from the cup to the neck", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "chest", "dimensions": {"width": 0.028, "height": 0.115, "depth": 0.028, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.045, 0.051, 0.093], "rotation": [0.0, 0.0, -0.22], "scale": [0.028, 0.115, 0.028]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.045, 0.051, 0.093], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.028, 0.115, 0.028], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "halter-strap-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["halterStraps"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_halter_strap_r_46.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.045, 0.051, 0.093], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.028, 0.115, 0.028], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "halter-strap-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["chest"] ?? root).add(node_halter_strap_r_46);
  nodes["halter-strap-r"] = node_halter_strap_r_46;
  const mesh_halter_strap_r_46Geometry = endpoint_halter_strap_r_46
    ? new THREE.CylinderGeometry(endpoint_halter_strap_r_46.endRadius, endpoint_halter_strap_r_46.baseRadius, endpoint_halter_strap_r_46.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_halter_strap_r_46) {
    mesh_halter_strap_r_46Geometry.scale(0.028, 0.115, 0.028);
  }
  const mesh_halter_strap_r_46 = new THREE.Mesh(
    mesh_halter_strap_r_46Geometry,
    materialMap["cloth-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_halter_strap_r_46.name = "Halter strap (r)";
  if (endpoint_halter_strap_r_46) {
    mesh_halter_strap_r_46.position.copy(endpoint_halter_strap_r_46.midpoint);
    mesh_halter_strap_r_46.quaternion.copy(endpoint_halter_strap_r_46.quaternion);
  }
  mesh_halter_strap_r_46.castShadow = options.castShadow ?? true;
  mesh_halter_strap_r_46.receiveShadow = options.receiveShadow ?? true;
  mesh_halter_strap_r_46.userData.sculptComponent = {"id": "halter-strap-r", "name": "Halter strap (r)", "level": "meso", "role": "garment", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Two thin straps run from the cups up to the throat, crossing under the choker.", "geometryDescriptor": {"topologyIntent": "a narrow strap rising from the cup to the neck", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "chest", "dimensions": {"width": 0.028, "height": 0.115, "depth": 0.028, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.045, 0.051, 0.093], "rotation": [0.0, 0.0, -0.22], "scale": [0.028, 0.115, 0.028]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.045, 0.051, 0.093], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.028, 0.115, 0.028], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "halter-strap-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["halterStraps"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_halter_strap_r_46.add(mesh_halter_strap_r_46);
  meshes["halter-strap-r"] = mesh_halter_strap_r_46;
  colliders["halter-strap-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.028, 0.115, 0.028], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["halter-strap-r"] ??= [];
  destructionGroups["halter-strap-r"].push(node_halter_strap_r_46);

  const endpoint_choker_47 = makeAttachmentEndpoint(null);
  const node_choker_47 = new THREE.Group();
  node_choker_47.name = "Choker and ring__pivot";
  node_choker_47.scale.set(1, 1, 1);
  if (endpoint_choker_47) {
    node_choker_47.position.copy(endpoint_choker_47.start);
    node_choker_47.rotation.set(1.5708, 0.0, 0.0);
  } else {
    node_choker_47.position.set(0.0, 0.112, 0.0);
    node_choker_47.rotation.set(1.5708, 0.0, 0.0);
  }
  node_choker_47.userData.sculptComponent = {"id": "choker", "name": "Choker and ring", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "A dark choker sits at the throat, its ring pendant being one of only two metal elements in the design.", "geometryDescriptor": {"topologyIntent": "a dark band at the throat with a small ring pendant", "torusTubeRatio": 0.24, "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "neck", "dimensions": {"width": 0.096, "height": 0.07, "depth": 0.096, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, 0.112, 0.0], "rotation": [1.5708, 0.0, 0.0], "scale": [0.096, 0.07, 0.096]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.112, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.096, 0.07, 0.096], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "choker", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "line-black", "materialLayers": ["line-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(10, 10, 10, 1.0)", "secondaryAlbedo": "rgba(32, 32, 34, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["chokerRing"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_choker_47.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.112, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.096, 0.07, 0.096], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "choker", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["neck"] ?? root).add(node_choker_47);
  nodes["choker"] = node_choker_47;
  const mesh_choker_47Geometry = endpoint_choker_47
    ? new THREE.CylinderGeometry(endpoint_choker_47.endRadius, endpoint_choker_47.baseRadius, endpoint_choker_47.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.108, 24, 96);
  if (!endpoint_choker_47) {
    mesh_choker_47Geometry.scale(0.096, 0.07, 0.096);
  }
  const mesh_choker_47 = new THREE.Mesh(
    mesh_choker_47Geometry,
    materialMap["line-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_choker_47.name = "Choker and ring";
  if (endpoint_choker_47) {
    mesh_choker_47.position.copy(endpoint_choker_47.midpoint);
    mesh_choker_47.quaternion.copy(endpoint_choker_47.quaternion);
  }
  mesh_choker_47.castShadow = options.castShadow ?? true;
  mesh_choker_47.receiveShadow = options.receiveShadow ?? true;
  mesh_choker_47.userData.sculptComponent = {"id": "choker", "name": "Choker and ring", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "A dark choker sits at the throat, its ring pendant being one of only two metal elements in the design.", "geometryDescriptor": {"topologyIntent": "a dark band at the throat with a small ring pendant", "torusTubeRatio": 0.24, "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "neck", "dimensions": {"width": 0.096, "height": 0.07, "depth": 0.096, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, 0.112, 0.0], "rotation": [1.5708, 0.0, 0.0], "scale": [0.096, 0.07, 0.096]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.112, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.096, 0.07, 0.096], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "choker", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "line-black", "materialLayers": ["line-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(10, 10, 10, 1.0)", "secondaryAlbedo": "rgba(32, 32, 34, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["chokerRing"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_choker_47.add(mesh_choker_47);
  meshes["choker"] = mesh_choker_47;
  colliders["choker"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.096, 0.07, 0.096], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["choker"] ??= [];
  destructionGroups["choker"].push(node_choker_47);

  const endpoint_belt_48 = makeAttachmentEndpoint(null);
  const node_belt_48 = new THREE.Group();
  node_belt_48.name = "Waist belt__pivot";
  node_belt_48.scale.set(1, 1, 1);
  if (endpoint_belt_48) {
    node_belt_48.position.copy(endpoint_belt_48.start);
    node_belt_48.rotation.set(1.5708, 0.0, 0.0);
  } else {
    node_belt_48.position.set(0.0, 0.028, 0.0);
    node_belt_48.rotation.set(1.5708, 0.0, 0.0);
  }
  node_belt_48.userData.sculptComponent = {"id": "belt", "name": "Waist belt", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.85, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "A white belt with a square buckle crosses the waist between the midriff and the shorts.", "geometryDescriptor": {"topologyIntent": "a white belt band around the waist", "torusTubeRatio": 0.13, "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "pelvis", "dimensions": {"width": 0.245, "height": 0.115, "depth": 0.205, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, 0.028, 0.0], "rotation": [1.5708, 0.0, 0.0], "scale": [0.245, 0.115, 0.205]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.028, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.245, 0.115, 0.205], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "belt", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "trim-white", "materialLayers": ["trim-white"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 233, 233, 1.0)", "secondaryAlbedo": "rgba(198, 198, 204, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.86, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["beltLine"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_belt_48.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.028, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.245, 0.115, 0.205], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "belt", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["pelvis"] ?? root).add(node_belt_48);
  nodes["belt"] = node_belt_48;
  const mesh_belt_48Geometry = endpoint_belt_48
    ? new THREE.CylinderGeometry(endpoint_belt_48.endRadius, endpoint_belt_48.baseRadius, endpoint_belt_48.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.0585, 24, 96);
  if (!endpoint_belt_48) {
    mesh_belt_48Geometry.scale(0.245, 0.115, 0.205);
  }
  const mesh_belt_48 = new THREE.Mesh(
    mesh_belt_48Geometry,
    materialMap["trim-white"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_belt_48.name = "Waist belt";
  if (endpoint_belt_48) {
    mesh_belt_48.position.copy(endpoint_belt_48.midpoint);
    mesh_belt_48.quaternion.copy(endpoint_belt_48.quaternion);
  }
  mesh_belt_48.castShadow = options.castShadow ?? true;
  mesh_belt_48.receiveShadow = options.receiveShadow ?? true;
  mesh_belt_48.userData.sculptComponent = {"id": "belt", "name": "Waist belt", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.85, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "A white belt with a square buckle crosses the waist between the midriff and the shorts.", "geometryDescriptor": {"topologyIntent": "a white belt band around the waist", "torusTubeRatio": 0.13, "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "pelvis", "dimensions": {"width": 0.245, "height": 0.115, "depth": 0.205, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, 0.028, 0.0], "rotation": [1.5708, 0.0, 0.0], "scale": [0.245, 0.115, 0.205]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.028, 0.0], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.245, 0.115, 0.205], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "belt", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "trim-white", "materialLayers": ["trim-white"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 233, 233, 1.0)", "secondaryAlbedo": "rgba(198, 198, 204, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.86, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["beltLine"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_belt_48.add(mesh_belt_48);
  meshes["belt"] = mesh_belt_48;
  colliders["belt"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.245, 0.115, 0.205], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["belt"] ??= [];
  destructionGroups["belt"].push(node_belt_48);

  const endpoint_buckle_49 = makeAttachmentEndpoint(null);
  const node_buckle_49 = new THREE.Group();
  node_buckle_49.name = "Belt buckle__pivot";
  node_buckle_49.scale.set(1, 1, 1);
  if (endpoint_buckle_49) {
    node_buckle_49.position.copy(endpoint_buckle_49.start);
    node_buckle_49.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_buckle_49.position.set(0.0, 0.028, 0.115);
    node_buckle_49.rotation.set(0.0, 0.0, 0.0);
  }
  node_buckle_49.userData.sculptComponent = {"id": "buckle", "name": "Belt buckle", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A square buckle sits at the belt's centre front, drawn in the same white as the belt.", "geometryDescriptor": {"topologyIntent": "a square buckle plate at the belt centre", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "pelvis", "dimensions": {"width": 0.055, "height": 0.045, "depth": 0.022, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, 0.028, 0.115], "rotation": [0.0, 0.0, 0.0], "scale": [0.055, 0.045, 0.022]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.028, 0.115], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.055, 0.045, 0.022], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "buckle", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "metal-gray", "materialLayers": ["metal-gray"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(185, 185, 185, 1.0)", "secondaryAlbedo": "rgba(140, 140, 146, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.82, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["bucklePlate"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_buckle_49.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.028, 0.115], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.055, 0.045, 0.022], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "buckle", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["pelvis"] ?? root).add(node_buckle_49);
  nodes["buckle"] = node_buckle_49;
  const mesh_buckle_49Geometry = endpoint_buckle_49
    ? new THREE.CylinderGeometry(endpoint_buckle_49.endRadius, endpoint_buckle_49.baseRadius, endpoint_buckle_49.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_buckle_49) {
    mesh_buckle_49Geometry.scale(0.055, 0.045, 0.022);
  }
  const mesh_buckle_49 = new THREE.Mesh(
    mesh_buckle_49Geometry,
    materialMap["metal-gray"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_buckle_49.name = "Belt buckle";
  if (endpoint_buckle_49) {
    mesh_buckle_49.position.copy(endpoint_buckle_49.midpoint);
    mesh_buckle_49.quaternion.copy(endpoint_buckle_49.quaternion);
  }
  mesh_buckle_49.castShadow = options.castShadow ?? true;
  mesh_buckle_49.receiveShadow = options.receiveShadow ?? true;
  mesh_buckle_49.userData.sculptComponent = {"id": "buckle", "name": "Belt buckle", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A square buckle sits at the belt's centre front, drawn in the same white as the belt.", "geometryDescriptor": {"topologyIntent": "a square buckle plate at the belt centre", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "pelvis", "dimensions": {"width": 0.055, "height": 0.045, "depth": 0.022, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, 0.028, 0.115], "rotation": [0.0, 0.0, 0.0], "scale": [0.055, 0.045, 0.022]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.028, 0.115], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.055, 0.045, 0.022], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "buckle", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "metal-gray", "materialLayers": ["metal-gray"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(185, 185, 185, 1.0)", "secondaryAlbedo": "rgba(140, 140, 146, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.82, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["bucklePlate"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_buckle_49.add(mesh_buckle_49);
  meshes["buckle"] = mesh_buckle_49;
  colliders["buckle"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.055, 0.045, 0.022], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["buckle"] ??= [];
  destructionGroups["buckle"].push(node_buckle_49);

  const endpoint_coat_trim_hem_50 = makeAttachmentEndpoint(null);
  const node_coat_trim_hem_50 = new THREE.Group();
  node_coat_trim_hem_50.name = "Coat hem trim__pivot";
  node_coat_trim_hem_50.scale.set(1, 1, 1);
  if (endpoint_coat_trim_hem_50) {
    node_coat_trim_hem_50.position.copy(endpoint_coat_trim_hem_50.start);
    node_coat_trim_hem_50.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_coat_trim_hem_50.position.set(0.0, -0.317, 0.03);
    node_coat_trim_hem_50.rotation.set(0.0, 0.0, 0.0);
  }
  node_coat_trim_hem_50.userData.sculptComponent = {"id": "coat-trim-hem", "name": "Coat hem trim", "level": "meso", "role": "garment", "importance": 0.85, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The reference carries white linework along the coat hem as well as the panel openings; both are bounded geometry, not painted texture.", "geometryDescriptor": {"topologyIntent": "a white line running the full coat hem", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "coat", "dimensions": {"width": 0.3, "height": 0.01, "depth": 0.185, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.317, 0.03], "rotation": [0.0, 0.0, 0.0], "scale": [0.3, 0.01, 0.185]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, -0.317, 0.03], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.3, 0.01, 0.185], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coat-trim-hem", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "trim-white", "materialLayers": ["trim-white"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 233, 233, 1.0)", "secondaryAlbedo": "rgba(198, 198, 204, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.86, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["hemTrim"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_coat_trim_hem_50.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, -0.317, 0.03], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.3, 0.01, 0.185], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coat-trim-hem", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["coat"] ?? root).add(node_coat_trim_hem_50);
  nodes["coat-trim-hem"] = node_coat_trim_hem_50;
  const mesh_coat_trim_hem_50Geometry = endpoint_coat_trim_hem_50
    ? new THREE.CylinderGeometry(endpoint_coat_trim_hem_50.endRadius, endpoint_coat_trim_hem_50.baseRadius, endpoint_coat_trim_hem_50.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_coat_trim_hem_50) {
    mesh_coat_trim_hem_50Geometry.scale(0.3, 0.01, 0.185);
  }
  const mesh_coat_trim_hem_50 = new THREE.Mesh(
    mesh_coat_trim_hem_50Geometry,
    materialMap["trim-white"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_coat_trim_hem_50.name = "Coat hem trim";
  if (endpoint_coat_trim_hem_50) {
    mesh_coat_trim_hem_50.position.copy(endpoint_coat_trim_hem_50.midpoint);
    mesh_coat_trim_hem_50.quaternion.copy(endpoint_coat_trim_hem_50.quaternion);
  }
  mesh_coat_trim_hem_50.castShadow = options.castShadow ?? true;
  mesh_coat_trim_hem_50.receiveShadow = options.receiveShadow ?? true;
  mesh_coat_trim_hem_50.userData.sculptComponent = {"id": "coat-trim-hem", "name": "Coat hem trim", "level": "meso", "role": "garment", "importance": 0.85, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The reference carries white linework along the coat hem as well as the panel openings; both are bounded geometry, not painted texture.", "geometryDescriptor": {"topologyIntent": "a white line running the full coat hem", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "coat", "dimensions": {"width": 0.3, "height": 0.01, "depth": 0.185, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.317, 0.03], "rotation": [0.0, 0.0, 0.0], "scale": [0.3, 0.01, 0.185]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, -0.317, 0.03], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.3, 0.01, 0.185], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coat-trim-hem", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "trim-white", "materialLayers": ["trim-white"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 233, 233, 1.0)", "secondaryAlbedo": "rgba(198, 198, 204, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.86, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["hemTrim"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_coat_trim_hem_50.add(mesh_coat_trim_hem_50);
  meshes["coat-trim-hem"] = mesh_coat_trim_hem_50;
  colliders["coat-trim-hem"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.3, 0.01, 0.185], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["coat-trim-hem"] ??= [];
  destructionGroups["coat-trim-hem"].push(node_coat_trim_hem_50);

  const endpoint_choker_ring_51 = makeAttachmentEndpoint(null);
  const node_choker_ring_51 = new THREE.Group();
  node_choker_ring_51.name = "Choker ring pendant__pivot";
  node_choker_ring_51.scale.set(1, 1, 1);
  if (endpoint_choker_ring_51) {
    node_choker_ring_51.position.copy(endpoint_choker_ring_51.start);
    node_choker_ring_51.rotation.set(-1.5708, 0.0, 0.0);
  } else {
    node_choker_ring_51.position.set(0.0, -0.002, 0.052);
    node_choker_ring_51.rotation.set(-1.5708, 0.0, 0.0);
  }
  node_choker_ring_51.userData.sculptComponent = {"id": "choker-ring", "name": "Choker ring pendant", "level": "meso", "role": "body", "importance": 0.85, "confidence": 0.8, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "The choker's ring pendant is one of only two metal elements in the design, and it is the only specular read at the throat.", "geometryDescriptor": {"topologyIntent": "a small metal ring hanging at the front of the choker", "torusTubeRatio": 0.16, "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "choker", "dimensions": {"width": 0.055, "height": 0.055, "depth": 0.055, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.002, 0.052], "rotation": [-1.5708, 0.0, 0.0], "scale": [0.055, 0.055, 0.055]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, -0.002, 0.052], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.055, 0.055, 0.055], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "choker-ring", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "metal-gray", "materialLayers": ["metal-gray"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(185, 185, 185, 1.0)", "secondaryAlbedo": "rgba(140, 140, 146, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.82, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["chokerRing"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_choker_ring_51.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, -0.002, 0.052], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.055, 0.055, 0.055], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "choker-ring", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["choker"] ?? root).add(node_choker_ring_51);
  nodes["choker-ring"] = node_choker_ring_51;
  const mesh_choker_ring_51Geometry = endpoint_choker_ring_51
    ? new THREE.CylinderGeometry(endpoint_choker_ring_51.endRadius, endpoint_choker_ring_51.baseRadius, endpoint_choker_ring_51.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.072, 24, 96);
  if (!endpoint_choker_ring_51) {
    mesh_choker_ring_51Geometry.scale(0.055, 0.055, 0.055);
  }
  const mesh_choker_ring_51 = new THREE.Mesh(
    mesh_choker_ring_51Geometry,
    materialMap["metal-gray"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_choker_ring_51.name = "Choker ring pendant";
  if (endpoint_choker_ring_51) {
    mesh_choker_ring_51.position.copy(endpoint_choker_ring_51.midpoint);
    mesh_choker_ring_51.quaternion.copy(endpoint_choker_ring_51.quaternion);
  }
  mesh_choker_ring_51.castShadow = options.castShadow ?? true;
  mesh_choker_ring_51.receiveShadow = options.receiveShadow ?? true;
  mesh_choker_ring_51.userData.sculptComponent = {"id": "choker-ring", "name": "Choker ring pendant", "level": "meso", "role": "body", "importance": 0.85, "confidence": 0.8, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "The choker's ring pendant is one of only two metal elements in the design, and it is the only specular read at the throat.", "geometryDescriptor": {"topologyIntent": "a small metal ring hanging at the front of the choker", "torusTubeRatio": 0.16, "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "choker", "dimensions": {"width": 0.055, "height": 0.055, "depth": 0.055, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.002, 0.052], "rotation": [-1.5708, 0.0, 0.0], "scale": [0.055, 0.055, 0.055]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, -0.002, 0.052], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.055, 0.055, 0.055], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "choker-ring", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "metal-gray", "materialLayers": ["metal-gray"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(185, 185, 185, 1.0)", "secondaryAlbedo": "rgba(140, 140, 146, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.82, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["chokerRing"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_choker_ring_51.add(mesh_choker_ring_51);
  meshes["choker-ring"] = mesh_choker_ring_51;
  colliders["choker-ring"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.055, 0.055, 0.055], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["choker-ring"] ??= [];
  destructionGroups["choker-ring"].push(node_choker_ring_51);

  const endpoint_halter_ring_52 = makeAttachmentEndpoint(null);
  const node_halter_ring_52 = new THREE.Group();
  node_halter_ring_52.name = "Halter centre ring__pivot";
  node_halter_ring_52.scale.set(1, 1, 1);
  if (endpoint_halter_ring_52) {
    node_halter_ring_52.position.copy(endpoint_halter_ring_52.start);
    node_halter_ring_52.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_halter_ring_52.position.set(0.0, 0.044, 0.013);
    node_halter_ring_52.rotation.set(0.0, 0.0, 0.0);
  }
  node_halter_ring_52.userData.sculptComponent = {"id": "halter-ring", "name": "Halter centre ring", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.8, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "The front view shows a small ring at the centre of the halter where the two straps meet.", "geometryDescriptor": {"topologyIntent": "a small ring joining the halter straps at the chest", "torusTubeRatio": 0.2, "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "halter-top", "dimensions": {"width": 0.03, "height": 0.03, "depth": 0.03, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, 0.044, 0.013], "rotation": [0.0, 0.0, 0.0], "scale": [0.03, 0.03, 0.03]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.044, 0.013], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.03, 0.03, 0.03], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "halter-ring", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "metal-gray", "materialLayers": ["metal-gray"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(185, 185, 185, 1.0)", "secondaryAlbedo": "rgba(140, 140, 146, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.82, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["halterRing"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_halter_ring_52.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.044, 0.013], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.03, 0.03, 0.03], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "halter-ring", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["halter-top"] ?? root).add(node_halter_ring_52);
  nodes["halter-ring"] = node_halter_ring_52;
  const mesh_halter_ring_52Geometry = endpoint_halter_ring_52
    ? new THREE.CylinderGeometry(endpoint_halter_ring_52.endRadius, endpoint_halter_ring_52.baseRadius, endpoint_halter_ring_52.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.09, 24, 96);
  if (!endpoint_halter_ring_52) {
    mesh_halter_ring_52Geometry.scale(0.03, 0.03, 0.03);
  }
  const mesh_halter_ring_52 = new THREE.Mesh(
    mesh_halter_ring_52Geometry,
    materialMap["metal-gray"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_halter_ring_52.name = "Halter centre ring";
  if (endpoint_halter_ring_52) {
    mesh_halter_ring_52.position.copy(endpoint_halter_ring_52.midpoint);
    mesh_halter_ring_52.quaternion.copy(endpoint_halter_ring_52.quaternion);
  }
  mesh_halter_ring_52.castShadow = options.castShadow ?? true;
  mesh_halter_ring_52.receiveShadow = options.receiveShadow ?? true;
  mesh_halter_ring_52.userData.sculptComponent = {"id": "halter-ring", "name": "Halter centre ring", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.8, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "The front view shows a small ring at the centre of the halter where the two straps meet.", "geometryDescriptor": {"topologyIntent": "a small ring joining the halter straps at the chest", "torusTubeRatio": 0.2, "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "halter-top", "dimensions": {"width": 0.03, "height": 0.03, "depth": 0.03, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, 0.044, 0.013], "rotation": [0.0, 0.0, 0.0], "scale": [0.03, 0.03, 0.03]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.044, 0.013], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.03, 0.03, 0.03], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "halter-ring", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "metal-gray", "materialLayers": ["metal-gray"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(185, 185, 185, 1.0)", "secondaryAlbedo": "rgba(140, 140, 146, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.82, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["halterRing"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_halter_ring_52.add(mesh_halter_ring_52);
  meshes["halter-ring"] = mesh_halter_ring_52;
  colliders["halter-ring"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.03, 0.03, 0.03], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["halter-ring"] ??= [];
  destructionGroups["halter-ring"].push(node_halter_ring_52);

  const attachment_upper_arm_l_53 = {"parentId": "chest", "parentSocket": "shoulder-l", "localStart": [0.145, 0.04, 0.0], "localEnd": [0.24, -0.145, 0.0], "contactType": "socket", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.002, "baseRadius": 0.042, "endRadius": 0.037};
  const endpoint_upper_arm_l_53 = makeAttachmentEndpoint(attachment_upper_arm_l_53);
  const node_upper_arm_l_53 = new THREE.Group();
  node_upper_arm_l_53.name = "Upper arm sleeve (l)__pivot";
  node_upper_arm_l_53.scale.set(1, 1, 1);
  if (endpoint_upper_arm_l_53) {
    node_upper_arm_l_53.position.copy(endpoint_upper_arm_l_53.start);
    node_upper_arm_l_53.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_upper_arm_l_53.position.set(0.145, 0.04, 0.0);
    node_upper_arm_l_53.rotation.set(0.0, 0.0, 0.0);
  }
  node_upper_arm_l_53.userData.sculptComponent = {"id": "upper-arm-l", "name": "Upper arm sleeve (l)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Arms are abducted 28 degrees off vertical, read from the front silhouette; the sleeve is a black tapered cylinder of 0.082 base diameter.", "geometryDescriptor": {"topologyIntent": "Upper arm sleeve (l) as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "chest", "dimensions": {"width": 0.082, "height": 0.21, "depth": 0.082, "units": "relative", "confidence": 0.9}, "transform": {"position": [0.145, 0.04, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.082, 0.21, 0.082]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.145, 0.04, 0.0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.082, 0.21, 0.082], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "upper-arm-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["sleeveFold"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "chest", "parentSocket": "shoulder-l", "localStart": [0.145, 0.04, 0.0], "localEnd": [0.24, -0.145, 0.0], "contactType": "socket", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.002, "baseRadius": 0.042, "endRadius": 0.037}};
  node_upper_arm_l_53.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.145, 0.04, 0.0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.082, 0.21, 0.082], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "upper-arm-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["chest"] ?? root).add(node_upper_arm_l_53);
  nodes["upper-arm-l"] = node_upper_arm_l_53;
  const mesh_upper_arm_l_53Geometry = endpoint_upper_arm_l_53
    ? new THREE.CylinderGeometry(endpoint_upper_arm_l_53.endRadius, endpoint_upper_arm_l_53.baseRadius, endpoint_upper_arm_l_53.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_upper_arm_l_53) {
    mesh_upper_arm_l_53Geometry.scale(0.082, 0.21, 0.082);
  }
  const mesh_upper_arm_l_53 = new THREE.Mesh(
    mesh_upper_arm_l_53Geometry,
    materialMap["cloth-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_upper_arm_l_53.name = "Upper arm sleeve (l)";
  if (endpoint_upper_arm_l_53) {
    mesh_upper_arm_l_53.position.copy(endpoint_upper_arm_l_53.midpoint);
    mesh_upper_arm_l_53.quaternion.copy(endpoint_upper_arm_l_53.quaternion);
  }
  mesh_upper_arm_l_53.castShadow = options.castShadow ?? true;
  mesh_upper_arm_l_53.receiveShadow = options.receiveShadow ?? true;
  mesh_upper_arm_l_53.userData.sculptComponent = {"id": "upper-arm-l", "name": "Upper arm sleeve (l)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Arms are abducted 28 degrees off vertical, read from the front silhouette; the sleeve is a black tapered cylinder of 0.082 base diameter.", "geometryDescriptor": {"topologyIntent": "Upper arm sleeve (l) as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "chest", "dimensions": {"width": 0.082, "height": 0.21, "depth": 0.082, "units": "relative", "confidence": 0.9}, "transform": {"position": [0.145, 0.04, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.082, 0.21, 0.082]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.145, 0.04, 0.0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.082, 0.21, 0.082], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "upper-arm-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["sleeveFold"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "chest", "parentSocket": "shoulder-l", "localStart": [0.145, 0.04, 0.0], "localEnd": [0.24, -0.145, 0.0], "contactType": "socket", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.002, "baseRadius": 0.042, "endRadius": 0.037}};
  node_upper_arm_l_53.add(mesh_upper_arm_l_53);
  meshes["upper-arm-l"] = mesh_upper_arm_l_53;
  colliders["upper-arm-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.082, 0.21, 0.082], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["upper-arm-l"] ??= [];
  destructionGroups["upper-arm-l"].push(node_upper_arm_l_53);

  const attachment_forearm_l_54 = {"parentId": "upper-arm-l", "parentSocket": "elbow-l", "localStart": [0.095, -0.185, 0.0], "localEnd": [0.155, -0.335, 0.0], "contactType": "socket", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.002, "baseRadius": 0.037, "endRadius": 0.031};
  const endpoint_forearm_l_54 = makeAttachmentEndpoint(attachment_forearm_l_54);
  const node_forearm_l_54 = new THREE.Group();
  node_forearm_l_54.name = "Forearm sleeve (l)__pivot";
  node_forearm_l_54.scale.set(1, 1, 1);
  if (endpoint_forearm_l_54) {
    node_forearm_l_54.position.copy(endpoint_forearm_l_54.start);
    node_forearm_l_54.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_forearm_l_54.position.set(0.095, -0.185, 0.0);
    node_forearm_l_54.rotation.set(0.0, 0.0, 0.0);
  }
  node_forearm_l_54.userData.sculptComponent = {"id": "forearm-l", "name": "Forearm sleeve (l)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Forearm continues the 28 degree line with a slight extra outward break, ending at the wrist at y 0.21.", "geometryDescriptor": {"topologyIntent": "Forearm sleeve (l) as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "upper-arm-l", "dimensions": {"width": 0.072, "height": 0.17, "depth": 0.072, "units": "relative", "confidence": 0.9}, "transform": {"position": [0.095, -0.185, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.072, 0.17, 0.072]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.095, -0.185, 0.0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.072, 0.17, 0.072], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "forearm-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["cuffLine"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "upper-arm-l", "parentSocket": "elbow-l", "localStart": [0.095, -0.185, 0.0], "localEnd": [0.155, -0.335, 0.0], "contactType": "socket", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.002, "baseRadius": 0.037, "endRadius": 0.031}};
  node_forearm_l_54.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.095, -0.185, 0.0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.072, 0.17, 0.072], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "forearm-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["upper-arm-l"] ?? root).add(node_forearm_l_54);
  nodes["forearm-l"] = node_forearm_l_54;
  const mesh_forearm_l_54Geometry = endpoint_forearm_l_54
    ? new THREE.CylinderGeometry(endpoint_forearm_l_54.endRadius, endpoint_forearm_l_54.baseRadius, endpoint_forearm_l_54.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_forearm_l_54) {
    mesh_forearm_l_54Geometry.scale(0.072, 0.17, 0.072);
  }
  const mesh_forearm_l_54 = new THREE.Mesh(
    mesh_forearm_l_54Geometry,
    materialMap["cloth-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_forearm_l_54.name = "Forearm sleeve (l)";
  if (endpoint_forearm_l_54) {
    mesh_forearm_l_54.position.copy(endpoint_forearm_l_54.midpoint);
    mesh_forearm_l_54.quaternion.copy(endpoint_forearm_l_54.quaternion);
  }
  mesh_forearm_l_54.castShadow = options.castShadow ?? true;
  mesh_forearm_l_54.receiveShadow = options.receiveShadow ?? true;
  mesh_forearm_l_54.userData.sculptComponent = {"id": "forearm-l", "name": "Forearm sleeve (l)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Forearm continues the 28 degree line with a slight extra outward break, ending at the wrist at y 0.21.", "geometryDescriptor": {"topologyIntent": "Forearm sleeve (l) as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "upper-arm-l", "dimensions": {"width": 0.072, "height": 0.17, "depth": 0.072, "units": "relative", "confidence": 0.9}, "transform": {"position": [0.095, -0.185, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.072, 0.17, 0.072]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.095, -0.185, 0.0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.072, 0.17, 0.072], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "forearm-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["cuffLine"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "upper-arm-l", "parentSocket": "elbow-l", "localStart": [0.095, -0.185, 0.0], "localEnd": [0.155, -0.335, 0.0], "contactType": "socket", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.002, "baseRadius": 0.037, "endRadius": 0.031}};
  node_forearm_l_54.add(mesh_forearm_l_54);
  meshes["forearm-l"] = mesh_forearm_l_54;
  colliders["forearm-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.072, 0.17, 0.072], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["forearm-l"] ??= [];
  destructionGroups["forearm-l"].push(node_forearm_l_54);

  const endpoint_hand_l_55 = makeAttachmentEndpoint(null);
  const node_hand_l_55 = new THREE.Group();
  node_hand_l_55.name = "Fingerless glove (l)__pivot";
  node_hand_l_55.scale.set(1, 1, 1);
  if (endpoint_hand_l_55) {
    node_hand_l_55.position.copy(endpoint_hand_l_55.start);
    node_hand_l_55.rotation.set(0.0, 0.0, 0.3);
  } else {
    node_hand_l_55.position.set(0.075, -0.195, 0.012);
    node_hand_l_55.rotation.set(0.0, 0.0, 0.3);
  }
  node_hand_l_55.userData.sculptComponent = {"id": "hand-l", "name": "Fingerless glove (l)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A dark mitt with a cuff solves the hand: finger separation is hidden by the sleeves in all three views, so it is not invented.", "geometryDescriptor": {"topologyIntent": "Fingerless glove (l) as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "forearm-l", "dimensions": {"width": 0.07, "height": 0.105, "depth": 0.058, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.075, -0.195, 0.012], "rotation": [0.0, 0.0, 0.3], "scale": [0.07, 0.105, 0.058]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.075, -0.195, 0.012], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.07, 0.105, 0.058], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hand-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["gloveCuff"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_hand_l_55.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.075, -0.195, 0.012], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.07, 0.105, 0.058], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hand-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["forearm-l"] ?? root).add(node_hand_l_55);
  nodes["hand-l"] = node_hand_l_55;
  const mesh_hand_l_55Geometry = endpoint_hand_l_55
    ? new THREE.CylinderGeometry(endpoint_hand_l_55.endRadius, endpoint_hand_l_55.baseRadius, endpoint_hand_l_55.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_hand_l_55) {
    mesh_hand_l_55Geometry.scale(0.07, 0.105, 0.058);
  }
  const mesh_hand_l_55 = new THREE.Mesh(
    mesh_hand_l_55Geometry,
    materialMap["cloth-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hand_l_55.name = "Fingerless glove (l)";
  if (endpoint_hand_l_55) {
    mesh_hand_l_55.position.copy(endpoint_hand_l_55.midpoint);
    mesh_hand_l_55.quaternion.copy(endpoint_hand_l_55.quaternion);
  }
  mesh_hand_l_55.castShadow = options.castShadow ?? true;
  mesh_hand_l_55.receiveShadow = options.receiveShadow ?? true;
  mesh_hand_l_55.userData.sculptComponent = {"id": "hand-l", "name": "Fingerless glove (l)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A dark mitt with a cuff solves the hand: finger separation is hidden by the sleeves in all three views, so it is not invented.", "geometryDescriptor": {"topologyIntent": "Fingerless glove (l) as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "forearm-l", "dimensions": {"width": 0.07, "height": 0.105, "depth": 0.058, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.075, -0.195, 0.012], "rotation": [0.0, 0.0, 0.3], "scale": [0.07, 0.105, 0.058]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.075, -0.195, 0.012], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.07, 0.105, 0.058], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hand-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["gloveCuff"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_hand_l_55.add(mesh_hand_l_55);
  meshes["hand-l"] = mesh_hand_l_55;
  colliders["hand-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.07, 0.105, 0.058], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["hand-l"] ??= [];
  destructionGroups["hand-l"].push(node_hand_l_55);

  const attachment_thigh_l_56 = {"parentId": "pelvis", "parentSocket": "hip-l", "localStart": [0.085, 0.0, 0.0], "localEnd": [0.09, -0.097, 0.0], "contactType": "socket", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.002, "baseRadius": 0.044, "endRadius": 0.041};
  const endpoint_thigh_l_56 = makeAttachmentEndpoint(attachment_thigh_l_56);
  const node_thigh_l_56 = new THREE.Group();
  node_thigh_l_56.name = "Thigh (l)__pivot";
  node_thigh_l_56.scale.set(1, 1, 1);
  if (endpoint_thigh_l_56) {
    node_thigh_l_56.position.copy(endpoint_thigh_l_56.start);
    node_thigh_l_56.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_thigh_l_56.position.set(0.085, 0.0, 0.0);
    node_thigh_l_56.rotation.set(0.0, 0.0, 0.0);
  }
  node_thigh_l_56.userData.sculptComponent = {"id": "thigh-l", "name": "Thigh (l)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Bare thigh band measured at y 778-844 px; it is short, which is the chibi read, not a measurement error.", "geometryDescriptor": {"topologyIntent": "Thigh (l) as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "pelvis", "dimensions": {"width": 0.086, "height": 0.11, "depth": 0.086, "units": "relative", "confidence": 0.9}, "transform": {"position": [0.085, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.086, 0.11, 0.086]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.085, 0.0, 0.0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.086, 0.11, 0.086], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "thigh-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 222, 210, 1.0)", "secondaryAlbedo": "rgba(214, 186, 170, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.92, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["thighBand"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "pelvis", "parentSocket": "hip-l", "localStart": [0.085, 0.0, 0.0], "localEnd": [0.09, -0.097, 0.0], "contactType": "socket", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.002, "baseRadius": 0.044, "endRadius": 0.041}};
  node_thigh_l_56.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.085, 0.0, 0.0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.086, 0.11, 0.086], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "thigh-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["pelvis"] ?? root).add(node_thigh_l_56);
  nodes["thigh-l"] = node_thigh_l_56;
  const mesh_thigh_l_56Geometry = endpoint_thigh_l_56
    ? new THREE.CylinderGeometry(endpoint_thigh_l_56.endRadius, endpoint_thigh_l_56.baseRadius, endpoint_thigh_l_56.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_thigh_l_56) {
    mesh_thigh_l_56Geometry.scale(0.086, 0.11, 0.086);
  }
  const mesh_thigh_l_56 = new THREE.Mesh(
    mesh_thigh_l_56Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_thigh_l_56.name = "Thigh (l)";
  if (endpoint_thigh_l_56) {
    mesh_thigh_l_56.position.copy(endpoint_thigh_l_56.midpoint);
    mesh_thigh_l_56.quaternion.copy(endpoint_thigh_l_56.quaternion);
  }
  mesh_thigh_l_56.castShadow = options.castShadow ?? true;
  mesh_thigh_l_56.receiveShadow = options.receiveShadow ?? true;
  mesh_thigh_l_56.userData.sculptComponent = {"id": "thigh-l", "name": "Thigh (l)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Bare thigh band measured at y 778-844 px; it is short, which is the chibi read, not a measurement error.", "geometryDescriptor": {"topologyIntent": "Thigh (l) as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "pelvis", "dimensions": {"width": 0.086, "height": 0.11, "depth": 0.086, "units": "relative", "confidence": 0.9}, "transform": {"position": [0.085, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.086, 0.11, 0.086]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.085, 0.0, 0.0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.086, 0.11, 0.086], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "thigh-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 222, 210, 1.0)", "secondaryAlbedo": "rgba(214, 186, 170, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.92, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["thighBand"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "pelvis", "parentSocket": "hip-l", "localStart": [0.085, 0.0, 0.0], "localEnd": [0.09, -0.097, 0.0], "contactType": "socket", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.002, "baseRadius": 0.044, "endRadius": 0.041}};
  node_thigh_l_56.add(mesh_thigh_l_56);
  meshes["thigh-l"] = mesh_thigh_l_56;
  colliders["thigh-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.086, 0.11, 0.086], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["thigh-l"] ??= [];
  destructionGroups["thigh-l"].push(node_thigh_l_56);

  const endpoint_boot_shaft_l_57 = makeAttachmentEndpoint(null);
  const node_boot_shaft_l_57 = new THREE.Group();
  node_boot_shaft_l_57.name = "Boot shaft (l)__pivot";
  node_boot_shaft_l_57.scale.set(1, 1, 1);
  if (endpoint_boot_shaft_l_57) {
    node_boot_shaft_l_57.position.copy(endpoint_boot_shaft_l_57.start);
    node_boot_shaft_l_57.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_boot_shaft_l_57.position.set(0.005, -0.185, 0.01);
    node_boot_shaft_l_57.rotation.set(0.0, 0.0, 0.0);
  }
  node_boot_shaft_l_57.userData.sculptComponent = {"id": "boot-shaft-l", "name": "Boot shaft (l)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The boot shaft rises above the knee line (measured boot top at y 0.202 of total height) and carries the chevron trim.", "geometryDescriptor": {"topologyIntent": "Boot shaft (l) as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "thigh-l", "dimensions": {"width": 0.105, "height": 0.19, "depth": 0.115, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.005, -0.185, 0.01], "rotation": [0.0, 0.0, 0.0], "scale": [0.105, 0.19, 0.115]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.005, -0.185, 0.01], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.19, 0.115], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "boot-shaft-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["bootTrim"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_boot_shaft_l_57.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.005, -0.185, 0.01], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.19, 0.115], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "boot-shaft-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["thigh-l"] ?? root).add(node_boot_shaft_l_57);
  nodes["boot-shaft-l"] = node_boot_shaft_l_57;
  const mesh_boot_shaft_l_57Geometry = endpoint_boot_shaft_l_57
    ? new THREE.CylinderGeometry(endpoint_boot_shaft_l_57.endRadius, endpoint_boot_shaft_l_57.baseRadius, endpoint_boot_shaft_l_57.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_boot_shaft_l_57) {
    mesh_boot_shaft_l_57Geometry.scale(0.105, 0.19, 0.115);
  }
  const mesh_boot_shaft_l_57 = new THREE.Mesh(
    mesh_boot_shaft_l_57Geometry,
    materialMap["cloth-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_boot_shaft_l_57.name = "Boot shaft (l)";
  if (endpoint_boot_shaft_l_57) {
    mesh_boot_shaft_l_57.position.copy(endpoint_boot_shaft_l_57.midpoint);
    mesh_boot_shaft_l_57.quaternion.copy(endpoint_boot_shaft_l_57.quaternion);
  }
  mesh_boot_shaft_l_57.castShadow = options.castShadow ?? true;
  mesh_boot_shaft_l_57.receiveShadow = options.receiveShadow ?? true;
  mesh_boot_shaft_l_57.userData.sculptComponent = {"id": "boot-shaft-l", "name": "Boot shaft (l)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The boot shaft rises above the knee line (measured boot top at y 0.202 of total height) and carries the chevron trim.", "geometryDescriptor": {"topologyIntent": "Boot shaft (l) as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "thigh-l", "dimensions": {"width": 0.105, "height": 0.19, "depth": 0.115, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.005, -0.185, 0.01], "rotation": [0.0, 0.0, 0.0], "scale": [0.105, 0.19, 0.115]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.005, -0.185, 0.01], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.19, 0.115], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "boot-shaft-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["bootTrim"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_boot_shaft_l_57.add(mesh_boot_shaft_l_57);
  meshes["boot-shaft-l"] = mesh_boot_shaft_l_57;
  colliders["boot-shaft-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.19, 0.115], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["boot-shaft-l"] ??= [];
  destructionGroups["boot-shaft-l"].push(node_boot_shaft_l_57);

  const endpoint_boot_chevron_l_58 = makeAttachmentEndpoint(null);
  const node_boot_chevron_l_58 = new THREE.Group();
  node_boot_chevron_l_58.name = "Boot chevron trim (l)__pivot";
  node_boot_chevron_l_58.scale.set(1, 1, 1);
  if (endpoint_boot_chevron_l_58) {
    node_boot_chevron_l_58.position.copy(endpoint_boot_chevron_l_58.start);
    node_boot_chevron_l_58.rotation.set(0.0, 0.0, 0.35);
  } else {
    node_boot_chevron_l_58.position.set(0.0, 0.063, 0.058);
    node_boot_chevron_l_58.rotation.set(0.0, 0.0, 0.35);
  }
  node_boot_chevron_l_58.userData.sculptComponent = {"id": "boot-chevron-l", "name": "Boot chevron trim (l)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Two nested white V strokes wrap each boot at ankle height; the reference shows them as hard-edged geometry, not shading.", "geometryDescriptor": {"topologyIntent": "a nested white V stroke on the boot's outer face", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "boot-shaft-l", "dimensions": {"width": 0.095, "height": 0.03, "depth": 0.02, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, 0.063, 0.058], "rotation": [0.0, 0.0, 0.35], "scale": [0.095, 0.03, 0.02]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.063, 0.058], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.095, 0.03, 0.02], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "boot-chevron-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "trim-white", "materialLayers": ["trim-white"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 233, 233, 1.0)", "secondaryAlbedo": "rgba(198, 198, 204, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.86, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["bootChevron"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_boot_chevron_l_58.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.063, 0.058], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.095, 0.03, 0.02], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "boot-chevron-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["boot-shaft-l"] ?? root).add(node_boot_chevron_l_58);
  nodes["boot-chevron-l"] = node_boot_chevron_l_58;
  const mesh_boot_chevron_l_58Geometry = endpoint_boot_chevron_l_58
    ? new THREE.CylinderGeometry(endpoint_boot_chevron_l_58.endRadius, endpoint_boot_chevron_l_58.baseRadius, endpoint_boot_chevron_l_58.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_boot_chevron_l_58) {
    mesh_boot_chevron_l_58Geometry.scale(0.095, 0.03, 0.02);
  }
  const mesh_boot_chevron_l_58 = new THREE.Mesh(
    mesh_boot_chevron_l_58Geometry,
    materialMap["trim-white"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_boot_chevron_l_58.name = "Boot chevron trim (l)";
  if (endpoint_boot_chevron_l_58) {
    mesh_boot_chevron_l_58.position.copy(endpoint_boot_chevron_l_58.midpoint);
    mesh_boot_chevron_l_58.quaternion.copy(endpoint_boot_chevron_l_58.quaternion);
  }
  mesh_boot_chevron_l_58.castShadow = options.castShadow ?? true;
  mesh_boot_chevron_l_58.receiveShadow = options.receiveShadow ?? true;
  mesh_boot_chevron_l_58.userData.sculptComponent = {"id": "boot-chevron-l", "name": "Boot chevron trim (l)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Two nested white V strokes wrap each boot at ankle height; the reference shows them as hard-edged geometry, not shading.", "geometryDescriptor": {"topologyIntent": "a nested white V stroke on the boot's outer face", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "boot-shaft-l", "dimensions": {"width": 0.095, "height": 0.03, "depth": 0.02, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, 0.063, 0.058], "rotation": [0.0, 0.0, 0.35], "scale": [0.095, 0.03, 0.02]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.063, 0.058], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.095, 0.03, 0.02], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "boot-chevron-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "trim-white", "materialLayers": ["trim-white"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 233, 233, 1.0)", "secondaryAlbedo": "rgba(198, 198, 204, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.86, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["bootChevron"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_boot_chevron_l_58.add(mesh_boot_chevron_l_58);
  meshes["boot-chevron-l"] = mesh_boot_chevron_l_58;
  colliders["boot-chevron-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.095, 0.03, 0.02], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["boot-chevron-l"] ??= [];
  destructionGroups["boot-chevron-l"].push(node_boot_chevron_l_58);

  const endpoint_boot_foot_l_59 = makeAttachmentEndpoint(null);
  const node_boot_foot_l_59 = new THREE.Group();
  node_boot_foot_l_59.name = "Boot foot (l)__pivot";
  node_boot_foot_l_59.scale.set(1, 1, 1);
  if (endpoint_boot_foot_l_59) {
    node_boot_foot_l_59.position.copy(endpoint_boot_foot_l_59.start);
    node_boot_foot_l_59.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_boot_foot_l_59.position.set(0.0, -0.07, 0.028);
    node_boot_foot_l_59.rotation.set(0.0, 0.0, 0.0);
  }
  node_boot_foot_l_59.userData.sculptComponent = {"id": "boot-foot-l", "name": "Boot foot (l)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The boot's foot section extends forward of the shaft; the side view shows it as the only part reaching past the body's depth.", "geometryDescriptor": {"topologyIntent": "Boot foot (l) as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "boot-shaft-l", "dimensions": {"width": 0.105, "height": 0.06, "depth": 0.185, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, -0.07, 0.028], "rotation": [0.0, 0.0, 0.0], "scale": [0.105, 0.06, 0.185]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, -0.07, 0.028], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.06, 0.185], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "boot-foot-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["toeCap"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_boot_foot_l_59.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, -0.07, 0.028], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.06, 0.185], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "boot-foot-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["boot-shaft-l"] ?? root).add(node_boot_foot_l_59);
  nodes["boot-foot-l"] = node_boot_foot_l_59;
  const mesh_boot_foot_l_59Geometry = endpoint_boot_foot_l_59
    ? new THREE.CylinderGeometry(endpoint_boot_foot_l_59.endRadius, endpoint_boot_foot_l_59.baseRadius, endpoint_boot_foot_l_59.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_boot_foot_l_59) {
    mesh_boot_foot_l_59Geometry.scale(0.105, 0.06, 0.185);
  }
  const mesh_boot_foot_l_59 = new THREE.Mesh(
    mesh_boot_foot_l_59Geometry,
    materialMap["cloth-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_boot_foot_l_59.name = "Boot foot (l)";
  if (endpoint_boot_foot_l_59) {
    mesh_boot_foot_l_59.position.copy(endpoint_boot_foot_l_59.midpoint);
    mesh_boot_foot_l_59.quaternion.copy(endpoint_boot_foot_l_59.quaternion);
  }
  mesh_boot_foot_l_59.castShadow = options.castShadow ?? true;
  mesh_boot_foot_l_59.receiveShadow = options.receiveShadow ?? true;
  mesh_boot_foot_l_59.userData.sculptComponent = {"id": "boot-foot-l", "name": "Boot foot (l)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The boot's foot section extends forward of the shaft; the side view shows it as the only part reaching past the body's depth.", "geometryDescriptor": {"topologyIntent": "Boot foot (l) as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "boot-shaft-l", "dimensions": {"width": 0.105, "height": 0.06, "depth": 0.185, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, -0.07, 0.028], "rotation": [0.0, 0.0, 0.0], "scale": [0.105, 0.06, 0.185]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, -0.07, 0.028], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.06, 0.185], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "boot-foot-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["toeCap"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_boot_foot_l_59.add(mesh_boot_foot_l_59);
  meshes["boot-foot-l"] = mesh_boot_foot_l_59;
  colliders["boot-foot-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.06, 0.185], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["boot-foot-l"] ??= [];
  destructionGroups["boot-foot-l"].push(node_boot_foot_l_59);

  const endpoint_boot_sole_l_60 = makeAttachmentEndpoint(null);
  const node_boot_sole_l_60 = new THREE.Group();
  node_boot_sole_l_60.name = "Wedge sole (l)__pivot";
  node_boot_sole_l_60.scale.set(1, 1, 1);
  if (endpoint_boot_sole_l_60) {
    node_boot_sole_l_60.position.copy(endpoint_boot_sole_l_60.start);
    node_boot_sole_l_60.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_boot_sole_l_60.position.set(0.0, -0.03, 0.002);
    node_boot_sole_l_60.rotation.set(0.0, 0.0, 0.0);
  }
  node_boot_sole_l_60.userData.sculptComponent = {"id": "boot-sole-l", "name": "Wedge sole (l)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A light grey wedge sole under each boot; the only bright element below the knee.", "geometryDescriptor": {"topologyIntent": "a light wedge sole, thicker at the toe", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "boot-foot-l", "dimensions": {"width": 0.115, "height": 0.03, "depth": 0.2, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.03, 0.002], "rotation": [0.0, 0.0, 0.0], "scale": [0.115, 0.03, 0.2]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, -0.03, 0.002], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.115, 0.03, 0.2], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "boot-sole-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole-gray", "materialLayers": ["sole-gray"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 196, 200, 1.0)", "secondaryAlbedo": "rgba(150, 150, 156, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.8, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["wedgeSole"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_boot_sole_l_60.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, -0.03, 0.002], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.115, 0.03, 0.2], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "boot-sole-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["boot-foot-l"] ?? root).add(node_boot_sole_l_60);
  nodes["boot-sole-l"] = node_boot_sole_l_60;
  const mesh_boot_sole_l_60Geometry = endpoint_boot_sole_l_60
    ? new THREE.CylinderGeometry(endpoint_boot_sole_l_60.endRadius, endpoint_boot_sole_l_60.baseRadius, endpoint_boot_sole_l_60.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_boot_sole_l_60) {
    mesh_boot_sole_l_60Geometry.scale(0.115, 0.03, 0.2);
  }
  const mesh_boot_sole_l_60 = new THREE.Mesh(
    mesh_boot_sole_l_60Geometry,
    materialMap["sole-gray"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_boot_sole_l_60.name = "Wedge sole (l)";
  if (endpoint_boot_sole_l_60) {
    mesh_boot_sole_l_60.position.copy(endpoint_boot_sole_l_60.midpoint);
    mesh_boot_sole_l_60.quaternion.copy(endpoint_boot_sole_l_60.quaternion);
  }
  mesh_boot_sole_l_60.castShadow = options.castShadow ?? true;
  mesh_boot_sole_l_60.receiveShadow = options.receiveShadow ?? true;
  mesh_boot_sole_l_60.userData.sculptComponent = {"id": "boot-sole-l", "name": "Wedge sole (l)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A light grey wedge sole under each boot; the only bright element below the knee.", "geometryDescriptor": {"topologyIntent": "a light wedge sole, thicker at the toe", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "boot-foot-l", "dimensions": {"width": 0.115, "height": 0.03, "depth": 0.2, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.03, 0.002], "rotation": [0.0, 0.0, 0.0], "scale": [0.115, 0.03, 0.2]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, -0.03, 0.002], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.115, 0.03, 0.2], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "boot-sole-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole-gray", "materialLayers": ["sole-gray"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 196, 200, 1.0)", "secondaryAlbedo": "rgba(150, 150, 156, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.8, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["wedgeSole"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_boot_sole_l_60.add(mesh_boot_sole_l_60);
  meshes["boot-sole-l"] = mesh_boot_sole_l_60;
  colliders["boot-sole-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.115, 0.03, 0.2], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["boot-sole-l"] ??= [];
  destructionGroups["boot-sole-l"].push(node_boot_sole_l_60);

  const attachment_upper_arm_r_61 = {"parentId": "chest", "parentSocket": "shoulder-r", "localStart": [-0.145, 0.04, 0.0], "localEnd": [-0.24, -0.145, 0.0], "contactType": "socket", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.002, "baseRadius": 0.042, "endRadius": 0.037};
  const endpoint_upper_arm_r_61 = makeAttachmentEndpoint(attachment_upper_arm_r_61);
  const node_upper_arm_r_61 = new THREE.Group();
  node_upper_arm_r_61.name = "Upper arm sleeve (r)__pivot";
  node_upper_arm_r_61.scale.set(1, 1, 1);
  if (endpoint_upper_arm_r_61) {
    node_upper_arm_r_61.position.copy(endpoint_upper_arm_r_61.start);
    node_upper_arm_r_61.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_upper_arm_r_61.position.set(-0.145, 0.04, 0.0);
    node_upper_arm_r_61.rotation.set(0.0, 0.0, 0.0);
  }
  node_upper_arm_r_61.userData.sculptComponent = {"id": "upper-arm-r", "name": "Upper arm sleeve (r)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Arms are abducted 28 degrees off vertical, read from the front silhouette; the sleeve is a black tapered cylinder of 0.082 base diameter.", "geometryDescriptor": {"topologyIntent": "Upper arm sleeve (r) as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "chest", "dimensions": {"width": 0.082, "height": 0.21, "depth": 0.082, "units": "relative", "confidence": 0.9}, "transform": {"position": [-0.145, 0.04, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.082, 0.21, 0.082]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.145, 0.04, 0.0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.082, 0.21, 0.082], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "upper-arm-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["sleeveFold"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "chest", "parentSocket": "shoulder-r", "localStart": [-0.145, 0.04, 0.0], "localEnd": [-0.24, -0.145, 0.0], "contactType": "socket", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.002, "baseRadius": 0.042, "endRadius": 0.037}};
  node_upper_arm_r_61.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.145, 0.04, 0.0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.082, 0.21, 0.082], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "upper-arm-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["chest"] ?? root).add(node_upper_arm_r_61);
  nodes["upper-arm-r"] = node_upper_arm_r_61;
  const mesh_upper_arm_r_61Geometry = endpoint_upper_arm_r_61
    ? new THREE.CylinderGeometry(endpoint_upper_arm_r_61.endRadius, endpoint_upper_arm_r_61.baseRadius, endpoint_upper_arm_r_61.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_upper_arm_r_61) {
    mesh_upper_arm_r_61Geometry.scale(0.082, 0.21, 0.082);
  }
  const mesh_upper_arm_r_61 = new THREE.Mesh(
    mesh_upper_arm_r_61Geometry,
    materialMap["cloth-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_upper_arm_r_61.name = "Upper arm sleeve (r)";
  if (endpoint_upper_arm_r_61) {
    mesh_upper_arm_r_61.position.copy(endpoint_upper_arm_r_61.midpoint);
    mesh_upper_arm_r_61.quaternion.copy(endpoint_upper_arm_r_61.quaternion);
  }
  mesh_upper_arm_r_61.castShadow = options.castShadow ?? true;
  mesh_upper_arm_r_61.receiveShadow = options.receiveShadow ?? true;
  mesh_upper_arm_r_61.userData.sculptComponent = {"id": "upper-arm-r", "name": "Upper arm sleeve (r)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Arms are abducted 28 degrees off vertical, read from the front silhouette; the sleeve is a black tapered cylinder of 0.082 base diameter.", "geometryDescriptor": {"topologyIntent": "Upper arm sleeve (r) as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "chest", "dimensions": {"width": 0.082, "height": 0.21, "depth": 0.082, "units": "relative", "confidence": 0.9}, "transform": {"position": [-0.145, 0.04, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.082, 0.21, 0.082]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.145, 0.04, 0.0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.082, 0.21, 0.082], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "upper-arm-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["sleeveFold"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "chest", "parentSocket": "shoulder-r", "localStart": [-0.145, 0.04, 0.0], "localEnd": [-0.24, -0.145, 0.0], "contactType": "socket", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.002, "baseRadius": 0.042, "endRadius": 0.037}};
  node_upper_arm_r_61.add(mesh_upper_arm_r_61);
  meshes["upper-arm-r"] = mesh_upper_arm_r_61;
  colliders["upper-arm-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.082, 0.21, 0.082], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["upper-arm-r"] ??= [];
  destructionGroups["upper-arm-r"].push(node_upper_arm_r_61);

  const attachment_forearm_r_62 = {"parentId": "upper-arm-r", "parentSocket": "elbow-r", "localStart": [-0.095, -0.185, 0.0], "localEnd": [-0.155, -0.335, 0.0], "contactType": "socket", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.002, "baseRadius": 0.037, "endRadius": 0.031};
  const endpoint_forearm_r_62 = makeAttachmentEndpoint(attachment_forearm_r_62);
  const node_forearm_r_62 = new THREE.Group();
  node_forearm_r_62.name = "Forearm sleeve (r)__pivot";
  node_forearm_r_62.scale.set(1, 1, 1);
  if (endpoint_forearm_r_62) {
    node_forearm_r_62.position.copy(endpoint_forearm_r_62.start);
    node_forearm_r_62.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_forearm_r_62.position.set(-0.095, -0.185, 0.0);
    node_forearm_r_62.rotation.set(0.0, 0.0, 0.0);
  }
  node_forearm_r_62.userData.sculptComponent = {"id": "forearm-r", "name": "Forearm sleeve (r)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Forearm continues the 28 degree line with a slight extra outward break, ending at the wrist at y 0.21.", "geometryDescriptor": {"topologyIntent": "Forearm sleeve (r) as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "upper-arm-r", "dimensions": {"width": 0.072, "height": 0.17, "depth": 0.072, "units": "relative", "confidence": 0.9}, "transform": {"position": [-0.095, -0.185, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.072, 0.17, 0.072]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.095, -0.185, 0.0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.072, 0.17, 0.072], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "forearm-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["cuffLine"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "upper-arm-r", "parentSocket": "elbow-r", "localStart": [-0.095, -0.185, 0.0], "localEnd": [-0.155, -0.335, 0.0], "contactType": "socket", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.002, "baseRadius": 0.037, "endRadius": 0.031}};
  node_forearm_r_62.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.095, -0.185, 0.0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.072, 0.17, 0.072], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "forearm-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["upper-arm-r"] ?? root).add(node_forearm_r_62);
  nodes["forearm-r"] = node_forearm_r_62;
  const mesh_forearm_r_62Geometry = endpoint_forearm_r_62
    ? new THREE.CylinderGeometry(endpoint_forearm_r_62.endRadius, endpoint_forearm_r_62.baseRadius, endpoint_forearm_r_62.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_forearm_r_62) {
    mesh_forearm_r_62Geometry.scale(0.072, 0.17, 0.072);
  }
  const mesh_forearm_r_62 = new THREE.Mesh(
    mesh_forearm_r_62Geometry,
    materialMap["cloth-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_forearm_r_62.name = "Forearm sleeve (r)";
  if (endpoint_forearm_r_62) {
    mesh_forearm_r_62.position.copy(endpoint_forearm_r_62.midpoint);
    mesh_forearm_r_62.quaternion.copy(endpoint_forearm_r_62.quaternion);
  }
  mesh_forearm_r_62.castShadow = options.castShadow ?? true;
  mesh_forearm_r_62.receiveShadow = options.receiveShadow ?? true;
  mesh_forearm_r_62.userData.sculptComponent = {"id": "forearm-r", "name": "Forearm sleeve (r)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Forearm continues the 28 degree line with a slight extra outward break, ending at the wrist at y 0.21.", "geometryDescriptor": {"topologyIntent": "Forearm sleeve (r) as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "upper-arm-r", "dimensions": {"width": 0.072, "height": 0.17, "depth": 0.072, "units": "relative", "confidence": 0.9}, "transform": {"position": [-0.095, -0.185, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.072, 0.17, 0.072]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.095, -0.185, 0.0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.072, 0.17, 0.072], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "forearm-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["cuffLine"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "upper-arm-r", "parentSocket": "elbow-r", "localStart": [-0.095, -0.185, 0.0], "localEnd": [-0.155, -0.335, 0.0], "contactType": "socket", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.002, "baseRadius": 0.037, "endRadius": 0.031}};
  node_forearm_r_62.add(mesh_forearm_r_62);
  meshes["forearm-r"] = mesh_forearm_r_62;
  colliders["forearm-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.072, 0.17, 0.072], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["forearm-r"] ??= [];
  destructionGroups["forearm-r"].push(node_forearm_r_62);

  const endpoint_hand_r_63 = makeAttachmentEndpoint(null);
  const node_hand_r_63 = new THREE.Group();
  node_hand_r_63.name = "Fingerless glove (r)__pivot";
  node_hand_r_63.scale.set(1, 1, 1);
  if (endpoint_hand_r_63) {
    node_hand_r_63.position.copy(endpoint_hand_r_63.start);
    node_hand_r_63.rotation.set(0.0, 0.0, -0.3);
  } else {
    node_hand_r_63.position.set(-0.075, -0.195, 0.012);
    node_hand_r_63.rotation.set(0.0, 0.0, -0.3);
  }
  node_hand_r_63.userData.sculptComponent = {"id": "hand-r", "name": "Fingerless glove (r)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A dark mitt with a cuff solves the hand: finger separation is hidden by the sleeves in all three views, so it is not invented.", "geometryDescriptor": {"topologyIntent": "Fingerless glove (r) as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "forearm-r", "dimensions": {"width": 0.07, "height": 0.105, "depth": 0.058, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.075, -0.195, 0.012], "rotation": [0.0, 0.0, -0.3], "scale": [0.07, 0.105, 0.058]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.075, -0.195, 0.012], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.07, 0.105, 0.058], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hand-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["gloveCuff"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_hand_r_63.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.075, -0.195, 0.012], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.07, 0.105, 0.058], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hand-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["forearm-r"] ?? root).add(node_hand_r_63);
  nodes["hand-r"] = node_hand_r_63;
  const mesh_hand_r_63Geometry = endpoint_hand_r_63
    ? new THREE.CylinderGeometry(endpoint_hand_r_63.endRadius, endpoint_hand_r_63.baseRadius, endpoint_hand_r_63.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_hand_r_63) {
    mesh_hand_r_63Geometry.scale(0.07, 0.105, 0.058);
  }
  const mesh_hand_r_63 = new THREE.Mesh(
    mesh_hand_r_63Geometry,
    materialMap["cloth-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hand_r_63.name = "Fingerless glove (r)";
  if (endpoint_hand_r_63) {
    mesh_hand_r_63.position.copy(endpoint_hand_r_63.midpoint);
    mesh_hand_r_63.quaternion.copy(endpoint_hand_r_63.quaternion);
  }
  mesh_hand_r_63.castShadow = options.castShadow ?? true;
  mesh_hand_r_63.receiveShadow = options.receiveShadow ?? true;
  mesh_hand_r_63.userData.sculptComponent = {"id": "hand-r", "name": "Fingerless glove (r)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A dark mitt with a cuff solves the hand: finger separation is hidden by the sleeves in all three views, so it is not invented.", "geometryDescriptor": {"topologyIntent": "Fingerless glove (r) as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "forearm-r", "dimensions": {"width": 0.07, "height": 0.105, "depth": 0.058, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.075, -0.195, 0.012], "rotation": [0.0, 0.0, -0.3], "scale": [0.07, 0.105, 0.058]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.075, -0.195, 0.012], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.07, 0.105, 0.058], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hand-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["gloveCuff"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_hand_r_63.add(mesh_hand_r_63);
  meshes["hand-r"] = mesh_hand_r_63;
  colliders["hand-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.07, 0.105, 0.058], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["hand-r"] ??= [];
  destructionGroups["hand-r"].push(node_hand_r_63);

  const attachment_thigh_r_64 = {"parentId": "pelvis", "parentSocket": "hip-r", "localStart": [-0.085, 0.0, 0.0], "localEnd": [-0.09, -0.097, 0.0], "contactType": "socket", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.002, "baseRadius": 0.044, "endRadius": 0.041};
  const endpoint_thigh_r_64 = makeAttachmentEndpoint(attachment_thigh_r_64);
  const node_thigh_r_64 = new THREE.Group();
  node_thigh_r_64.name = "Thigh (r)__pivot";
  node_thigh_r_64.scale.set(1, 1, 1);
  if (endpoint_thigh_r_64) {
    node_thigh_r_64.position.copy(endpoint_thigh_r_64.start);
    node_thigh_r_64.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_thigh_r_64.position.set(-0.085, 0.0, 0.0);
    node_thigh_r_64.rotation.set(0.0, 0.0, 0.0);
  }
  node_thigh_r_64.userData.sculptComponent = {"id": "thigh-r", "name": "Thigh (r)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Bare thigh band measured at y 778-844 px; it is short, which is the chibi read, not a measurement error.", "geometryDescriptor": {"topologyIntent": "Thigh (r) as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "pelvis", "dimensions": {"width": 0.086, "height": 0.11, "depth": 0.086, "units": "relative", "confidence": 0.9}, "transform": {"position": [-0.085, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.086, 0.11, 0.086]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.085, 0.0, 0.0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.086, 0.11, 0.086], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "thigh-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 222, 210, 1.0)", "secondaryAlbedo": "rgba(214, 186, 170, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.92, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["thighBand"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "pelvis", "parentSocket": "hip-r", "localStart": [-0.085, 0.0, 0.0], "localEnd": [-0.09, -0.097, 0.0], "contactType": "socket", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.002, "baseRadius": 0.044, "endRadius": 0.041}};
  node_thigh_r_64.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.085, 0.0, 0.0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.086, 0.11, 0.086], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "thigh-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["pelvis"] ?? root).add(node_thigh_r_64);
  nodes["thigh-r"] = node_thigh_r_64;
  const mesh_thigh_r_64Geometry = endpoint_thigh_r_64
    ? new THREE.CylinderGeometry(endpoint_thigh_r_64.endRadius, endpoint_thigh_r_64.baseRadius, endpoint_thigh_r_64.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_thigh_r_64) {
    mesh_thigh_r_64Geometry.scale(0.086, 0.11, 0.086);
  }
  const mesh_thigh_r_64 = new THREE.Mesh(
    mesh_thigh_r_64Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_thigh_r_64.name = "Thigh (r)";
  if (endpoint_thigh_r_64) {
    mesh_thigh_r_64.position.copy(endpoint_thigh_r_64.midpoint);
    mesh_thigh_r_64.quaternion.copy(endpoint_thigh_r_64.quaternion);
  }
  mesh_thigh_r_64.castShadow = options.castShadow ?? true;
  mesh_thigh_r_64.receiveShadow = options.receiveShadow ?? true;
  mesh_thigh_r_64.userData.sculptComponent = {"id": "thigh-r", "name": "Thigh (r)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Bare thigh band measured at y 778-844 px; it is short, which is the chibi read, not a measurement error.", "geometryDescriptor": {"topologyIntent": "Thigh (r) as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "pelvis", "dimensions": {"width": 0.086, "height": 0.11, "depth": 0.086, "units": "relative", "confidence": 0.9}, "transform": {"position": [-0.085, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.086, 0.11, 0.086]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.085, 0.0, 0.0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.086, 0.11, 0.086], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "thigh-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 222, 210, 1.0)", "secondaryAlbedo": "rgba(214, 186, 170, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.92, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["thighBand"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural", "attachment": {"parentId": "pelvis", "parentSocket": "hip-r", "localStart": [-0.085, 0.0, 0.0], "localEnd": [-0.09, -0.097, 0.0], "contactType": "socket", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.002, "baseRadius": 0.044, "endRadius": 0.041}};
  node_thigh_r_64.add(mesh_thigh_r_64);
  meshes["thigh-r"] = mesh_thigh_r_64;
  colliders["thigh-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.086, 0.11, 0.086], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["thigh-r"] ??= [];
  destructionGroups["thigh-r"].push(node_thigh_r_64);

  const endpoint_boot_shaft_r_65 = makeAttachmentEndpoint(null);
  const node_boot_shaft_r_65 = new THREE.Group();
  node_boot_shaft_r_65.name = "Boot shaft (r)__pivot";
  node_boot_shaft_r_65.scale.set(1, 1, 1);
  if (endpoint_boot_shaft_r_65) {
    node_boot_shaft_r_65.position.copy(endpoint_boot_shaft_r_65.start);
    node_boot_shaft_r_65.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_boot_shaft_r_65.position.set(-0.005, -0.185, 0.01);
    node_boot_shaft_r_65.rotation.set(0.0, 0.0, 0.0);
  }
  node_boot_shaft_r_65.userData.sculptComponent = {"id": "boot-shaft-r", "name": "Boot shaft (r)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The boot shaft rises above the knee line (measured boot top at y 0.202 of total height) and carries the chevron trim.", "geometryDescriptor": {"topologyIntent": "Boot shaft (r) as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "thigh-r", "dimensions": {"width": 0.105, "height": 0.19, "depth": 0.115, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.005, -0.185, 0.01], "rotation": [0.0, 0.0, 0.0], "scale": [0.105, 0.19, 0.115]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.005, -0.185, 0.01], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.19, 0.115], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "boot-shaft-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["bootTrim"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_boot_shaft_r_65.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.005, -0.185, 0.01], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.19, 0.115], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "boot-shaft-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["thigh-r"] ?? root).add(node_boot_shaft_r_65);
  nodes["boot-shaft-r"] = node_boot_shaft_r_65;
  const mesh_boot_shaft_r_65Geometry = endpoint_boot_shaft_r_65
    ? new THREE.CylinderGeometry(endpoint_boot_shaft_r_65.endRadius, endpoint_boot_shaft_r_65.baseRadius, endpoint_boot_shaft_r_65.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_boot_shaft_r_65) {
    mesh_boot_shaft_r_65Geometry.scale(0.105, 0.19, 0.115);
  }
  const mesh_boot_shaft_r_65 = new THREE.Mesh(
    mesh_boot_shaft_r_65Geometry,
    materialMap["cloth-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_boot_shaft_r_65.name = "Boot shaft (r)";
  if (endpoint_boot_shaft_r_65) {
    mesh_boot_shaft_r_65.position.copy(endpoint_boot_shaft_r_65.midpoint);
    mesh_boot_shaft_r_65.quaternion.copy(endpoint_boot_shaft_r_65.quaternion);
  }
  mesh_boot_shaft_r_65.castShadow = options.castShadow ?? true;
  mesh_boot_shaft_r_65.receiveShadow = options.receiveShadow ?? true;
  mesh_boot_shaft_r_65.userData.sculptComponent = {"id": "boot-shaft-r", "name": "Boot shaft (r)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The boot shaft rises above the knee line (measured boot top at y 0.202 of total height) and carries the chevron trim.", "geometryDescriptor": {"topologyIntent": "Boot shaft (r) as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "thigh-r", "dimensions": {"width": 0.105, "height": 0.19, "depth": 0.115, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.005, -0.185, 0.01], "rotation": [0.0, 0.0, 0.0], "scale": [0.105, 0.19, 0.115]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [-0.005, -0.185, 0.01], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.19, 0.115], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "boot-shaft-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["bootTrim"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_boot_shaft_r_65.add(mesh_boot_shaft_r_65);
  meshes["boot-shaft-r"] = mesh_boot_shaft_r_65;
  colliders["boot-shaft-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.19, 0.115], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["boot-shaft-r"] ??= [];
  destructionGroups["boot-shaft-r"].push(node_boot_shaft_r_65);

  const endpoint_boot_chevron_r_66 = makeAttachmentEndpoint(null);
  const node_boot_chevron_r_66 = new THREE.Group();
  node_boot_chevron_r_66.name = "Boot chevron trim (r)__pivot";
  node_boot_chevron_r_66.scale.set(1, 1, 1);
  if (endpoint_boot_chevron_r_66) {
    node_boot_chevron_r_66.position.copy(endpoint_boot_chevron_r_66.start);
    node_boot_chevron_r_66.rotation.set(0.0, 0.0, -0.35);
  } else {
    node_boot_chevron_r_66.position.set(0.0, 0.063, 0.058);
    node_boot_chevron_r_66.rotation.set(0.0, 0.0, -0.35);
  }
  node_boot_chevron_r_66.userData.sculptComponent = {"id": "boot-chevron-r", "name": "Boot chevron trim (r)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Two nested white V strokes wrap each boot at ankle height; the reference shows them as hard-edged geometry, not shading.", "geometryDescriptor": {"topologyIntent": "a nested white V stroke on the boot's outer face", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "boot-shaft-r", "dimensions": {"width": 0.095, "height": 0.03, "depth": 0.02, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, 0.063, 0.058], "rotation": [0.0, 0.0, -0.35], "scale": [0.095, 0.03, 0.02]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.063, 0.058], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.095, 0.03, 0.02], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "boot-chevron-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "trim-white", "materialLayers": ["trim-white"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 233, 233, 1.0)", "secondaryAlbedo": "rgba(198, 198, 204, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.86, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["bootChevron"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_boot_chevron_r_66.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.063, 0.058], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.095, 0.03, 0.02], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "boot-chevron-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["boot-shaft-r"] ?? root).add(node_boot_chevron_r_66);
  nodes["boot-chevron-r"] = node_boot_chevron_r_66;
  const mesh_boot_chevron_r_66Geometry = endpoint_boot_chevron_r_66
    ? new THREE.CylinderGeometry(endpoint_boot_chevron_r_66.endRadius, endpoint_boot_chevron_r_66.baseRadius, endpoint_boot_chevron_r_66.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_boot_chevron_r_66) {
    mesh_boot_chevron_r_66Geometry.scale(0.095, 0.03, 0.02);
  }
  const mesh_boot_chevron_r_66 = new THREE.Mesh(
    mesh_boot_chevron_r_66Geometry,
    materialMap["trim-white"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_boot_chevron_r_66.name = "Boot chevron trim (r)";
  if (endpoint_boot_chevron_r_66) {
    mesh_boot_chevron_r_66.position.copy(endpoint_boot_chevron_r_66.midpoint);
    mesh_boot_chevron_r_66.quaternion.copy(endpoint_boot_chevron_r_66.quaternion);
  }
  mesh_boot_chevron_r_66.castShadow = options.castShadow ?? true;
  mesh_boot_chevron_r_66.receiveShadow = options.receiveShadow ?? true;
  mesh_boot_chevron_r_66.userData.sculptComponent = {"id": "boot-chevron-r", "name": "Boot chevron trim (r)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Two nested white V strokes wrap each boot at ankle height; the reference shows them as hard-edged geometry, not shading.", "geometryDescriptor": {"topologyIntent": "a nested white V stroke on the boot's outer face", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "boot-shaft-r", "dimensions": {"width": 0.095, "height": 0.03, "depth": 0.02, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, 0.063, 0.058], "rotation": [0.0, 0.0, -0.35], "scale": [0.095, 0.03, 0.02]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, 0.063, 0.058], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.095, 0.03, 0.02], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "boot-chevron-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "trim-white", "materialLayers": ["trim-white"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 233, 233, 1.0)", "secondaryAlbedo": "rgba(198, 198, 204, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.86, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["bootChevron"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_boot_chevron_r_66.add(mesh_boot_chevron_r_66);
  meshes["boot-chevron-r"] = mesh_boot_chevron_r_66;
  colliders["boot-chevron-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.095, 0.03, 0.02], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["boot-chevron-r"] ??= [];
  destructionGroups["boot-chevron-r"].push(node_boot_chevron_r_66);

  const endpoint_boot_foot_r_67 = makeAttachmentEndpoint(null);
  const node_boot_foot_r_67 = new THREE.Group();
  node_boot_foot_r_67.name = "Boot foot (r)__pivot";
  node_boot_foot_r_67.scale.set(1, 1, 1);
  if (endpoint_boot_foot_r_67) {
    node_boot_foot_r_67.position.copy(endpoint_boot_foot_r_67.start);
    node_boot_foot_r_67.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_boot_foot_r_67.position.set(0.0, -0.07, 0.028);
    node_boot_foot_r_67.rotation.set(0.0, 0.0, 0.0);
  }
  node_boot_foot_r_67.userData.sculptComponent = {"id": "boot-foot-r", "name": "Boot foot (r)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The boot's foot section extends forward of the shaft; the side view shows it as the only part reaching past the body's depth.", "geometryDescriptor": {"topologyIntent": "Boot foot (r) as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "boot-shaft-r", "dimensions": {"width": 0.105, "height": 0.06, "depth": 0.185, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, -0.07, 0.028], "rotation": [0.0, 0.0, 0.0], "scale": [0.105, 0.06, 0.185]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, -0.07, 0.028], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.06, 0.185], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "boot-foot-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["toeCap"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_boot_foot_r_67.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, -0.07, 0.028], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.06, 0.185], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "boot-foot-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["boot-shaft-r"] ?? root).add(node_boot_foot_r_67);
  nodes["boot-foot-r"] = node_boot_foot_r_67;
  const mesh_boot_foot_r_67Geometry = endpoint_boot_foot_r_67
    ? new THREE.CylinderGeometry(endpoint_boot_foot_r_67.endRadius, endpoint_boot_foot_r_67.baseRadius, endpoint_boot_foot_r_67.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_boot_foot_r_67) {
    mesh_boot_foot_r_67Geometry.scale(0.105, 0.06, 0.185);
  }
  const mesh_boot_foot_r_67 = new THREE.Mesh(
    mesh_boot_foot_r_67Geometry,
    materialMap["cloth-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_boot_foot_r_67.name = "Boot foot (r)";
  if (endpoint_boot_foot_r_67) {
    mesh_boot_foot_r_67.position.copy(endpoint_boot_foot_r_67.midpoint);
    mesh_boot_foot_r_67.quaternion.copy(endpoint_boot_foot_r_67.quaternion);
  }
  mesh_boot_foot_r_67.castShadow = options.castShadow ?? true;
  mesh_boot_foot_r_67.receiveShadow = options.receiveShadow ?? true;
  mesh_boot_foot_r_67.userData.sculptComponent = {"id": "boot-foot-r", "name": "Boot foot (r)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The boot's foot section extends forward of the shaft; the side view shows it as the only part reaching past the body's depth.", "geometryDescriptor": {"topologyIntent": "Boot foot (r) as a clean stylised primitive", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "boot-shaft-r", "dimensions": {"width": 0.105, "height": 0.06, "depth": 0.185, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.0, -0.07, 0.028], "rotation": [0.0, 0.0, 0.0], "scale": [0.105, 0.06, 0.185]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, -0.07, 0.028], "axis": [0, 1, 0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.06, 0.185], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "boot-foot-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cloth-black", "materialLayers": ["cloth-black"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(19, 19, 19, 1.0)", "secondaryAlbedo": "rgba(38, 38, 40, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["toeCap"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_boot_foot_r_67.add(mesh_boot_foot_r_67);
  meshes["boot-foot-r"] = mesh_boot_foot_r_67;
  colliders["boot-foot-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.06, 0.185], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["boot-foot-r"] ??= [];
  destructionGroups["boot-foot-r"].push(node_boot_foot_r_67);

  const endpoint_boot_sole_r_68 = makeAttachmentEndpoint(null);
  const node_boot_sole_r_68 = new THREE.Group();
  node_boot_sole_r_68.name = "Wedge sole (r)__pivot";
  node_boot_sole_r_68.scale.set(1, 1, 1);
  if (endpoint_boot_sole_r_68) {
    node_boot_sole_r_68.position.copy(endpoint_boot_sole_r_68.start);
    node_boot_sole_r_68.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_boot_sole_r_68.position.set(0.0, -0.03, 0.002);
    node_boot_sole_r_68.rotation.set(0.0, 0.0, 0.0);
  }
  node_boot_sole_r_68.userData.sculptComponent = {"id": "boot-sole-r", "name": "Wedge sole (r)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A light grey wedge sole under each boot; the only bright element below the knee.", "geometryDescriptor": {"topologyIntent": "a light wedge sole, thicker at the toe", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "boot-foot-r", "dimensions": {"width": 0.115, "height": 0.03, "depth": 0.2, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.03, 0.002], "rotation": [0.0, 0.0, 0.0], "scale": [0.115, 0.03, 0.2]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, -0.03, 0.002], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.115, 0.03, 0.2], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "boot-sole-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole-gray", "materialLayers": ["sole-gray"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 196, 200, 1.0)", "secondaryAlbedo": "rgba(150, 150, 156, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.8, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["wedgeSole"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_boot_sole_r_68.userData.actionProfile = {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, -0.03, 0.002], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.115, 0.03, 0.2], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "boot-sole-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["boot-foot-r"] ?? root).add(node_boot_sole_r_68);
  nodes["boot-sole-r"] = node_boot_sole_r_68;
  const mesh_boot_sole_r_68Geometry = endpoint_boot_sole_r_68
    ? new THREE.CylinderGeometry(endpoint_boot_sole_r_68.endRadius, endpoint_boot_sole_r_68.baseRadius, endpoint_boot_sole_r_68.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_boot_sole_r_68) {
    mesh_boot_sole_r_68Geometry.scale(0.115, 0.03, 0.2);
  }
  const mesh_boot_sole_r_68 = new THREE.Mesh(
    mesh_boot_sole_r_68Geometry,
    materialMap["sole-gray"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_boot_sole_r_68.name = "Wedge sole (r)";
  if (endpoint_boot_sole_r_68) {
    mesh_boot_sole_r_68.position.copy(endpoint_boot_sole_r_68.midpoint);
    mesh_boot_sole_r_68.quaternion.copy(endpoint_boot_sole_r_68.quaternion);
  }
  mesh_boot_sole_r_68.castShadow = options.castShadow ?? true;
  mesh_boot_sole_r_68.receiveShadow = options.receiveShadow ?? true;
  mesh_boot_sole_r_68.userData.sculptComponent = {"id": "boot-sole-r", "name": "Wedge sole (r)", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A light grey wedge sole under each boot; the only bright element below the knee.", "geometryDescriptor": {"topologyIntent": "a light wedge sole, thicker at the toe", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat facet normals"}, "parent": "boot-foot-r", "dimensions": {"width": 0.115, "height": 0.03, "depth": 0.2, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.03, 0.002], "rotation": [0.0, 0.0, 0.0], "scale": [0.115, 0.03, 0.2]}, "actionProfile": {"animationRole": "prop", "pivot": {"mode": "root", "localPosition": [0.0, -0.03, 0.002], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.115, 0.03, 0.2], "isTrigger": false, "notes": "box proxy at the component's own scale"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "boot-sole-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole-gray", "materialLayers": ["sole-gray"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 196, 200, 1.0)", "secondaryAlbedo": "rgba(150, 150, 156, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.8, "evidenceRef": "analysis/image-analysis.md#layer-5"}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["wedgeSole"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise."}, "evidenceRefs": ["front", "side", "back"], "details": [], "fidelityTier": "structural"};
  node_boot_sole_r_68.add(mesh_boot_sole_r_68);
  meshes["boot-sole-r"] = mesh_boot_sole_r_68;
  colliders["boot-sole-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.115, 0.03, 0.2], "isTrigger": false, "notes": "box proxy at the component's own scale"};
  destructionGroups["boot-sole-r"] ??= [];
  destructionGroups["boot-sole-r"].push(node_boot_sole_r_68);
  // repetition system "tail-slab-chain" describes 8 parts that are already built individually; not instanced.
  // repetition system "coat-trim-chain" describes 2 parts that are already built individually; not instanced.
  // repetition system "hair-facet-slabs" describes 6 parts that are already built individually; not instanced.
  // repetition system "boot-chevron-pair" describes 2 parts that are already built individually; not instanced.
  // repetition system "sleeve-band-pair" describes 2 parts that are already built individually; not instanced.

  // standProud: hold these components outside the surfaces they cover.
  if (meshes["hair-shell"] && nodes["head"]) {
    applyStandProud(
      meshes["hair-shell"].geometry,
      meshes["hair-shell"],
      nodes["head"],
      {"rings": [[-0.17, 3.7e-05, 3.4000000000000007e-05, 0.0], [-0.14166678000000002, 0.10226244999999999, 0.09397090000000001, 0.0], [-0.11333322, 0.13789086, 0.12671052000000002, 0.0], [-0.085, 0.16021480999999999, 0.14722442, 0.0], [-0.05666678000000001, 0.17441985000000002, 0.16027770000000002, 0.0], [-0.028333220000000003, 0.18241258999999999, 0.16762238000000002, 0.0], [0.0, 0.185, 0.17, 0.0], [0.028333220000000003, 0.18241258999999999, 0.16762238000000002, 0.0], [0.05666678000000001, 0.17441985000000002, 0.16027770000000002, 0.0], [0.085, 0.16021480999999999, 0.14722442, 0.0], [0.11333322, 0.13789086, 0.12671052000000002, 0.0], [0.14166678000000002, 0.10226244999999999, 0.09397090000000001, 0.0], [0.17, 3.7e-05, 3.4000000000000007e-05, 0.0]]},
      0.006,
      0.06,
    );
  }
  if (meshes["tail-l"] && nodes["head"]) {
    applyStandProud(
      meshes["tail-l"].geometry,
      meshes["tail-l"],
      nodes["head"],
      {"rings": [[-0.17, 3.7e-05, 3.4000000000000007e-05, 0.0], [-0.14166678000000002, 0.10226244999999999, 0.09397090000000001, 0.0], [-0.11333322, 0.13789086, 0.12671052000000002, 0.0], [-0.085, 0.16021480999999999, 0.14722442, 0.0], [-0.05666678000000001, 0.17441985000000002, 0.16027770000000002, 0.0], [-0.028333220000000003, 0.18241258999999999, 0.16762238000000002, 0.0], [0.0, 0.185, 0.17, 0.0], [0.028333220000000003, 0.18241258999999999, 0.16762238000000002, 0.0], [0.05666678000000001, 0.17441985000000002, 0.16027770000000002, 0.0], [0.085, 0.16021480999999999, 0.14722442, 0.0], [0.11333322, 0.13789086, 0.12671052000000002, 0.0], [0.14166678000000002, 0.10226244999999999, 0.09397090000000001, 0.0], [0.17, 3.7e-05, 3.4000000000000007e-05, 0.0]]},
      0.004,
      0.05,
    );
  }
  if (meshes["tail-r"] && nodes["head"]) {
    applyStandProud(
      meshes["tail-r"].geometry,
      meshes["tail-r"],
      nodes["head"],
      {"rings": [[-0.17, 3.7e-05, 3.4000000000000007e-05, 0.0], [-0.14166678000000002, 0.10226244999999999, 0.09397090000000001, 0.0], [-0.11333322, 0.13789086, 0.12671052000000002, 0.0], [-0.085, 0.16021480999999999, 0.14722442, 0.0], [-0.05666678000000001, 0.17441985000000002, 0.16027770000000002, 0.0], [-0.028333220000000003, 0.18241258999999999, 0.16762238000000002, 0.0], [0.0, 0.185, 0.17, 0.0], [0.028333220000000003, 0.18241258999999999, 0.16762238000000002, 0.0], [0.05666678000000001, 0.17441985000000002, 0.16027770000000002, 0.0], [0.085, 0.16021480999999999, 0.14722442, 0.0], [0.11333322, 0.13789086, 0.12671052000000002, 0.0], [0.14166678000000002, 0.10226244999999999, 0.09397090000000001, 0.0], [0.17, 3.7e-05, 3.4000000000000007e-05, 0.0]]},
      0.004,
      0.05,
    );
  }

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "balanced", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."], "qualityPriorityRationale": "Flat-paint stylized subject. Surface identity is carried by bounded colour regions and by silhouette, not by grain, print or pores, so the texture-channel bar does not describe this model. Materials are declared textureless with per-material evidence."};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createChibiTwinTailCharacterLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Chibi Twin-Tail Character look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = [{"id": "key", "role": "key light", "direction": "front-upper-left", "intensity": 2.1, "color": "#FFFFFF", "notes": "Reconstructs the reference's single dominant top-left key that shades the hair facets."}, {"id": "fill", "role": "fill light", "direction": "front-upper-right", "intensity": 0.55, "color": "#9FB6C8", "notes": "Cool low fill so the black garment keeps a readable value instead of crushing to one tone."}, {"id": "rim", "role": "rim light", "direction": "rear-upper", "intensity": 0.85, "color": "#DCE8F2", "notes": "Separates the black silhouette from the background, matching the reference's light edge under the jaw."}, {"id": "ambient", "role": "environment light", "intensity": 0.35, "notes": "Hemisphere ambient so the shadow side is not black; no HDRI, the reference is a flat studio read."}, {"id": "tone", "role": "exposure and tone mapping", "exposure": 1.0, "toneMapping": "ACESFilmic", "notes": "Exposure 1.0 with ACES filmic tone mapping keeps the white trim from clipping while holding the black panels apart."}, {"id": "contact", "role": "contact shadow", "notes": "A soft ground contact shadow under each boot ties the figure to the ground plane, as the reference sheet's ellipse does."}];
  lights.userData.lookDevTargets = {"qualityPriority": "balanced", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."], "qualityPriorityRationale": "Flat-paint stylized subject. Surface identity is carried by bounded colour regions and by silhouette, not by grain, print or pores, so the texture-channel bar does not describe this model. Materials are declared textureless with per-material evidence."};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createChibiTwinTailCharacterEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameChibiTwinTailCharacterCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createChibiTwinTailCharacterPresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureChibiTwinTailCharacterRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createChibiTwinTailCharacterInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
