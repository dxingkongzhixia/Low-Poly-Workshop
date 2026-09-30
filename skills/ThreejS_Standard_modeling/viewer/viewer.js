import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const viewport = document.querySelector('#viewport');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101820);
scene.fog = new THREE.Fog(0x101820, 7, 18);
const camera = new THREE.PerspectiveCamera( thirtyFive(), innerWidth / innerHeight, .01, 100 );
camera.position.set(2.8, 1.65, 4.5);
const renderer = new THREE.WebGLRenderer({ antialias:true });
renderer.setPixelRatio(Math.min(devicePixelRatio,2)); renderer.setSize(viewport.clientWidth, viewport.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace; viewport.append(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0,1.1,0); controls.enableDamping=true;
scene.add(new THREE.HemisphereLight(0xbad6e2,0x17232a,2.2));
const key = new THREE.DirectionalLight(0xffe4cf,3.2); key.position.set(3,5,4); scene.add(key);
const fill = new THREE.DirectionalLight(0x8cb9ff,1.2); fill.position.set(-4,2,-2); scene.add(fill);
const floor = new THREE.Mesh(new THREE.CircleGeometry(3.4,64),new THREE.MeshStandardMaterial({color:0x20333d,roughness:1})); floor.rotation.x=-Math.PI/2; floor.position.y=-.02; scene.add(floor);
const root = new THREE.Group(); scene.add(root); let spinning=false, wire=false; const buckets=new Map(); let currentModel;

function thirtyFive(){return 35}
function categoryOf(o){return o.userData?.studyCategory || (o.name?.includes('sword')?'武器／手持道具':'其他')}
function makeMaterial(m){ const x=new THREE.MeshStandardMaterial({color:m.color??0xffffff,roughness:m.roughness??.83,metalness:m.metalness??.04,side:m.side===2?THREE.DoubleSide:THREE.FrontSide}); return x }
const loader = new THREE.ObjectLoader();
async function loadModel(file){
  while(root.children.length) root.remove(root.children[0]); buckets.clear();
  const data=await fetch('../reference/'+file+'.json').then(r=>r.json());
  const model=loader.parse(data); currentModel=model; root.add(model); model.position.y=0; model.scale.setScalar(1.7);
  model.traverse(o=>{if(!o.isMesh)return; o.userData.category=categoryOf(o); if(!buckets.has(o.userData.category))buckets.set(o.userData.category,[]); buckets.get(o.userData.category).push(o); o.castShadow=true; o.receiveShadow=true;});
  const box=new THREE.Box3().setFromObject(model), center=box.getCenter(new THREE.Vector3()); model.position.sub(center); model.position.y+=(box.max.y-box.min.y)*.5;
  buildFilters(); updateStats(); document.querySelector('#loading').classList.add('done');
}
loadModel('iE').catch(e=>{document.querySelector('#loading').textContent='加载失败：'+e.message});
function buildFilters(){const el=document.querySelector('#filters'); [...buckets.keys()].sort().forEach(cat=>{const label=document.createElement('label');const input=document.createElement('input');input.type='checkbox';input.checked=true;input.onchange=()=>buckets.get(cat).forEach(o=>o.visible=input.checked);label.append(input,cat+' ('+buckets.get(cat).length+')');el.append(label)})}
function updateStats(){let meshes=0,triangles=0,materials=new Set();root.traverse(o=>{if(o.isMesh){meshes++;triangles+=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3;Array.isArray(o.material)?o.material.forEach(m=>materials.add(m.uuid)):materials.add(o.material?.uuid)}});document.querySelector('#stats').textContent=`网格: ${meshes}\n三角形: ${Math.round(triangles)}\n材质: ${materials.size}\n分类: ${buckets.size}\n\n预算参考: 2000 tris`}
document.querySelector('#reset').onclick=()=>{camera.position.set(2.8,1.65,4.5);controls.target.set(0,1.1,0);controls.update()}; document.querySelector('#spin').onclick=()=>spinning=!spinning;
document.querySelector('#wire').onclick=()=>{wire=!wire;root.traverse(o=>{if(o.isMesh)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.wireframe=wire)})};
addEventListener('resize',()=>{camera.aspect=viewport.clientWidth/viewport.clientHeight;camera.updateProjectionMatrix();renderer.setSize(viewport.clientWidth,viewport.clientHeight)});
function animate(){requestAnimationFrame(animate);if(spinning)root.rotation.y+=.004;controls.update();renderer.render(scene,camera)} animate();
