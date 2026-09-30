/* ============================================================================
 * 体素 / 外部模型导入器（共享模块）
 *   · .vox            ：逐体素解析 → 三轴贪心合并成大盒（颜色逐块保留，最精确）
 *   · .glb/.gltf/.obj ：载入后按连通分量拆成轴对齐盒（体素/DCC 导出的都是轴对齐块）
 *
 * 被两处使用：character-editor.html（落到部件里）与 model-import.html（预览/导出）
 * ========================================================================== */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

/* ---------------------------------------------------------------- .vox ---- */
/** 解析 MagicaVoxel / VoxiGen 的 .vox
 *  → { size:[W,H,D], cells:Map<key,colorIndex>, palette:[hex×256], count, models } */
export function parseVox(buf){
  if(buf instanceof Uint8Array || ArrayBuffer.isView(buf))
    buf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const dv = new DataView(buf), u32 = o => dv.getUint32(o, true);
  const tag = o => String.fromCharCode(dv.getUint8(o), dv.getUint8(o+1), dv.getUint8(o+2), dv.getUint8(o+3));
  if(tag(0) !== 'VOX ') throw new Error('不是 .vox 文件（缺少 "VOX " 头）');
  let palette = new Uint8Array(1024);
  for(let i=0;i<256;i++){ palette[i*4+3]=255; }
  const models = [];
  (function walk(off, end){
    while(off + 12 <= end){
      const id = tag(off), cs = u32(off+4), chs = u32(off+8);
      const cs0 = off + 12, ce = cs0 + cs;
      if(id === 'MAIN') walk(cs0, ce + chs);
      else if(id === 'SIZE') models.push({ size:[u32(cs0), u32(cs0+4), u32(cs0+8)], raw:null });
      else if(id === 'XYZI'){ const n = u32(cs0), m = models[models.length-1];
        if(m) m.raw = new Uint8Array(buf, cs0 + 4, n * 4); }
      else if(id === 'RGBA') palette = new Uint8Array(buf, cs0, 1024);
      off = ce + chs;
    }
  })(8, buf.byteLength);
  const pal = [];
  for(let i=0;i<256;i++) pal.push('#' + [palette[i*4], palette[i*4+1], palette[i*4+2]]
    .map(v => v.toString(16).padStart(2,'0')).join(''));
  // 多个 model 时沿 X 依次排开，避免叠在一起
  let ox = 0, W = 0, H = 0, D = 0, count = 0;
  const cells = new Map();
  for(const m of models){
    if(!m.raw) continue;
    for(let i=0;i<m.raw.length;i+=4){
      const x = m.raw[i] + ox, y = m.raw[i+1], z = m.raw[i+2], c = m.raw[i+3];
      if(!c) continue;
      cells.set((y*4096 + z)*4096 + x, c); count++;
      if(x+1 > W) W = x+1; if(y+1 > H) H = y+1; if(z+1 > D) D = z+1;
    }
    ox += m.size[0];
  }
  return { size:[W,H,D], cells, palette:pal, count, models:models.length };
}

/** 体素 → 贪心合并的大盒（沿 y→z→x 三轴扩展，同色才合并）*/
export function voxGreedy(size, cells){
  const [W,H,D] = size;
  const get = (x,y,z) => cells.get((y*4096 + z)*4096 + x) || 0;
  const used = new Uint8Array(W*H*D), out = [];
  for(let y=0;y<H;y++) for(let z=0;z<D;z++) for(let x=0;x<W;x++){
    const i = (y*D+z)*W + x;
    if(used[i]) continue;
    const c = get(x,y,z); if(!c) continue;
    let x2 = x; while(x2+1 < W && !used[(y*D+z)*W + x2+1] && get(x2+1,y,z) === c) x2++;
    let z2 = z;
    zLoop: while(z2+1 < D){ for(let xx=x; xx<=x2; xx++){ const j = (y*D+z2+1)*W + xx;
      if(used[j] || get(xx,y,z2+1) !== c) break zLoop; } z2++; }
    let y2 = y;
    yLoop: while(y2+1 < H){ for(let zz=z; zz<=z2; zz++) for(let xx=x; xx<=x2; xx++){
      const j = ((y2+1)*D+zz)*W + xx; if(used[j] || get(xx,y2+1,zz) !== c) break yLoop; } y2++; }
    for(let yy=y; yy<=y2; yy++) for(let zz=z; zz<=z2; zz++) for(let xx=x; xx<=x2; xx++) used[(yy*D+zz)*W + xx] = 1;
    out.push({ x0:x, x1:x2+1, y0:y, y1:y2+1, z0:z, z1:z2+1, c });
  }
  return out;
}

