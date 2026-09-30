import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111720);
scene.fog = new THREE.Fog(0x111720, 90, 190);

const host = document.querySelector('main');
const camera = new THREE.PerspectiveCamera(34, 1, 1, 400);
camera.position.set(48, 62, 92);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
host.append(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 34, 0);

scene.add(new THREE.HemisphereLight(0xd8eaf6, 0x1a2230, 2.0));
const key = new THREE.DirectionalLight(0xfff2e6, 2.3);
key.position.set(60, 110, 80);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
const sc = key.shadow.camera;
sc.near = 1; sc.far = 400; sc.left = -90; sc.right = 90; sc.top = 130; sc.bottom = -30;
scene.add(key);
const rim = new THREE.DirectionalLight(0x89b7ff, 1.1); rim.position.set(-80, 60, -90); scene.add(rim);

const floor = new THREE.Mesh(new THREE.CircleGeometry(120, 64), new THREE.MeshStandardMaterial({ color: 0x1d2734, roughness: 1 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

const grid = new THREE.GridHelper(160, 40, 0x35505f, 0x243642);
grid.position.y = 0.02; scene.add(grid);

// a hand-built unit cube: the voxel primitive (not THREE.BoxGeometry)
function cubeGeometry() {
  const p = [
    [-.5, -.5, -.5], [.5, -.5, -.5], [.5, .5, -.5], [-.5, .5, -.5],
    [-.5, -.5, .5], [.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5]
  ];
  const faces = [
    [0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7],
    [1, 5, 6, 2], [4, 5, 1, 0], [3, 2, 6, 7]
  ];
  const pos = [], nrm = [], idx = [];
  faces.forEach((f, fi) => {
    const base = pos.length / 3;
    const n = new THREE.Vector3();
    const a = new THREE.Vector3(...p[f[0]]), b = new THREE.Vector3(...p[f[1]]), c = new THREE.Vector3(...p[f[2]]);
    n.subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    f.forEach(i => { pos.push(...p[i]); nrm.push(n.x, n.y, n.z); });
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

const CUBE = cubeGeometry();
const material = new THREE.MeshStandardMaterial({ roughness: .82, metalness: .02, vertexColors: true });

const holder = new THREE.Group();   // rotates instead of the mesh, so it spins about its centre
scene.add(holder);
let voxelMesh = null, spinning = true, showGrid = true;
let info = { total: 0, surface: 0 };

const $ = s => document.querySelector(s);

// --- axis mapping: .vox is Z-up with the front at -Y ------------------------
// three.js is Y-up, so (x, y, z)_vox -> (x, z, -y)_three
function toThree(x, y, z) { return [x, z, -y]; }

function buildVoxels(data) {
  if (voxelMesh) { holder.remove(voxelMesh); voxelMesh.geometry.dispose(); voxelMesh.material.dispose(); voxelMesh = null; }
  holder.rotation.y = 0;

  const [SX, SY, SZ] = data.size;
  const [OX, OY] = data.offset;
  // occupancy for surface detection
  const occ = new Uint8Array(SX * SY * SZ);
  const at = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= SX || y >= SY || z >= SZ) ? 0 : occ[(z * SY + y) * SX + x];
  for (const [x, y, z] of data.voxels) {
    const ix = x + OX, iy = y + OY;
    if (ix >= 0 && iy >= 0 && ix < SX && iy < SY && z >= 0 && z < SZ) occ[(z * SY + iy) * SX + ix] = 1;
  }

  // keep only surface voxels: a fully enclosed voxel is never visible
  const visible = data.voxels.filter(([x, y, z]) => {
    const ix = x + OX, iy = y + OY;
    return !(at(ix + 1, iy, z) && at(ix - 1, iy, z) && at(ix, iy + 1, z) &&
      at(ix, iy - 1, z) && at(ix, iy, z + 1) && at(ix, iy, z - 1));
  });

  const palette = data.palette.map(h => new THREE.Color(h));
  const mesh = new THREE.InstancedMesh(CUBE, material, visible.length);
  mesh.castShadow = mesh.receiveShadow = true;
  const m = new THREE.Matrix4();
  visible.forEach(([x, y, z, c], i) => {
    const [tx, ty, tz] = toThree(x, y, z);
    m.makeTranslation(tx, ty, tz);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, palette[c - 1] || new THREE.Color(1, 0, 1));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.geometry.computeBoundingSphere();

  // recentre so the feet sit on y=0 and x/z are centred
  const box = new THREE.Box3().setFromObject(mesh);
  mesh.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);

  voxelMesh = mesh;
  holder.add(mesh);
  info = { total: data.voxels.length, surface: visible.length };
  return { box, size: [SX, SY, SZ] };
}

function updateStats(size, box) {
  const tris = info.surface * 12;
  $('#stats').textContent =
    `体素总数: ${info.total.toLocaleString()}\n` +
    `可见体素: ${info.surface.toLocaleString()}\n` +
    `三角面: ${tris.toLocaleString()}\n` +
    `模型尺寸: ${size[0]} × ${size[1]} × ${size[2]}\n` +
    `模型高度: ${(box.max.y - box.min.y).toFixed(0)} 体素`;
}

async function load(variant) {
  $('#loading').classList.remove('done');
  const data = await fetch(`qgirl-${variant}.json`).then(r => r.json());
  const { box, size } = buildVoxels(data);
  updateStats(size, box);
  // frame the model
  const h = box.max.y - box.min.y;
  controls.target.set(0, h * 0.5, 0);
  camera.position.set(h * 1.05, h * 0.85, h * 1.35);
  camera.updateProjectionMatrix();
  controls.update();
  $('#loading').classList.add('done');
}

$('#variant').onchange = e => load(e.target.value);
$('#spin').onclick = e => { spinning = !spinning; e.target.classList.toggle('on', spinning); };
$('#grid').onclick = e => { showGrid = !showGrid; grid.visible = showGrid; e.target.classList.toggle('on', showGrid); };
$('#reset').onclick = () => {
  const h = voxelMesh ? new THREE.Box3().setFromObject(voxelMesh).max.y : 60;
  controls.target.set(0, h * 0.5, 0);
  camera.position.set(h * 1.05, h * 0.85, h * 1.35);
  controls.update();
};
addEventListener('resize', () => {
  camera.aspect = host.clientWidth / host.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(host.clientWidth, host.clientHeight);
});
camera.aspect = host.clientWidth / host.clientHeight; camera.updateProjectionMatrix();
renderer.setSize(host.clientWidth, host.clientHeight);
$('#spin').classList.add('on');

window.__voxelViewer = { THREE, scene, camera, controls, get mesh() { return voxelMesh; }, get info() { return info; } };

load('classic').catch(e => {
  $('#loading').textContent = '加载失败：' + e.message;
});

(function animate() {
  requestAnimationFrame(animate);
  if (spinning && voxelMesh) holder.rotation.y += 0.0035;
  controls.update();
  renderer.render(scene, camera);
})();
