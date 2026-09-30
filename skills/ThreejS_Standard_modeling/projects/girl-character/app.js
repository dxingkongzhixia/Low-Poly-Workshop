import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { M, blockStack, block, shapeExtrude, ribbon, panel, starPoints, circlePoints }
  from '../../kit/standard-modeling-kit.js?v=4';

// ---------------------------------------------------------------------------
// STANDARD MODEL LANDMARKS  (measured from reference/iE.json, world space)
// Regenerate: node tools/measure-standard.js reference/iE.json
//
//   head       y 1.065 .. 1.814, half-width 0.514, front z ~0.345
//   eyes       y 1.342 .. 1.433, z 0.342
//   torso      y 0.656 .. 1.250, half-width 0.247
//   shoulder   y 1.107, arms at x = +-0.292
//   legs       x = +-0.161, knee y 0.368
//
// Q-blocky style, ~2.4-head chibi facing +Z.
// ---------------------------------------------------------------------------
const L = { headBottom: 1.065, headTop: 1.814, headHalf: 0.514, headFront: 0.345, shoulderY: 1.107, armX: 0.292, legX: 0.161 };
const CLOTH_TOP = 1.060;      // nothing may rise above the jaw or it clips the head
const ARM_SWING = 0.40;
const KEEP = new Set(['基础头型', '基础身体', '基础手臂（含手）', '基础腿部']);
const OPEN = { capStart: false, capEnd: false };

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111720);
const host = document.querySelector('main');
const camera = new THREE.PerspectiveCamera(34, 1, .01, 80);
camera.position.set(1.85, 1.50, 4.70);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
host.append(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.target.set(0, 1.00, 0);
controls.minDistance = 1.8; controls.maxDistance = 12;

scene.add(new THREE.HemisphereLight(0xd6e8f4, 0x1a2230, 2.1));
const key = new THREE.DirectionalLight(0xfff3e8, 2.6);
key.position.set(3.2, 5.0, 3.6); key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.near = .5; key.shadow.camera.far = 18;
key.shadow.camera.left = -2.4; key.shadow.camera.right = 2.4;
key.shadow.camera.top = 3.2; key.shadow.camera.bottom = -.4;
scene.add(key);
const rim = new THREE.DirectionalLight(0x8ab8ff, 1.5); rim.position.set(-3.6, 2.6, -4.0); scene.add(rim);

const floor = new THREE.Mesh(new THREE.CircleGeometry(5, 64), new THREE.MeshStandardMaterial({ color: 0x1e2836, roughness: 1 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const pad = new THREE.Mesh(new THREE.CircleGeometry(1.8, 48), new THREE.MeshStandardMaterial({ color: 0x243040, roughness: 1 }));
pad.rotation.x = -Math.PI / 2; pad.position.y = .002; pad.receiveShadow = true; scene.add(pad);

// ---------------------------------------------------------------------------
const root = new THREE.Group(); scene.add(root);
const buckets = new Map();
const standardParts = [];
let standard = null, buildToken = 0, armGroups = {};
let templateInfo = null, spinning = false, wire = false;

function register(mesh, category) {
  mesh.userData.category = category;
  if (!buckets.has(category)) buckets.set(category, []);
  buckets.get(category).push(mesh);
  return mesh;
}
function A(parent, mesh, category) { parent.add(mesh); return register(mesh, category); }
function grp(name, parent) { const g = new THREE.Group(); g.name = name; parent.add(g); return g; }
function piv(name, parent, pos) { const g = new THREE.Group(); g.name = name; g.position.set(...pos); parent.add(g); return g; }
/** mirrored pair helper: fn(sign, tag) */
function both(fn) { for (const s of [-1, 1]) fn(s, s < 0 ? 'R' : 'L'); }

// ---------------------------------------------------------------------------
// load the standard skeleton, strip its look
// ---------------------------------------------------------------------------
/**
 * The template stores the face as a 96x80 RGBA texture on the head's material
 * array. Keep it (so the eyes/mouth are the template's), but repaint the iris.
 * The iris is a desaturated teal: green and blue are both clearly above red.
 */
function recolourFace(headMesh) {
  const mats = [].concat(headMesh.material);
  let recoloured = 0, found = null;
  for (const m of mats) {
    const img = m && m.map && m.map.image;
    const data = img && img.data;
    if (!data || data.length < 4) continue;
    found = `${img.width}x${img.height}`;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (g > r + 18 && b > r + 18) {
        const lum = (r + g + b) / 3;            // keep the shading
        data[i] = Math.round(28 + lum * 0.16);
        data[i + 1] = Math.round(88 + lum * 0.40);
        data[i + 2] = Math.min(255, Math.round(170 + lum * 0.45));
        recoloured++;
      }
    }
    m.map.needsUpdate = true;
  }
  return { faceMap: found, irisPixels: recoloured };
}

async function loadStandard() {
  const data = await fetch('../../reference/iE.json').then(r => r.json());
  const obj = new THREE.ObjectLoader().parse(data);
  const meshes = [];
  obj.traverse(o => { if (o.isMesh) meshes.push(o); });   // collect first, mutate later
  let kept = 0, hidden = 0, face = null;
  for (const o of meshes) {
    const cat = (o.userData && o.userData.studyCategory) || '';
    const keep = KEEP.has(cat);
    o.visible = keep;
    if (keep) {
      kept++;
      o.castShadow = o.receiveShadow = true;
      const n = o.name;
      if (n === 'rounded-cheeks-and-chin') face = recolourFace(o);   // keep template face, blue iris
      else o.material = M.skin;                                      // skeleton only, strip look
      standardParts.push({
        mesh: o,
        category: n === 'rounded-cheeks-and-chin' ? 'head'
          : /arm|hand/i.test(n) ? 'arms'
            : /thigh|shin|knee/i.test(n) ? 'legs' : 'body'
      });
    } else hidden++;
  }
  obj.traverse(o => {
    if (o.name === 'reference-elbow-0') armGroups.R = o.parent;
    if (o.name === 'reference-elbow-1') armGroups.L = o.parent;
  });
  if (armGroups.R) armGroups.R.rotation.z -= ARM_SWING;
  if (armGroups.L) armGroups.L.rotation.z += ARM_SWING;
  const box = new THREE.Box3().setFromObject(obj);
  templateInfo = {
    kept, hidden, height: box.max.y - box.min.y,
    arms: !!(armGroups.L && armGroups.R),
    faceMap: face && face.faceMap, irisPixels: face ? face.irisPixels : 0
  };
  return obj;
}

// ---------------------------------------------------------------------------
// blocky Q-style details
// ---------------------------------------------------------------------------
function buildDetails(variant = 'classic') {
  const g = grp('details', root);
  const coat = variant === 'alternate' ? M.blackSoft : M.black;

  // face now comes from the template's own texture (iris repainted blue),
  // so no custom eye/mouth geometry is added here.

  // ===== hair =============================================================
  const hair = grp('hair', g);
  // wide flat cap + stepped crown (the reference's layered block)
  // the head is WIDEST (|x| 0.514) around y 1.66-1.78, so the cap must be
  // wider than that there or the skull shows through
  // front edge hugs the face (cz shifted back) while the back keeps volume,
  // so the cap does not read as a flat hat brim
  A(hair, blockStack('hair-cap', [
    [1.500, .515, .400, 0, -.045], [1.600, .550, .415, 0, -.050],
    [1.700, .562, .420, 0, -.055], [1.780, .545, .405, 0, -.050]
  ], M.hair, 'hair'), 'hair');
  A(hair, blockStack('hair-cap2', [
    [1.780, .480, .375, 0, -.045], [1.850, .410, .325, 0, -.040]
  ], M.hair, 'hair'), 'hair');
  A(hair, blockStack('hair-crown', [
    [1.850, .300, .245, 0, -.030], [1.910, .245, .205, 0, -.030]
  ], M.hair, 'hair'), 'hair');
  A(hair, blockStack('hair-back', [
    [1.060, .420, .130, 0, -.330], [1.340, .455, .155, 0, -.345],
    [1.600, .465, .160, 0, -.350], [1.800, .400, .140, 0, -.330]
  ], M.hair, 'hair'), 'hair');
  both((s, tag) => {
    // side mass hugging the head
    A(hair, blockStack('hair-side-' + tag, [
      [1.060, .080, .125, s * .455, -.020], [1.250, .090, .145, s * .470, -.020], [1.440, .095, .150, s * .480, -.020]
    ], M.hair, 'hair'), 'hair');
    // angular temple wing, pointing out and down
    const wing = shapeExtrude('hair-wing-' + tag,
      [[-.10, .16], [.10, .16], [.13, -.02], [.04, -.20], [-.03, -.06], [-.12, -.02]], .16, M.hair, 'hair');
    wing.position.set(s * .500, 1.300, -.020);
    wing.rotation.y = -s * Math.PI / 2;
    A(hair, wing, 'hair');
    // centre-parted fringe hanging just above the eyes
    const fr = shapeExtrude('fringe-' + tag,
      [[-.060, .09], [.060, .09], [.055, -.05], [.022, -.155], [-.022, -.075], [-.055, -.015]], .075, M.hair, 'hair');
    fr.position.set(s * .140, 1.545, .362);
    fr.rotation.z = s * -.16;
    A(hair, fr, 'hair');
    // long side lock down to the jaw
    A(hair, blockStack('side-lock-' + tag, [
      [1.470, .070, .085, s * .420, .060], [1.320, .075, .090, s * .455, .075],
      [1.170, .060, .075, s * .445, .065], [1.055, .030, .040, s * .410, .050]
    ], M.hair, 'hair'), 'hair');
  });

  // twin tails: long, thin, spiky
  both((s, tag) => {
    const p = piv('ponytail-root-' + tag, hair, [s * .520, 1.560, -.100]);
    A(p, block('tail-band-' + tag, .175, .185, .175, M.black, 'hair', 0, 0, 0), 'hair');
    A(p, blockStack('ponytail-' + tag, [
      [-.060, .105, .100],
      [-.300, .115, .100, s * .085, -.030],
      [-.620, .095, .085, s * .150, -.060],
      [-.960, .070, .065, s * .185, -.085],
      [-1.300, .045, .042, s * .170, -.100],
      [-1.560, .010, .010, s * .110, -.095]
    ], M.hair, 'hair'), 'hair');
    // spiky fins along the outer edge
    for (let i = 0; i < 4; i++) {
      const y = -.34 - i * .34;
      const fin = shapeExtrude('tail-fin-' + tag + '-' + i,
        [[-.10, .06], [.10, .06], [.03, -.10], [0, -.16], [-.03, -.10]], .10, M.hair, 'hair');
      fin.position.set(s * (.09 + i * .035), y, -.02);
      fin.rotation.y = -s * .45;
      A(p, fin, 'hair');
    }
    p.rotation.z = s * .30; p.rotation.x = .07;
  });

  // ===== hood + coat ======================================================
  const clothing = grp('clothing', g);
  // hood: a solid blocky cowl wrapping behind the head
  A(clothing, blockStack('hood', [
    [.980, .330, .215, 0, -.105], [1.100, .400, .265, 0, -.155],
    [1.240, .380, .255, 0, -.150], [1.330, .300, .200, 0, -.120]
  ], coat, 'clothing'), 'clothing');
  // coat back
  const back = panel('coat-back', [
    [-.335, CLOTH_TOP], [.335, CLOTH_TOP], [.375, .930], [.395, .780],
    [.345, .620], [0, .570], [-.345, .620], [-.395, .780], [-.375, .930]
  ], .075, coat, 'clothing');
  back.position.z = -.205; A(clothing, back, 'clothing');
  // coat front panels, open at the centre
  const frontPts = [[.100, CLOTH_TOP], [.320, 1.010], [.365, .840], [.320, .660], [.180, .580], [.090, .680]];
  const edgePts = [[.082, CLOTH_TOP], [.128, CLOTH_TOP], [.118, .680], [.070, .690]];
  both((s, tag) => {
    const fp = panel('coat-front-' + tag, frontPts.map(([x, y]) => [s * x, y]), .070, coat, 'clothing');
    fp.position.z = .195; A(clothing, fp, 'clothing');
    const trim = panel('piping-' + tag, edgePts.map(([x, y]) => [s * x, y]), .084, M.white, 'clothing');
    trim.position.z = .195; A(clothing, trim, 'clothing');
    A(clothing, block('coat-shoulder-' + tag, .150, .110, .190, coat, 'clothing', s * .290, 1.000, .020), 'clothing');
  });
  // hem: three angular panels per side + a back panel, each with a white edge
  // hem: angular black panels with a thin white strip along the lower edge
  const hemPts = [[.060, .020], [.360, .040], [.395, -.220], [.300, -.330], [.150, -.290], [.070, -.170]];
  both((s, tag) => {
    const hem = panel('coat-hem-' + tag, hemPts.map(([x, y]) => [s * x, y + .800]), .070,
      variant === 'alternate' ? M.white : coat, 'clothing');
    hem.position.z = .120; A(clothing, hem, 'clothing');
    A(clothing, block('coat-hem-trim-' + tag, .250, .034, .078, M.white, 'clothing',
      s * .225, .482, .120), 'clothing');
    const side = panel('coat-hem-side-' + tag, [
      [.230, .800], [.430, .760], [.470, .560], [.400, .440], [.280, .480], [.230, .620]
    ].map(([x, y]) => [s * x, y]), .070, coat, 'clothing');
    side.position.z = .020; A(clothing, side, 'clothing');
    A(clothing, block('coat-hem-side-trim-' + tag, .150, .034, .070, M.white, 'clothing',
      s * .340, .462, .020), 'clothing');
  });
  const hemBack = panel('coat-hem-back', [
    [-.360, .800], [.360, .800], [.400, .560], [.330, .430], [0, .400], [-.330, .430], [-.400, .560]
  ], .070, coat, 'clothing');
  hemBack.position.z = -.150; A(clothing, hemBack, 'clothing');

  // ===== inner wear =======================================================
  A(clothing, blockStack('inner-top', [[.960, .250, .195], [CLOTH_TOP, .242, .188]], M.black, 'clothing', OPEN), 'clothing');
  A(clothing, blockStack('inner-trim', [[.925, .255, .198], [.962, .250, .195]], M.white, 'clothing', OPEN), 'clothing');
  both((s, tag) => {                                  // thin bikini straps
    const strap = block('inner-strap-' + tag, .028, .150, .026, M.white, 'clothing', s * .110, 1.015, .196);
    strap.rotation.z = s * .22; A(clothing, strap, 'clothing');
  });
  A(clothing, block('hips', .420, .090, .360, M.black, 'clothing', 0, .560, .010), 'clothing');
  A(clothing, blockStack('shorts', [[.530, .255, .190], [.640, .280, .205], [.730, .268, .198]], M.black, 'clothing', OPEN), 'clothing');
  A(clothing, blockStack('belt-black', [[.735, .285, .205], [.865, .290, .210]], M.black, 'clothing', OPEN), 'clothing');
  A(clothing, blockStack('belt-white', [[.865, .290, .210], [.910, .280, .200]], M.white, 'clothing', OPEN), 'clothing');
  const buckle = shapeExtrude('belt-buckle', starPoints(.080, .045), .050, M.metal, 'accessory');
  buckle.position.set(0, .795, .215); A(g, buckle, 'accessories');

  // ===== arms =============================================================
  both((s, tag) => {
    const rig = piv('arm-pivot-' + tag, g, [s * L.armX, L.shoulderY, 0]);
    rig.rotation.z = s * ARM_SWING;
    // coat sleeve (upper arm + elbow)
    A(rig, blockStack('coat-sleeve-' + tag, [
      [.050, .120, .120], [-.180, .108, .108], [-.330, .100, .100]
    ], coat, 'clothing', OPEN), 'clothing');
    // long glove from the elbow to the fingers
    A(rig, blockStack('glove-' + tag, [
      [-.320, .104, .100, 0, .034], [-.560, .096, .092, 0, .034]
    ], M.black, 'clothing', OPEN), 'clothing');
    A(rig, blockStack('cuff-trim-' + tag, [
      [-.278, .114, .110, 0, .034], [-.318, .110, .106, 0, .034]
    ], M.white, 'clothing', OPEN), 'clothing');
    A(rig, block('sleeve-stripe-' + tag, .030, .420, .034, M.white, 'clothing', s * .110, -.190, .080), 'clothing');
    A(rig, block('glove-knuckle-' + tag, .140, .070, .075, M.white, 'clothing', 0, -.470, .105), 'clothing');
    const mount = piv('hand-weapon-mount-' + tag, rig, [0, -.500, .090]);
    mount.userData.weaponMount = true;
  });

  // ===== boots ============================================================
  // Reference: tall shaft with a flared cuff; TWO short white straps sit ON
  // the boot front just under the cuff; below them a winged flap on EACH side
  // of the boot (black with a white leading edge). Bare leg stays visible above.
  both((s, tag) => {
    const cx = s * L.legX;
    A(g, blockStack('boot-' + tag, [
      [.020, .132, .198, cx, .050],   // foot
      [.110, .124, .152, cx, .060],   // toe cap
      [.126, .114, .120, cx, .014],   // ankle
      [.210, .118, .124, cx, 0],      // shaft
      [.265, .128, .134, cx, 0],      // cuff flare
      [.305, .132, .138, cx, 0]       // cuff top
    ], M.black, 'shoes', { capStart: false }), 'shoes');
    // slim pale sole line
    A(g, block('boot-sole-' + tag, .268, .020, .412, M.white, 'shoes', cx, .010, .054), 'shoes');
    // pale toe-cap seam
    A(g, block('boot-seam-' + tag, .246, .020, .302, M.white, 'shoes', cx, .118, .062), 'shoes');
    // two short white straps on the boot front, directly under the cuff
    for (const o of [-1, 1]) {
      A(g, block('boot-strap-' + tag + '-' + (o < 0 ? 'R' : 'L'), .026, .076, .030, M.white, 'shoes',
        cx + o * .040, .266, .134), 'shoes');
    }
    // winged flaps: one on the outer slope, one on the inner slope
    const pts = [[0, .050], [.098, .028], [.118, -.044], [.050, -.124], [0, -.052]];
    for (const o of [-1, 1]) {
      const side = o < 0 ? 'R' : 'L';
      const edge = shapeExtrude('boot-wing-edge-' + tag + side, pts, .046, M.white, 'shoes');
      edge.position.set(cx + o * .090, .268, .046); edge.rotation.z = -o * .12;
      A(g, edge, 'shoes');
      const wing = shapeExtrude('boot-wing-' + tag + side,
        pts.map(([x, y]) => [x * .84, y * .84]), .054, M.black, 'shoes');
      wing.position.set(cx + o * .090, .270, .046); wing.rotation.z = -o * .12;
      A(g, wing, 'shoes');
    }
  });

  // ===== accessories ======================================================
  A(g, blockStack('choker', [[.945, .272, .202], [1.040, .264, .196]], M.black, 'accessory', OPEN), 'accessories');
  A(g, block('choker-ring', .125, .045, .055, M.metal, 'accessory', 0, .982, .206), 'accessories');
  const star = shapeExtrude('back-star', starPoints(.135, .062, 0, .135), .040, M.white, 'accessory');
  star.position.set(0, .860, -.255); A(g, star, 'accessories');
  // small clasps + hair clips, matching the reference's hard white accents
  both((s, tag) => {
    A(g, block('belt-clasp-' + tag, .050, .060, .045, M.white, 'accessory', s * .215, .800, .215), 'accessories');
    A(g, block('hair-clip-' + tag, .110, .040, .050, M.white, 'hair', s * .360, 1.620, .330), 'hair');
  });

  return g;
}

// ---------------------------------------------------------------------------
let standardReady = false;
async function build(variant) {
  const token = ++buildToken;
  if (!standard) standard = await loadStandard();
  if (token !== buildToken) return;
  while (root.children.length) root.remove(root.children[0]);
  buckets.clear();
  root.add(standard);
  for (const p of standardParts) register(p.mesh, p.category);
  buildDetails(variant);
  buildUI();
  standardReady = true;
}
function buildUI() {
  const f = document.querySelector('#filters'); f.innerHTML = '';
  for (const [cat, items] of buckets) {
    const l = document.createElement('label'); l.className = 'check';
    const i = document.createElement('input'); i.type = 'checkbox'; i.checked = true;
    i.onchange = () => items.forEach(o => o.visible = i.checked);
    l.append(i, cat + ' (' + items.length + ')'); f.append(l);
  }
  updateStats();
}
function updateStats() {
  let meshes = 0, tris = 0; const mats = new Set();
  root.traverse(o => {
    if (!o.isMesh || o.visible === false) return;
    meshes++;
    tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    for (const m of [].concat(o.material)) mats.add(m.uuid);
  });
  const box = new THREE.Box3().setFromObject(root);
  document.querySelector('#stats').textContent =
    `可见网格: ${meshes}\n三角面: ${Math.round(tris)}\n材质: ${mats.size}\n分类: ${buckets.size}\n` +
    `最低点: ${box.min.y.toFixed(3)}\n\n` +
    `标准骨架: 保留 ${templateInfo ? templateInfo.kept : '?'} / 隐藏 ${templateInfo ? templateInfo.hidden : '?'}\n` +
    `脸部: 模板贴图 ${templateInfo && templateInfo.faceMap ? templateInfo.faceMap : '-'}（蓝瞳 ${templateInfo ? templateInfo.irisPixels : 0} px）\n` +
    `手臂枢轴: ${templateInfo && templateInfo.arms ? 'ok' : '未找到'}`;
}
document.querySelector('#variant').onchange = e => build(e.target.value);
document.querySelector('#wire').onclick = () => {
  wire = !wire;
  root.traverse(o => { if (o.isMesh) [].concat(o.material).forEach(m => m.wireframe = wire); });
};
document.querySelector('#spin').onclick = () => spinning = !spinning;
document.querySelector('#reset').onclick = () => { camera.position.set(1.85, 1.50, 4.70); controls.target.set(0, 1.00, 0); controls.update(); };
addEventListener('resize', () => {
  camera.aspect = host.clientWidth / host.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(host.clientWidth, host.clientHeight);
});
camera.aspect = host.clientWidth / host.clientHeight; camera.updateProjectionMatrix();
renderer.setSize(host.clientWidth, host.clientHeight);
document.querySelector('#variant').disabled = true;

window.__girlViewer = { THREE, scene, root, camera, controls, rebuild: build, get buckets() { return buckets; } };

build('classic')
  .then(() => {
    document.querySelector('#loading').classList.add('done');
    document.querySelector('#variant').disabled = false;
  })
  .catch(e => { document.querySelector('#loading').textContent = '加载失败：' + e.message + '\n' + (e.stack || ''); });

(function animate() { requestAnimationFrame(animate); if (spinning) root.rotation.y += .004; controls.update(); renderer.render(scene, camera); })();