/* ------------------------------------------------------------- 载入工具 ---- */
export async function fetchArrayBuffer(src){
  if(typeof src !== 'string') throw new Error('需要 URL / dataURL / base64 字符串');
  if(src.startsWith('data:')){
    const b64 = src.slice(src.indexOf(',') + 1), bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
  const r = await fetch(src);
  if(!r.ok) throw new Error('下载失败 ' + r.status + ' ' + src);
  return await r.arrayBuffer();
}

/** 任意网格 → 轴对齐盒列表（按共享顶点求连通分量，每块取包围盒 + 平均色）*/
export function meshToBoxes(mesh, target){
  const g = mesh.geometry; if(!g) return [];
  const pos = g.getAttribute('position'); if(!pos) return [];
  const col = g.getAttribute('color');
  const n = pos.count;
  const uf = new Int32Array(n); for(let i=0;i<n;i++) uf[i] = i;
  const find = x => { while(uf[x] !== x){ uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
  const uni = (a,b) => { a = find(a); b = find(b); if(a !== b) uf[b] = a; };
  const map = new Map();
  for(let i=0;i<n;i++){
    const k = Math.round(pos.getX(i)*1e4) + '_' + Math.round(pos.getY(i)*1e4) + '_' + Math.round(pos.getZ(i)*1e4);
    const p = map.get(k); if(p === undefined) map.set(k,i); else uni(p,i);
  }
  for(let t=0;t+2<n;t+=3){ uni(t,t+1); uni(t,t+2); }
  const comps = new Map();
  for(let t=0;t+2<n;t+=3){ const r = find(t); let a = comps.get(r); if(!a){ a = []; comps.set(r,a); } a.push(t); }
  const M = new THREE.Matrix4().copy(target.matrixWorld).invert().multiply(mesh.matrixWorld);
  const p = new THREE.Vector3(), out = [];
  for(const tris of comps.values()){
    let mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9], r = 0, gg = 0, b = 0, k = 0;
    for(const t of tris) for(let j=0;j<3;j++){
      const i = t + j;
      p.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(M);
      if(p.x<mn[0])mn[0]=p.x; if(p.y<mn[1])mn[1]=p.y; if(p.z<mn[2])mn[2]=p.z;
      if(p.x>mx[0])mx[0]=p.x; if(p.y>mx[1])mx[1]=p.y; if(p.z>mx[2])mx[2]=p.z;
      if(col){ r += col.getX(i); gg += col.getY(i); b += col.getZ(i); k++; }
    }
    if(mx[0]-mn[0] < 1e-5 && mx[1]-mn[1] < 1e-5 && mx[2]-mn[2] < 1e-5) continue;   // 退化面片丢
    const hex = k ? new THREE.Color().setRGB(r/k, gg/k, b/k).getHex() : 0xcccccc;
    out.push({ x0:mn[0], x1:mx[0], y0:mn[1], y1:mx[1], z0:mn[2], z1:mx[2], c:null, hex });
  }
  return out;
}

/** 载入 .glb/.gltf/.obj，返回 { boxes, root } */
export async function loadMeshBoxes(src, ext){
  const name = (src.split('?')[0].split('/').pop() || '').toLowerCase();
  const isObj = ext === 'obj' || name.endsWith('.obj');
  const buf = isObj ? await (await fetch(src)).text() : await fetchArrayBuffer(src);
  const loader = isObj ? new OBJLoader() : new GLTFLoader();
  const gltf = await loader.parseAsync(buf, '');
  const root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
  const tmp = new THREE.Group(); tmp.add(root); tmp.updateMatrixWorld(true);
  const boxes = [];
  root.traverse(o => { if(o.isMesh) boxes.push(...meshToBoxes(o, tmp)); });
  return { boxes, root:tmp };
}

/* ------------------------------------------------- 网格 → 体素（体素化） ---- */
/** 三角网格 → 体素网格：表面采样打点（+ 可选实心填充）
 *  → { size:[W,H,D], cells:Map<键,colorHex>, count }（和 parseVox 同构，可直接喂 voxGreedy）
 *  opts.res   ：最长边切多少格（默认 48）
 *  opts.fill  ：是否做「外部泛洪 + 内部填实」判实心
 *               · 单一闭合网格（Meshy / TRELLIS / 扫描件）→ true，得到实心体素
 *               · 一堆分离的盒子壳（例如原作低模）→ false，只留表面壳，否则空隙会被灌实糊成一坨
 *  opts.grid  ：{ min:[x,y,z], cell, size:[W,H,D] } —— 多个网格要落进同一张网格时必须传 */
export function voxelizeMesh(mesh, opts = {}){
  const g = mesh.geometry; if(!g) return null;
  if(!g.getAttribute('position')) return null;
  mesh.updateWorldMatrix(true, false);

  // 顶点全部烘焙到「网格世界坐标」
  const pos = g.getAttribute('position'), col = g.getAttribute('color'), idx = g.index;
  const n = pos.count, P = new Float64Array(n*3), C = new Float32Array(n*3);
  const v = new THREE.Vector3();
  let mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
  for(let i=0;i<n;i++){
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld);
    P[i*3] = v.x; P[i*3+1] = v.y; P[i*3+2] = v.z;
    for(let j=0;j<3;j++){ const t = [v.x,v.y,v.z][j]; if(t<mn[j])mn[j]=t; if(t>mx[j])mx[j]=t; }
    C[i*3] = col ? col.getX(i) : 0.8;
    C[i*3+1] = col ? col.getY(i) : 0.8;
    C[i*3+2] = col ? col.getZ(i) : 0.8;
  }
  const size = [mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]];
  const L = Math.max(size[0], size[1], size[2]) || 1;
  const res = Math.max(6, Math.min(96, opts.res | 0 || 28));
  let cell, W, H, D;
  if(opts.grid){                                     // 共用网格
    cell = opts.grid.cell;
    mn = opts.grid.min;
    W = opts.grid.size[0]; H = opts.grid.size[1]; D = opts.grid.size[2];
  }else{
    cell = L / res;
    W = Math.max(1, Math.ceil(size[0]/cell)+2);
    H = Math.max(1, Math.ceil(size[1]/cell)+2);
    D = Math.max(1, Math.ceil(size[2]/cell)+2);
  }
  const key = (x,y,z) => (y*4096 + z)*4096 + x;
  const cells = new Map();
  const put = (x,y,z,hex) => { if(x>=0&&y>=0&&z>=0&&x<W&&y<H&&z<D) cells.set(key(x,y,z), hex); };
  const toCell = p => [ Math.floor((p[0]-mn[0])/cell)+1, Math.floor((p[1]-mn[1])/cell)+1, Math.floor((p[2]-mn[2])/cell)+1 ];
  const hexOf = (i) => {
    const c = new THREE.Color(C[i*3], C[i*3+1], C[i*3+2]);
    return '#' + c.getHexString();
  };

  // ---- 1) 表面打点：沿三角形重心坐标细分采样，落到最近格 ----
  const triCount = idx ? idx.count/3 : n/3;
  const sx = Math.ceil(size[0]/cell), sy = Math.ceil(size[1]/cell), sz = Math.ceil(size[2]/cell);
  const maxSub = Math.max(1, Math.min(40, Math.ceil(Math.max(sx,sy,sz) * 1.6)));
  for(let t=0;t<triCount;t++){
    const a = idx ? idx.getX(t*3) : t*3, b = idx ? idx.getX(t*3+1) : t*3+1, c2 = idx ? idx.getX(t*3+2) : t*3+2;
    const ax=P[a*3],ay=P[a*3+1],az=P[a*3+2], bx=P[b*3],by=P[b*3+1],bz=P[b*3+2], cx=P[c2*3],cy=P[c2*3+1],cz=P[c2*3+2];
    const e = Math.max(
      Math.hypot(bx-ax,by-ay,bz-az),
      Math.hypot(cx-bx,cy-by,cz-bz),
      Math.hypot(ax-cx,ay-cy,az-cz));
    const sub = Math.max(1, Math.min(maxSub, Math.ceil(e / (cell*0.6))));
    const hex = hexOf(a);
    for(let i=0;i<=sub;i++) for(let j=0;j<=sub-i;j++){
      const u = i/sub, w = j/sub, k = 1-u-w;
      if(k < -1e-6) continue;
      const p = [ax*k+bx*u+cx*w, ay*k+by*u+cy*w, az*k+bz*u+cz*w];
      const q = toCell(p); put(q[0],q[1],q[2], hex);
    }
  }
  if(!cells.size) return { size:[W,H,D], cells, count:0 };

  // ---- 2) 实心填充（可选）：从六个面往里灌，灌不到的空格就是内部 → 填实 ----
  if(opts.fill === false) return { size:[W,H,D], cells, count:cells.size, added:0, surface:true };
  // 注意：filled/outside 是「扁平数组」，必须用扁平下标 idx()；
  //       4096 进制的 key() 只用于 cells 这个 Map（两者不能混用）
  const flat = (x,y,z) => (y*D + z)*W + x;
  const filled = new Uint8Array(W*H*D);
  for(const k of cells.keys()){                    // cells 的键是 4096 进制，要解出来再换成扁平下标
    const x = k % 4096, y = Math.floor(k/4096) % 4096, z = Math.floor(k/(4096*4096));
    filled[flat(x,y,z)] = 1;
  }
  const outside = new Uint8Array(W*H*D);
  const stack = [];
  const push = (x,y,z) => {
    if(!(x>=0 && y>=0 && z>=0 && x<W && y<H && z<D)) return;
    const i = flat(x,y,z);
    if(outside[i] || filled[i]) return;
    outside[i] = 1; stack.push(x,y,z);
  };
  for(let x=0;x<W;x++) for(let z=0;z<D;z++){ push(x,0,z); push(x,H-1,z); }
  for(let y=0;y<H;y++) for(let z=0;z<D;z++){ push(0,y,z); push(W-1,y,z); }
  for(let x=0;x<W;x++) for(let y=0;y<H;y++){ push(x,y,0); push(x,y,D-1); }
  while(stack.length){
    const z = stack.pop(), y = stack.pop(), x = stack.pop();
    push(x+1,y,z); push(x-1,y,z); push(x,y+1,z); push(x,y-1,z); push(x,y,z+1); push(x,y,z-1);
  }
  // 内部空格：用相邻已填格的色
  let added = 0;
  for(let y=1;y<H-1;y++) for(let z=1;z<D-1;z++) for(let x=1;x<W-1;x++){
    const i = flat(x,y,z);
    if(filled[i] || outside[i]) continue;
    let hex = null;
    for(const [dx,dy,dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){
      const t = cells.get(key(x+dx,y+dy,z+dz)); if(t){ hex = t; break; } }
    cells.set(key(x,y,z), hex || '#cccccc'); added++;
  }
  return { size:[W,H,D], cells, count:cells.size, added };
}

/* -------------------------------------------------------- 高层一步到位 ---- */

/** 从 URL / dataURL / File 读入 → 盒列表（统一坐标：源 Z-up 转 Y-up）
 *  ext 不传就按文件名猜。
 *  opts.voxelize = true 时，网格先体素化再合并（Meshy/TRELLIS 那种平滑网格必须走这条）
 *  opts.res  = 体素化精度（最长边切多少格，默认 48）
 *  opts.fill = 是否判实心（默认：单一网格 true / 多网格 false）
 *  返回 { boxes, kind, stats } */
export async function readBoxes(src, ext, opts={}){
  const e = (ext || src.split('?')[0].split('.').pop() || '').toLowerCase();
  if(e === 'vox'){
    const p = parseVox(await fetchArrayBuffer(src));
    if(!p.count) throw new Error('.vox 里没有体素');
    const boxes = voxGreedy(p.size, p.cells).map(b => ({ ...b, hex:p.palette[(b.c-1+256)%256] }));
    return { boxes, kind:'vox', stats:{ voxels:p.count, models:p.models, voxSize:p.size, palette:p.palette.length } };
  }
  const { boxes:meshBoxes, root } = await loadMeshBoxes(src, e);
  if(!meshBoxes.length) throw new Error('模型里没有可用的网格');
  if(opts.voxelize){
    // ① 先算所有网格的并集包围盒 → 定一张共享体素网格（否则各网格坐标会互相错位）
    const bbs = []; const umn=[1e9,1e9,1e9], umx=[-1e9,-1e9,-1e9];
    root.updateMatrixWorld(true);
    root.traverse(m => { if(!m.isMesh) return;
      m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
      bbs.push(b);
      const lo=[b.min.x,b.min.y,b.min.z], hi=[b.max.x,b.max.y,b.max.z];
      for(let j=0;j<3;j++){ if(lo[j]<umn[j])umn[j]=lo[j]; if(hi[j]>umx[j])umx[j]=hi[j]; }
    });
    if(!bbs.length) throw new Error('模型里没有网格');
    const sz = [umx[0]-umn[0], umx[1]-umn[1], umx[2]-umn[2]];
    const L = Math.max(sz[0],sz[1],sz[2]) || 1;
    const res = Math.max(6, Math.min(160, opts.res|0 || 48));
    const cell = L / res;
    const grid = { min:umn, cell, size:[ Math.ceil(sz[0]/cell)+2, Math.ceil(sz[1]/cell)+2, Math.ceil(sz[2]/cell)+2 ] };
    // ② 所有网格落进同一张网格
    //    实心填充只在「单一闭合网格」时才对；游戏模型那种一堆分离盒子壳必须关掉
    const fill = (opts.fill != null) ? !!opts.fill : (bbs.length === 1);
    const cells = new Map(); let voxTotal = 0;
    root.traverse(m => {
      if(!m.isMesh) return;
      const vz = voxelizeMesh(m, { grid, fill });
      if(!vz || !vz.count) return;
      voxTotal += vz.count;
      for(const [k,hex] of vz.cells) cells.set(k, hex);
    });
    if(!cells.size) throw new Error('体素化后是空的');
    // ③ 贪心合并
    const boxes = voxGreedy(grid.size, cells);
    return { boxes, kind:'voxelized', stats:{ meshes:bbs.length, voxels:voxTotal, res, fill, grid:grid.size } };
  }
  return { boxes:meshBoxes, kind:e || 'mesh', stats:{ meshes:meshBoxes.length } };
}

/** 把盒列表归一化：可选 Z-up→Y-up、按高度缩放、底部中心对齐到原点
 *  返回 { boxes:[{x,y,z,w,h,d,color}], bounds, scale } —— 纯数据，不含 three 对象 */
export function normalizeBoxes(boxes, opts={}){
  if(!boxes.length) return { boxes:[], bounds:[0,0,0], scale:1 };
  const up = opts.up || 'y';
  const B = (up === 'z')
    ? boxes.map(b => ({ x0:b.x0,x1:b.x1, y0:b.z0,y1:b.z1, z0:b.y0,z1:b.y1, c:b.c, hex:b.hex }))
    : boxes;
  let mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
  for(const b of B){
    mn[0]=Math.min(mn[0],b.x0); mn[1]=Math.min(mn[1],b.y0); mn[2]=Math.min(mn[2],b.z0);
    mx[0]=Math.max(mx[0],b.x1); mx[1]=Math.max(mx[1],b.y1); mx[2]=Math.max(mx[2],b.z1);
  }
  const size = [mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]];
  let sc = opts.scale;
  if(sc == null) sc = opts.fitHeight ? opts.fitHeight / size[1] : 1;
  const cx = (mn[0]+mx[0])/2, cz = (mn[2]+mx[2])/2;
  const r4 = v => Math.round(v*1e4)/1e4;
  const out = B.map(b => ({
    x: r4(((b.x0+b.x1)/2 - cx) * sc),
    y: r4(((b.y0+b.y1)/2 - mn[1]) * sc),      // 注意：y 取「块中心」，底面才落在 0
    z: r4(((b.z0+b.z1)/2 - cz) * sc),
    w: r4(Math.max((b.x1-b.x0)*sc, 0.004)),
    h: r4(Math.max((b.y1-b.y0)*sc, 0.004)),
    d: r4(Math.max((b.z1-b.z0)*sc, 0.004)),
    color: b.hex != null ? b.hex : b.c
  }));
  return { boxes:out, bounds:size.map(v => r4(v)), scale:r4(sc), anchor:'底部中心在原点' };
}

export { THREE };
