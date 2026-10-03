/* ============================================================================
 * 低模工坊 · 本地服务器 + 存储 API
 *
 * 静态：把当前目录当 web root 提供服务（ES module 必须走 http，file:// 不行）
 * 存储：三个目录 + 一个 agent 记录
 *   NewlyAddedModelList/<id>/            确认的新增模型（正式）
 *   NewlyAddedModelTemporaryList/<id>/   待确认的新增模型（临时）
 *   TemporaryCache/                      AI 测试产物 / 缓存（随时可清）
 *   TemporaryCache/agent.json            当前接管生成流程的 AI Agent
 *
 * REST（全部 CORS 放开，方便页面直接 fetch）
 *   GET    /api/index                          ★ AI 入口：一次性列出「有什么、从哪拿」
 *   GET    /api/characters                     原作角色索引（低模 14 + 高模烘焙变体）
 *   POST   /api/characters                     浏览器把权威角色清单写回 data/characters.json
 *   GET    /api/store                          总览
 *   GET    /api/models                         列表（正式 + 临时）
 *   GET    /api/models/:id                     取完整模型
 *   GET    /api/models/:id/bundle              ★ 一次拿全：meta + spec + js + 文件清单 + 直链
 *   GET    /api/models/:id/files               模型目录里的文件清单
 *   GET    /api/models/:id/file/:name          ★ 取原始文件（?download=1 带 attachment）
 *   POST   /api/models                         {id,name,spec,js,thumb,note,dir}  存（默认进临时）
 *   POST   /api/models/:id/confirm              临时 → 正式
 *   POST   /api/models/:id/unconfirm            正式 → 临时
 *   DELETE /api/models/:id                      删除
 *   GET    /api/cache                          缓存列表
 *   POST   /api/cache                          {name,data,note}  写缓存
 *   DELETE /api/cache                          清空缓存
 *   GET    /api/agent                          谁接管了
 *   POST   /api/agent                          {agent,note}  记下谁接管
 *   POST   /api/agent/ping                     续约
 *
 * 「模型文件」的两种拿法（AI Agent 最关心）：
 *   磁盘上的  → GET /api/models/:id/bundle            （或直接 GET /NewlyAddedModelList/<id>/model.json）
 *   没保存的  → 页面里 await EditorAPI.modelFile()     （同一形状，只存在内存里）
 * ========================================================================== */
const http = require('http'), fs = require('fs'), path = require('path');
// ★ 工具在 tools/ 下：工作根目录 = 本文件上一级（不依赖 cwd，从哪跑都对）
const root = path.resolve(__dirname, '..');

const DIR = {
  confirmed: path.join(root, 'NewlyAddedModelList'),
  temporary: path.join(root, 'NewlyAddedModelTemporaryList'),
  cache:     path.join(root, 'TemporaryCache'),
  refs:      path.join(root, 'TemporaryCache', 'refs'),   // ★ 参照图：放在缓存里 → 清缓存即清
};
/* ★ 武器走**独立**的一套目录 + 文件名（weapon.json / weapon.js），不跟人物混 */
const DIR_W = {
  confirmed: path.join(root, 'NewlyAddedWeaponList'),
  temporary: path.join(root, 'NewlyAddedWeaponTemporaryList'),
};
/* ★ 共享武器库（共享池的本体）：只有「正式」一层 */
const DIR_O = {
  confirmed: path.join(root, 'OriginalWeaponList'),
  temporary: path.join(root, 'OriginalWeaponList'),
};
for(const d of [...Object.values(DIR), ...Object.values(DIR_W), DIR_O.confirmed]) fs.mkdirSync(d, { recursive: true });

/* ★ 「模型」和「武器」两套目录/文件名，共用同一批读写函数 —— 用 kind 区分 */
const KINDS = {
  model:  { json:'model.json',  js:'model.js',  dirs:DIR,   category:'新增模型',
            schema:'lowpoly-workshop/model@1',
            dirName:{ confirmed:'NewlyAddedModelList',  temporary:'NewlyAddedModelTemporaryList' } },
  weapon: { json:'weapon.json', js:'weapon.js', dirs:DIR_W, category:'新增武器',
            schema:'lowpoly-workshop/weapon@1',
            dirName:{ confirmed:'NewlyAddedWeaponList', temporary:'NewlyAddedWeaponTemporaryList' } },
  /* 共享武器库 = 共享池本体（黑刃 / 黑岩巨炮 / 葱 …），正式区 */
  original:{ json:'weapon.json', js:'weapon.js', dirs:DIR_O, category:'原版武器',
            schema:'lowpoly-workshop/weapon@1',
            dirName:{ confirmed:'OriginalWeaponList', temporary:'OriginalWeaponList' } },
};

const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.md':'text/markdown; charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp',
  '.svg':'image/svg+xml; charset=utf-8', '.ico':'image/x-icon',
  '.glb':'model/gltf-binary', '.gltf':'model/gltf+json', '.obj':'text/plain; charset=utf-8',
  '.vox':'application/octet-stream', '.txt':'text/plain; charset=utf-8',
  '.bat':'text/plain; charset=utf-8' };

/* --------------------------------------------------------------- 小工具 --- */
const safeId = s => String(s || '').trim().replace(/[^A-Za-z0-9_\u4e00-\u9fa5.\-]/g, '_').replace(/^\.+/, '').slice(0, 64);
function readBody(req, limit = 64 * 1024 * 1024){
  return new Promise((res, rej) => { let n = 0; const c = [];
    req.on('data', d => { n += d.length; if(n > limit){ rej(new Error('body too large')); req.destroy(); } else c.push(d); });
    req.on('end', () => res(Buffer.concat(c).toString('utf8'))); req.on('error', rej); });
}
function send(res, code, body, type){
  res.writeHead(code, { 'Content-Type': type || MIME['.json'], 'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': '*', 'Cache-Control': 'no-cache' });
  res.end(body);
}
const ok  = (res, o) => send(res, 200, JSON.stringify(o));
const bad = (res, m) => send(res, 400, JSON.stringify({ ok:false, error:String(m) }));
const die = (res, m) => send(res, 404, JSON.stringify({ ok:false, error:String(m) }));

function dirSize(p){
  let bytes = 0, files = 0;
  try{ for(const f of fs.readdirSync(p)){ const s = fs.statSync(path.join(p, f)); if(s.isFile()){ bytes += s.size; files++; } } }catch(e){}
  return { bytes, files };
}
function modelMeta(base, id, k = 'model'){
  const K = KINDS[k];
  const f = path.join(base, id, K.json);
  if(!fs.existsSync(f)) return null;
  try{
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    const st = fs.statSync(f);
    const hasJs = fs.existsSync(path.join(base, id, K.js));
    const hasThumb = fs.existsSync(path.join(base, id, 'thumb.png'));
    const folder = path.basename(base);
    return { id: j.id || id, name: j.name || id, category: j.category || K.category,
      source: j.source || null, note: j.note || '',
      thumb: hasThumb ? ('/' + folder + '/' + id + '/thumb.png') : null,   // ★ 只给 URL，不回传 dataURL
      createdAt: j.createdAt || st.mtimeMs, updatedAt: st.mtimeMs,
      parts: j.stats ? j.stats.parts : null, triangles: j.stats ? j.stats.triangles : null,
      // 武器专有：挂载数 / 种类 / 绑定了几个动作
      mount: j.mount != null ? j.mount : null, kind: j.kind || null,
      moves: Array.isArray(j.moves) ? j.moves : null,
      runtime: !!j.runtime,
      runtimeId: j.runtime || null,               // ★ 真正的运行时武器 id（黑刃/黑岩巨炮/葱）；列表里也带上，别只给布尔
      hasJs, dir: folder };
  }catch(e){ return null; }
}
function listModels(base, k = 'model'){
  if(!fs.existsSync(base)) return [];
  return fs.readdirSync(base).filter(d => { try{ return fs.statSync(path.join(base, d)).isDirectory(); }catch(e){ return false; } })
    .map(id => modelMeta(base, id, k)).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
}
function rmrf(p){ if(fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); }
function findModel(id, k = 'model'){
  const dirs = KINDS[k].dirs;
  for(const key of ['temporary', 'confirmed']){
    const p = path.join(dirs[key], id);
    if(fs.existsSync(path.join(p, KINDS[k].json))) return { key, dir:p };
  }
  return null;
}
function readJsonFile(p, fallback){
  try{ return JSON.parse(fs.readFileSync(p, 'utf8')); }catch(e){ return fallback; }
}
function fileInfo(dir, name, urlBase){
  try{
    const st = fs.statSync(path.join(dir, name));
    if(!st.isFile()) return null;
    return { name, bytes:st.size, mtime:st.mtimeMs, url:urlBase + '/' + name };
  }catch(e){ return null; }
}
/** 一个模型/武器目录里的全部文件 + 三个约定文件的直链 */
function listModelFiles(f, id, k = 'model'){
  const K = KINDS[k];
  // ★ 静态 URL 必须用**真实目录名**（NewlyAddedModelList / …TemporaryList），
  //   不能用内部键名（confirmed / temporary）—— 后者不是磁盘上的路径，会 404。
  const urlBase = '/' + (K.dirName[f.key] || path.basename(path.dirname(f.dir))) + '/' + id;
  const files = fs.readdirSync(f.dir).map(n => fileInfo(f.dir, n, urlBase)).filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
  const has = n => files.some(x => x.name === n);
  return { dir:f.dir, where:f.key, urlBase, files,
    urls: { model: has(K.json)    ? urlBase + '/' + K.json    : null,
            js:    has(K.js)      ? urlBase + '/' + K.js      : null,
            thumb: has('thumb.png') ? urlBase + '/thumb.png'  : null } };
}
/** ★ 给 AI 的「模型 / 武器文件」标准形状。
 *  磁盘上的和编辑器**没保存的当前状态**都用这个形状 —— 调用方不用区分。 */
function modelBundle(f, id, k = 'model'){
  const K = KINDS[k];
  const rec = readJsonFile(path.join(f.dir, K.json), {});
  const lf = listModelFiles(f, id, k);
  const jsPath = path.join(f.dir, K.js);
  const meta = { ...rec }; delete meta.spec;        // 元数据（不含 spec，避免重复）
  return { ok:true, id, kind:k, where:f.key, path:f.dir,
    schema: rec.schema || K.schema,
    meta, spec: rec.spec || null, stats: rec.stats || null,
    js: fs.existsSync(jsPath) ? fs.readFileSync(jsPath, 'utf8') : null,
    files: lf.files, urls: lf.urls,
    howto: k === 'weapon'
      ? 'spec 是武器本体图元；mount 单手/双手，kind 种类，moves 绑定的动作；武器是独立路线，不挂骨架。'
      : 'spec 是编辑器规格（可直接喂给 EditorAPI.setSpec/upsertPart）；js 是工厂函数（实验室靠它构建）。' };
}
/** 原作角色索引：低模 14 人 + 高模烘焙变体。
 *  优先读 data/characters.json（浏览器用 EditorAPI.exportCharacterIndex() 生成，最权威）；
 *  没有就退回 data/reference-models.json + 扫 models/ 目录。 */
function characterIndex(){
  const pubs = readJsonFile(path.join(root, 'data', 'characters.json'), null);
  if(pubs && pubs.low) return { ...pubs, source:'data/characters.json（浏览器导出）' };
  const ref = readJsonFile(path.join(root, 'data', 'reference-models.json'), { models:{} });
  const low = Object.keys(ref.models || {}).map(id => ({ id, label: ref.models[id].label || id,
    reference: '/data/reference-models.json#models.' + id, build:'XT(' + JSON.stringify(id) + ')' }));
  const high = [];
  const dir = path.join(root, 'models');
  if(fs.existsSync(dir)) for(const f of fs.readdirSync(dir)){
    const m = /^([a-z0-9_]+)-([a-z0-9_]+)\.json$/i.exec(f);
    if(!m || f.startsWith('_')) continue;
    const hit = high.find(h => h.id === m[1]);
    if(hit) hit.variants.push(m[2]); else high.push({ id:m[1], variants:[m[2]], baked:true, files:[] });
  }
  for(const h of high) h.files = h.variants.map(v => '/models/' + h.id + '-' + v + '.json');
  return { low, high, source:'data/reference-models.json + models/ 目录扫描' };
}
function writeModel(base, id, payload, k = 'model'){
  const K = KINDS[k];
  const d = path.join(base, id); fs.mkdirSync(d, { recursive: true });
  const now = Date.now();
  let createdAt = now;
  const prev = path.join(d, K.json);
  if(fs.existsSync(prev)){ try{ createdAt = JSON.parse(fs.readFileSync(prev, 'utf8')).createdAt || now; }catch(e){} }
  const rec = { schema:K.schema, id, name:payload.name || id,
    category:payload.category || K.category, source:payload.source || null, note:payload.note || '',
    createdAt, updatedAt:now, stats:payload.stats || null, spec:payload.spec || null };
  if(k === 'weapon' || k === 'original'){             // ★ 武器专有字段（新增武器 + 共享武器库）
    rec.mount = payload.mount != null ? payload.mount : 1;      // 1 单手 / 2 双手
    rec.kind  = payload.kind || null;                            // blade/hammer/gun/cannon/shield/…
    rec.moves = Array.isArray(payload.moves) ? payload.moves : [];  // 绑定的动作（ATTACKS 的 key）
    rec.grip  = payload.grip || [0, 0, 0];
    rec.hold  = payload.hold || null;
    rec.runtime = payload.runtime || null;               // 若指向运行时武器（可选）
  }
  fs.writeFileSync(prev, JSON.stringify(rec, null, 2), 'utf8');
  if(payload.js) fs.writeFileSync(path.join(d, K.js), String(payload.js), 'utf8');
  // ★ 缩略图**落盘**，不要把 dataURL 写进 model.json（会让文件爆炸、接口回传几 MB）
  if(payload.thumb && /^data:image\/png;base64,/.test(payload.thumb)){
    fs.writeFileSync(path.join(d, 'thumb.png'), Buffer.from(payload.thumb.split('base64,')[1], 'base64'));
    rmrf(path.join(d, 'thumb.jpg'));
  }
  return rec;
}

/* ------------------------------------------------------------------ 路由 --- */
/* ============================================================================
 * 参照图服务（refs）—— 参照图是「一等资产」，交给服务端解析，AI 直接读结论
 * ----------------------------------------------------------------------------
 * 为什么放在服务端：解析结果不该依赖哪个浏览器页面开着、哪个 tab 被刷新。
 *   POST   /api/ref                     {name, dataURL|base64|path}  → 存进缓存
 *   GET    /api/ref                     列出所有参照图 + 摘要
 *   GET    /api/ref/:name               元数据 + 分析（尺寸/背景/视野切分/主色板）
 *   GET    /api/ref/:name/profile?x&y&w&h&cols&rows&th   区域轮廓（文本 + 每行左右界）
 *   DELETE /api/ref/:name | /api/ref    删除（单个 / 全部）
 * ★ 生命周期：落在 TemporaryCache/refs/ → 「清缓存」会一起清掉；
 *   Agent 交还时带 {cleanRefs:true} 也会清（见 /api/agent）。
 * ★ 纯 Node 实现：只有 zlib 是内置的，PNG 自己解（8bit 非隔行，色型 0/2/3/4/6）。
 * ========================================================================== */
const zlib = require('zlib');

function decodePNG(buf){
  if(buf.length < 8 || buf.readUInt32BE(0) !== 0x89504E47) return null;
  let pos = 8, W = 0, H = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = []; let plte = null, trns = null;
  while(pos + 8 <= buf.length){
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if(type === 'IHDR'){ W = data.readUInt32BE(0); H = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if(type === 'PLTE') plte = data;
    else if(type === 'tRNS') trns = data;
    else if(type === 'IDAT') idat.push(data);
    else if(type === 'IEND') break;
    pos += 12 + len;
  }
  if(!W || !H || bitDepth !== 8 || interlace !== 0 || !idat.length) return null;
  const chOf = { 0:1, 2:3, 3:1, 4:2, 6:4 }, ch = chOf[colorType];
  if(!ch || (colorType === 3 && !plte)) return null;
  let raw; try{ raw = zlib.inflateSync(Buffer.concat(idat)); }catch(e){ return null; }
  const stride = W * ch, out = Buffer.alloc(H * stride);
  let p = 0;
  for(let y = 0; y < H; y++){
    if(p >= raw.length) return null;
    const filter = raw[p++];
    const line = raw.slice(p, p + stride); p += stride;
    const cur = y * stride, prv = (y - 1) * stride;
    for(let x = 0; x < stride; x++){
      const a = x >= ch ? out[cur + x - ch] : 0;
      const b = y > 0 ? out[prv + x] : 0;
      const c = (y > 0 && x >= ch) ? out[prv + x - ch] : 0;
      let v = line[x];
      if(filter === 1) v = (v + a) & 255;
      else if(filter === 2) v = (v + b) & 255;
      else if(filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if(filter === 4){ const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v = (v + (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c))) & 255; }
      else if(filter !== 0) return null;
      out[cur + x] = v;
    }
  }
  const rgba = Buffer.alloc(W * H * 4);
  for(let i = 0, n = W * H; i < n; i++){
    let r, g, b, a = 255;
    if(colorType === 2){ r = out[i*3]; g = out[i*3+1]; b = out[i*3+2]; }
    else if(colorType === 6){ r = out[i*4]; g = out[i*4+1]; b = out[i*4+2]; a = out[i*4+3]; }
    else if(colorType === 0){ r = g = b = out[i]; }
    else if(colorType === 4){ r = g = b = out[i*2]; a = out[i*2+1]; }
    else { const k = out[i]; r = plte[k*3]; g = plte[k*3+1]; b = plte[k*3+2]; a = (trns && k < trns.length) ? trns[k] : 255; }
    rgba[i*4] = r; rgba[i*4+1] = g; rgba[i*4+2] = b; rgba[i*4+3] = a;
  }
  return { w: W, h: H, rgba };
}

/* 背景色 = 四条边采样里出现最多的颜色（量化到 8 级） */
function refBackground(img){
  const { w, h, rgba } = img, cnt = new Map();
  const push = (x, y) => { const i = (y*w + x)*4; const k = (rgba[i]>>3) + '_' + (rgba[i+1]>>3) + '_' + (rgba[i+2]>>3);
    const e = cnt.get(k) || { n:0, r:0, g:0, b:0 }; e.n++; e.r += rgba[i]; e.g += rgba[i+1]; e.b += rgba[i+2]; cnt.set(k, e); };
  const step = Math.max(1, Math.floor(Math.min(w, h) / 200));
  for(let x = 0; x < w; x += step){ push(x, 0); push(x, h-1); }
  for(let y = 0; y < h; y += step){ push(0, y); push(w-1, y); }
  let best = null; for(const e of cnt.values()) if(!best || e.n > best.n) best = e;
  return best ? [Math.round(best.r/best.n), Math.round(best.g/best.n), Math.round(best.b/best.n)] : [255,255,255];
}

const lum = (r,g,b) => 0.2126*r + 0.7152*g + 0.0722*b;
function refMask(img, opts){
  const o = Object.assign({ tol: 18, dark: 170 }, opts || {});
  const { w, h, rgba } = img, bg = refBackground(img);
  const fgBg = new Uint8Array(w*h), fgDark = new Uint8Array(w*h);
  for(let i = 0, n = w*h; i < n; i++){
    const r = rgba[i*4], g = rgba[i*4+1], b = rgba[i*4+2], a = rgba[i*4+3];
    const d = Math.sqrt((r-bg[0])**2 + (g-bg[1])**2 + (b-bg[2])**2);
    if(a > 16 && d > o.tol) fgBg[i] = 1;
    if(a > 16 && lum(r,g,b) < o.dark) fgDark[i] = 1;
  }
  return { bg, fgBg, fgDark, w, h };
}

function refAnalyze(img){
  const m = refMask(img), { w, h, fgBg, fgDark } = m;
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, n = 0, nd = 0;
  const colBg = new Uint8Array(w), colDark = new Uint8Array(w);
  const pal = new Map();
  for(let y = 0; y < h; y++) for(let x = 0; x < w; x++){
    const i = y*w + x;
    if(fgDark[i]){ nd++; colDark[x] = 1; }
    if(fgBg[i]){
      n++; colBg[x] = 1;
      if(x < minX) minX = x; if(x > maxX) maxX = x;
      if(y < minY) minY = y; if(y > maxY) maxY = y;
      const k = (img.rgba[i*4]>>4) + '_' + (img.rgba[i*4+1]>>4) + '_' + (img.rgba[i*4+2]>>4);
      pal.set(k, (pal.get(k) || 0) + 1);
    }
  }
  // 视野切分：在几个暗部阈值上扫，取第一个能分成 2~6 个视图的
  const spansOf = (colHas) => {
    const gapMin = Math.max(2, Math.round(w * 0.01));   // 视图之间的缝只有 ~1.7%（实测三视图拼版）
    const sp = []; let s = -1, gap = 0;
    for(let x = 0; x < w; x++){
      if(colHas[x]){ if(s < 0) s = x; gap = 0; }
      else if(s >= 0){ gap++; if(gap >= gapMin){ sp.push([s, x - gap]); s = -1; } }
    }
    if(s >= 0) sp.push([s, w - 1]);
    return sp;
  };
  let spans = null, usedTh = null;
  for(const th of [120, 110, 130, 140, 150, 165, 180]){
    const fg = refMask(img, { dark: th }).fgDark;
    const colCnt = new Int32Array(w); let cnt = 0;
    for(let y = 0; y < h; y++) for(let x = 0; x < w; x++) if(fg[y*w + x]){ colCnt[x]++; cnt++; }
    if(cnt < w*h*0.005) continue;
    // ★ 列占比要超过 1% 才算"这一列有东西"（否则一根淡线就把视图连起来了）
    const colHas = new Uint8Array(w);
    for(let x = 0; x < w; x++) colHas[x] = colCnt[x] > h*0.01 ? 1 : 0;
    const sp = spansOf(colHas);
    if(!spans){ spans = sp; usedTh = th; }
    if(sp.length >= 2 && sp.length <= 6){ spans = sp; usedTh = th; break; }
  }
  let viewDetection = spans ? ('dark:' + usedTh) : 'background';
  if(!spans){ spans = spansOf(colBg); }
  const palette = [...pal.entries()].sort((a,b) => b[1]-a[1]).slice(0, 10).map(([k,c]) => {
    const [R,G,B] = k.split('_').map(Number);
    const r = R*16 + 8, g = G*16 + 8, b = B*16 + 8;
    return { hex: '#' + [r,g,b].map(v => Math.min(255,v).toString(16).padStart(2,'0')).join(''), share: +(c/n).toFixed(4) };
  });
  return {
    width: w, height: h, background: m.bg,
    coverage: +(n/(w*h)).toFixed(4), coverageDark: +(nd/(w*h)).toFixed(4),
    bbox: minX > maxX ? null : { x: minX, y: minY, w: maxX-minX+1, h: maxY-minY+1, aspect: +((maxX-minX+1)/(maxY-minY+1)).toFixed(4) },
    viewDetection,
    detectedViews: spans.length,
    views: spans.map(([a,b], i) => ({ index:i, x0:a, x1:b, rect:{ x:+(a/w).toFixed(4), y:0, w:+((b-a+1)/w).toFixed(4), h:1 },
      label: '视图 ' + (i+1) + '（x ' + Math.round(a/w*100) + '%–' + Math.round(b/w*100) + '%，占宽 ' + Math.round((b-a+1)/w*100) + '%）' })),
    palette
  };
}

/* 区域轮廓：返回两套文本（按背景抠 / 按暗部抠）+ 每行左右边界（归一化到该区域） */
function refProfileOn(img, o){
  const { w, h, rgba } = img;
  const x0 = Math.round((o.x || 0) * w), y0 = Math.round((o.y || 0) * h);
  const cw = Math.max(1, Math.round((o.w ?? 1) * w)), chh = Math.max(1, Math.round((o.h ?? 1) * h));
  const m = refMask(img, o);
  const cols = o.cols || 80, rows = o.rows || 44;
  const build = (mask) => {
    const lines = [], edges = [];
    for(let r = 0; r < rows; r++){
      const ya = y0 + Math.floor(chh*r/rows), yb = Math.max(ya + 1, y0 + Math.floor(chh*(r+1)/rows));
      let s = '', lo = -1, hi = -1;
      for(let q = 0; q < cols; q++){
        const xa = x0 + Math.floor(cw*q/cols), xb = Math.max(xa + 1, x0 + Math.floor(cw*(q+1)/cols));
        let nn = 0, hit = 0;
        for(let y = ya; y < yb; y++) for(let x = xa; x < xb; x++){ if(x < 0 || y < 0 || x >= w || y >= h) continue; nn++; if(mask[y*w + x]) hit++; }
        const on = nn && hit/nn > 0.5;
        s += on ? '#' : '.';
        if(on){ if(lo < 0) lo = q; hi = q; }
      }
      lines.push(s);
      edges.push(lo < 0 ? null : { row:r, L:+(lo/cols).toFixed(3), R:+((hi+1)/cols).toFixed(3) });
    }
    return { text: lines.join('\n'), edges };
  };
  const A = build(m.fgBg), B = build(m.fgDark);
  return { ok:true, region:{ x:o.x||0, y:o.y||0, w:o.w??1, h:o.h??1, px:{ x0, y0, w:cw, h:chh } },
    cols, rows, background: m.bg, text: A.text, edges: A.edges, textDark: B.text, edgesDark: B.edges };
}

const _refCache = new Map();
function loadRefImage(name){
  const p = path.join(DIR.refs, name + '.png');
  if(!fs.existsSync(p)) return null;
  const st = fs.statSync(p);
  const hit = _refCache.get(name);
  if(hit && hit.mtime === st.mtimeMs) return hit.img;
  const img = decodePNG(fs.readFileSync(p));
  if(!img) return null;
  _refCache.set(name, { mtime: st.mtimeMs, img });
  return img;
}
function listRefs(){
  return fs.readdirSync(DIR.refs).filter(f => f.endsWith('.png')).map(f => {
    const name = f.replace(/\.png$/, ''); const st = fs.statSync(path.join(DIR.refs, f));
    const img = loadRefImage(name);
    return { name, bytes: st.size, mtime: st.mtimeMs, width: img ? img.w : null, height: img ? img.h : null,
      url: '/TemporaryCache/refs/' + f };
  }).sort((a, b) => b.mtime - a.mtime);
}

/* 本项目是**开源学习项目**，服务端**不做鉴权**（谁都能读 / 写模型）。
   只留一个网络开关：环境变量 `HOST`（默认 `0.0.0.0` = 所有网卡；设成 `127.0.0.1` 就只给本机 / 反向代理访问）。 */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);

  if(req.method === 'OPTIONS') return send(res, 204, '');

  /* ---- API ---- */
  if(p.startsWith('/api/')){
    try{
      const seg = p.slice(5).split('/').filter(Boolean);      // /api/a/b → ['a','b']
      // ★ 必须**无条件读干**请求体：否则残留数据会污染 keep-alive 连接（表现为随机 502）
      const raw = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) ? await readBody(req) : '';
      let body = null;
      if(raw){ try{ body = JSON.parse(raw); }catch(e){ body = null; } }

      if(seg[0] === 'store' && req.method === 'GET'){
        return ok(res, { ok:true,
          dirs: { confirmed: DIR.confirmed, temporary: DIR.temporary, cache: DIR.cache },
          confirmed: listModels(DIR.confirmed), temporary: listModels(DIR.temporary),
          cache: { ...dirSize(DIR.cache), files: fs.existsSync(DIR.cache)
            ? fs.readdirSync(DIR.cache).filter(f => f !== 'README.md').map(f => ({ name:f, bytes:fs.statSync(path.join(DIR.cache, f)).size })) : [] },
          // ★ 必须用 agentView()：stale / occupying / note2 是它算出来的。
          //   以前这里是 readAgent()（原始记录没这几个字段）→ 首页说「还没有 Agent 接管」，
          //   导航条和「AI 工作流」页却说「已退出」——同一个状态两种说法。
          agent: agentView() });
      }

      if(seg[0] === 'characters'){
        if(req.method === 'GET') return ok(res, { ok:true, ...characterIndex() });
        /* 浏览器用 EditorAPI.exportCharacterIndex() 把最权威的清单写回来 */
        if(req.method === 'POST'){
          if(!body || !body.low) return bad(res, '需要 { low:[...], high:[...] }');
          fs.mkdirSync(path.join(root, 'data'), { recursive: true });
          const rec = { ...body, generatedAt: Date.now() };
          fs.writeFileSync(path.join(root, 'data', 'characters.json'), JSON.stringify(rec, null, 2), 'utf8');
          return ok(res, { ok:true, wrote:'data/characters.json', low:(body.low||[]).length, high:(body.high||[]).length });
        }
      }

      /* ★★★ AI 的入口：一个 GET 就知道「这里有什么、从哪拿」 */
      if(seg[0] === 'index' && req.method === 'GET'){
        const dirDocs = path.join(root, 'docs');
        const readme = fs.existsSync(path.join(dirDocs, 'README.md'))
          ? fs.readFileSync(path.join(dirDocs, 'README.md'), 'utf8') : '';
        const titles = {};
        for(const line of readme.split('\n')){
          const s = line.trim();
          /* 支持两种写法：项目符号 `- [标题](文件) — 说明` 和表格 `| [标题](文件) | ... | 说明 |` */
          const m = /^-\s*\[([^\]]+)\]\(([^)]+)\)\s*(?:—|-|——)?\s*(.*)$/.exec(s)
                 || /^\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*[^|]*\|\s*([^|]*)\|/.exec(s);
          if(m) titles[m[2].replace(/^\.\//, '')] = (m[3] || '').trim();
        }
        const docFiles = fs.existsSync(dirDocs)
          ? fs.readdirSync(dirDocs).filter(f => f.endsWith('.md')).map(f => ({
              name:f, url:'/docs/' + f, bytes:fs.statSync(path.join(dirDocs, f)).size, desc:titles[f] || '' }))
          : [];
        const modelsDir = path.join(root, 'models');
        const chars = characterIndex();
        return ok(res, {
          ok:true, name:'低模工坊 · 本地工具集', root,
          hint:'这是给 AI Agent 的入口。先 GET /docs/README.md 了解全貌；要干活就 GET /api/index（本接口）→ 按 pipeline 走。',
          docs:{ index:'/docs/README.md', files:docFiles,
            raw:'所有 .md 都是**原始 Markdown**，直接 GET 就是纯文本，没有任何 HTML 包装。' },
          data:{ referenceModels:'/data/reference-models.json',
            characters:'/data/characters.json（可能不存在，用 /api/characters 取）',
            files: fs.existsSync(path.join(root, 'data'))
              ? fs.readdirSync(path.join(root, 'data')).map(f => ({ name:f, url:'/data/' + f, bytes:fs.statSync(path.join(root, 'data', f)).size })) : [] },
          characters:{ low:chars.low.length, high:chars.high.length, url:'/api/characters', source:chars.source },
          baked:{ dir:'models/', files: fs.existsSync(modelsDir)
              ? fs.readdirSync(modelsDir).map(f => ({ name:f, url:'/models/' + f, bytes:fs.statSync(path.join(modelsDir, f)).size })) : [],
            note:'高模是烘焙好的 THREE.Object3D.toJSON()，直接用 ObjectLoader.parse 读。' },
          stored:{ dirs:DIR, confirmed:listModels(DIR.confirmed).length, temporary:listModels(DIR.temporary).length,
            list:'/api/models', one:'/api/models/:id', bundle:'/api/models/:id/bundle',
            files:'/api/models/:id/files', file:'/api/models/:id/file/:name' },
          sources:{ lowPoly:'/src/characters.orig.js（XT(id) 程序化生成）', face:'/src/characters.face.js',
            highPoly:'/src/characters.hires2.js（$O(id,variant) / buildHires）', editor:'/pages/character-editor.html',
            worker:'/tools/_serve.js / /src/characters.store.js / /src/pipeline.js / /src/quality-gates.js',
            shell:'/styles/shell.css / /src/shell.js', readout:'/src/model-readout.js（AI 读数通道）' },
          endpoints:[
            ['GET',    '/api/index',                  '本接口：AI 入口总览'],
            ['GET',    '/api/characters',             '原作角色索引（低模 14 + 高模变体）'],
            ['POST',   '/api/characters',             '浏览器把权威角色清单写回 data/characters.json'],
            ['GET',    '/api/store',                  '存储总览（模型目录 + 缓存 + agent）'],
            ['GET',    '/api/models',                 '模型列表'],
            ['GET',    '/api/models/:id',             '取模型（含 spec + js）'],
            ['GET',    '/api/models/:id/bundle',      '★ 一次拿全：meta + spec + js + 文件清单 + 直链'],
            ['GET',    '/api/models/:id/files',       '模型目录里的文件清单'],
            ['GET',    '/api/models/:id/file/:name',  '★ 取原始文件（?download=1 带 attachment）'],
            ['POST',   '/api/models',                 '保存 {id,name,spec,js,thumb,note,dir}'],
            ['POST',   '/api/models/:id/confirm',     '临时 → 正式'],
            ['POST',   '/api/models/:id/unconfirm',   '正式 → 临时'],
            ['DELETE', '/api/models/:id',             '删除'],
            ['GET',    '/api/cache',                  '缓存列表'],
            ['POST',   '/api/cache',                  '写缓存 {name,data,ext,thumb}'],
            ['DELETE', '/api/cache',                  '清空缓存（保留 agent.json）'],
            ['GET',    '/api/agent',                  '谁在接管'],
            ['POST',   '/api/agent',                  '登记/交还 {agent,note,ttlMinutes,cleanRefs}'],
            ['POST',   '/api/agent/ping',             '续约'],
            ['GET',    '/api/ref',                    '★ 参照图列表（服务端资产，缓存在 TemporaryCache/refs）'],
            ['POST',   '/api/ref',                    '★ 上传参照图 {name, dataURL|base64|path}'],
            ['GET',    '/api/ref/:name',              '★ 参照图元数据 + 分析（尺寸/背景/视野切分/主色板）'],
            ['GET',    '/api/ref/:name/profile',      '★ 区域轮廓 ?x&y&w&h&cols&rows&tol&dark（文本 + 每行左右界）'],
            ['DELETE', '/api/ref/:name',              '删除一张参照图（/api/ref 为全清）'] ],
          browserOnly:[
            'POST /api/models/:id/file/:name 不存在 —— 写回请用 POST /api/models（带 spec/js）。',
            '编辑器**没保存**的当前状态拿不到 HTTP 接口，要在页面里调 EditorAPI.modelFile()（形状和 /bundle 一样）。' ],
          agent: agentView() });
      }

      /* ★ /api/models · /api/weapons · /api/original-weapons 共用同一套读写逻辑 */
      if(seg[0] === 'models' || seg[0] === 'weapons' || seg[0] === 'original-weapons'){
        const k = seg[0] === 'original-weapons' ? 'original' : (seg[0] === 'weapons' ? 'weapon' : 'model');
        const D = KINDS[k].dirs;
        const J = KINDS[k].json;
        const what = k === 'weapon' ? '武器' : (k === 'original' ? '原版武器' : '模型');

        if(req.method === 'GET' && seg.length === 1)
          return ok(res, { ok:true, kind:k, confirmed: listModels(D.confirmed, k), temporary: listModels(D.temporary, k) });

        if(req.method === 'GET' && seg.length === 2){
          const f = findModel(safeId(seg[1]), k); if(!f) return die(res, '没有这个'+what+': ' + seg[1]);
          const rec = JSON.parse(fs.readFileSync(path.join(f.dir, J), 'utf8'));
          const jsf = path.join(f.dir, KINDS[k].js);
          return ok(res, { ok:true, ...rec, js: fs.existsSync(jsf) ? fs.readFileSync(jsf, 'utf8') : null,
            where: f.key, path: f.dir });
        }

        if(req.method === 'GET' && seg.length === 3 && (seg[2] === 'bundle' || seg[2] === 'files')){
          const id = safeId(seg[1]); const f = findModel(id, k);
          if(!f) return die(res, '没有这个'+what+': ' + id);
          if(seg[2] === 'files'){ const lf = listModelFiles(f, id, k); return ok(res, { ok:true, id, kind:k, ...lf }); }
          return ok(res, modelBundle(f, id, k));
        }

        /* ★ 取目录里的原始文件（model.json / model.js / thumb.png / 任何落盘的东西）
         *   ?download=1 会带上 Content-Disposition，方便 AI 直接存成文件 */
        if(req.method === 'GET' && seg.length === 4 && seg[2] === 'file'){
          const id = safeId(seg[1]); const f = findModel(id, k);
          if(!f) return die(res, '没有这个'+what+': ' + id);
          const name = safeId(seg[3]);                       // safeId 会去掉 / 和 \，天然防穿越
          const fp = path.join(f.dir, name);
          if(!fp.startsWith(f.dir) || !fs.existsSync(fp) || !fs.statSync(fp).isFile())
            return die(res, what+'目录里没有这个文件: ' + name);
          const buf = fs.readFileSync(fp);
          const hd = { 'Content-Type': MIME[path.extname(name).toLowerCase()] || 'application/octet-stream',
            'Access-Control-Allow-Origin':'*', 'Cache-Control':'no-cache', 'Content-Length':buf.length };
          if(url.searchParams.get('download')) hd['Content-Disposition'] = 'attachment; filename="' + id + '-' + name + '"';
          res.writeHead(200, hd);
          return res.end(buf);
        }

        if(req.method === 'POST' && seg.length === 1){
          const id = safeId(body.id || body.name);
          if(!id) return bad(res, '需要 id 或 name');
          const to = body.dir === 'confirmed' ? D.confirmed : D.temporary;
          writeModel(to, id, body, k);
          // ★ 正式区写完后清掉临时区的同名副本 —— 但原版武器库两个键指向同一个目录，别把自己删了
          if(body.dir === 'confirmed' && D.temporary !== D.confirmed) rmrf(path.join(D.temporary, id));
          return ok(res, { ok:true, kind:k, id, where: body.dir === 'confirmed' ? 'confirmed' : 'temporary', model: modelMeta(to, id, k) });
        }

        if(req.method === 'POST' && seg.length === 3 && (seg[2] === 'confirm' || seg[2] === 'unconfirm')){
          const id = safeId(seg[1]);
          const from = seg[2] === 'confirm' ? D.temporary : D.confirmed;
          const to   = seg[2] === 'confirm' ? D.confirmed : D.temporary;
          if(!fs.existsSync(path.join(from, id, J))) return die(res, '不在' + (seg[2] === 'confirm' ? '临时' : '正式') + '目录里: ' + id);
          rmrf(path.join(to, id));
          fs.mkdirSync(path.dirname(path.join(to, id)), { recursive: true });
          fs.renameSync(path.join(from, id), path.join(to, id));
          return ok(res, { ok:true, kind:k, id, where: seg[2] === 'confirm' ? 'confirmed' : 'temporary', model: modelMeta(to, id, k) });
        }

        if(req.method === 'DELETE' && seg.length === 2){
          const id = safeId(seg[1]); const f = findModel(id, k);
          if(!f) return die(res, '没有这个'+what+': ' + id);
          rmrf(f.dir);
          return ok(res, { ok:true, kind:k, id, removedFrom:f.key });
        }
      }

      if(seg[0] === 'cache'){
        if(req.method === 'GET')
          return ok(res, { ok:true, ...dirSize(DIR.cache),
            files: fs.readdirSync(DIR.cache).filter(f => f !== 'README.md')
              .map(f => { const s = fs.statSync(path.join(DIR.cache, f));
                return { name:f, bytes:s.size, mtime:s.mtimeMs }; }).sort((a, b) => b.mtime - a.mtime) });

        if(req.method === 'POST'){
          const j = body || {};
          const name = safeId(j.name || ('cache-' + Date.now())) + (j.ext || '.json');
          let out = j.data;
          if(typeof j.data === 'object') out = JSON.stringify(j.data, null, 2);
          if(j.thumb && /^data:image\/png;base64,/.test(j.thumb))
            fs.writeFileSync(path.join(DIR.cache, name.replace(/\.json$/, '') + '.png'), Buffer.from(j.thumb.split('base64,')[1], 'base64'));
          fs.writeFileSync(path.join(DIR.cache, name), String(out), 'utf8');
          return ok(res, { ok:true, name, bytes: Buffer.byteLength(String(out)) });
        }

        if(req.method === 'DELETE'){
          let n = 0;
          // ★ 保留 README.md 和 agent.json（清缓存不该把「谁在接管」也清了）
          for(const f of fs.readdirSync(DIR.cache)) if(f !== 'README.md' && f !== 'agent.json'){
            try{ fs.rmSync(path.join(DIR.cache, f), { recursive:true, force:true }); n++; }catch(e){}
          }
          _refCache.clear();                    // 参照图也在缓存里，一并失效
          fs.mkdirSync(DIR.refs, { recursive: true });
          return ok(res, { ok:true, removed:n });
        }
      }

      /* ── 参照图服务 ─────────────────────────────────────────────── */
      if(seg[0] === 'ref'){
        if(req.method === 'GET' && seg.length === 1){
          const refs = listRefs();
          return ok(res, { ok:true, dir:'TemporaryCache/refs', count: refs.length, refs,
            howto:'POST /api/ref {name, dataURL|base64|path} 上传；GET /api/ref/:name 看分析；'
                + 'GET /api/ref/:name/profile?x&y&w&h&cols&rows 拿区域轮廓；DELETE /api/ref 全清。'
                + '落在 TemporaryCache/refs → 清缓存即清；Agent 交还带 {cleanRefs:true} 也清。' });
        }

        /* 收件箱：refs/inbox 里有什么（用户把参照图存这儿，AI 不用猜文件名） */
        if(req.method === 'GET' && seg[1] === 'inbox'){
          const dir = path.join(root, 'refs', 'inbox');
          const files = fs.existsSync(dir) ? fs.readdirSync(dir)
            .filter(f => /\.(png|jpe?g|webp)$/i.test(f))
            .map(f => { const s = fs.statSync(path.join(dir, f));
              return { file:f, name:safeId(f.replace(/\.[^.]+$/, '')), bytes:s.size, mtime:s.mtimeMs,
                       png: /\.png$/i.test(f), path:'refs/inbox/' + f }; })
            .sort((a, b) => b.mtime - a.mtime) : [];
          return ok(res, { ok:true, dir:'refs/inbox', count:files.length, files,
            howto:'把参照图存进 refs/inbox/ 然后 POST /api/ref {path:"refs/inbox/文件名"}；'
                + '只支持 8bit 非隔行 PNG（服务端纯 Node 自解，jpg/webp 请先转 PNG）' });
        }

        if(req.method === 'POST' && seg.length === 1){
          const j = body || {};
          let buf = null, from = null, derived = null;
          if(typeof j.dataURL === 'string' && /^data:image\/png;base64,/.test(j.dataURL)){
            buf = Buffer.from(j.dataURL.split('base64,')[1], 'base64'); from = 'dataURL';
          } else if(typeof j.base64 === 'string'){
            buf = Buffer.from(j.base64.replace(/^data:image\/\w+;base64,/, ''), 'base64'); from = 'base64';
          } else if(typeof j.path === 'string'){
            const rel = decodeURIComponent(j.path).replace(/^[/\\]+/, '');
            const p = path.join(root, rel);
            if(!p.startsWith(root) || !fs.existsSync(p)) return bad(res, '服务端找不到这个文件: ' + j.path);
            buf = fs.readFileSync(p); from = 'path:' + rel;
            derived = path.basename(rel).replace(/\.[^.]+$/, '');   // ★ 没给 name 就用文件名
          }
          if(!buf) return bad(res, '需要 dataURL / base64 / path 之一');
          const name = safeId(j.name || derived || ('ref-' + Date.now()));
          if(!name) return bad(res, '需要 name（或 path 的文件名可用）');
          const img = decodePNG(buf);
          fs.writeFileSync(path.join(DIR.refs, name + '.png'), buf);
          fs.writeFileSync(path.join(DIR.refs, name + '.meta.json'),
            JSON.stringify({ name, bytes: buf.length, from, savedAt: Date.now(), kind: j.kind || 'reference', note: j.note || '' }, null, 2));
          _refCache.delete(name);
          const out = { ok:true, name, from, bytes: buf.length, decodable: !!img, url:'/TemporaryCache/refs/' + name + '.png' };
          if(img) out.analysis = refAnalyze(img);
          else out.warn = 'PNG 解不开（只支持 8bit 非隔行 PNG）→ 文件已存，分析和轮廓不可用';
          return ok(res, out);
        }

        if(req.method === 'GET' && seg.length === 2){
          const name = safeId(seg[1]);
          const img = loadRefImage(name);
          if(!img) return die(res, '没有这张参照图（或 PNG 解不开）: ' + name);
          const mp = path.join(DIR.refs, name + '.meta.json');
          return ok(res, { ok:true, name, meta: fs.existsSync(mp) ? JSON.parse(fs.readFileSync(mp, 'utf8')) : null,
                           analysis: refAnalyze(img) });
        }

        if(req.method === 'GET' && seg.length === 3 && seg[2] === 'profile'){
          const name = safeId(seg[1]);
          const img = loadRefImage(name);
          if(!img) return die(res, '没有这张参照图（或 PNG 解不开）: ' + name);
          const q = url.searchParams, num = (k, d) => q.has(k) ? Number(q.get(k)) : d;
          return ok(res, refProfileOn(img, {
            x:num('x',0), y:num('y',0), w:num('w',1), h:num('h',1),
            cols:Math.max(4, Math.min(240, num('cols',80))), rows:Math.max(4, Math.min(240, num('rows',44))),
            tol:num('tol',18), dark:num('dark',170) }));
        }

        if(req.method === 'GET' && seg.length === 3 && seg[2] === 'mask'){
          const name = safeId(seg[1]);
          const img = loadRefImage(name);
          if(!img) return die(res, '没有这张参照图（或 PNG 解不开）: ' + name);
          const q = url.searchParams;
          const cols = Math.max(4, Math.min(300, Number(q.get('cols') || 64)));
          const rows = Math.max(4, Math.min(300, Number(q.get('rows') || 64)));
          const mode = q.get('mode') === 'dark' ? 'dark' : 'bg';
          const m = refMask(img, { tol: Number(q.get('tol') || 18), dark: Number(q.get('dark') || 150) });
          const mask = mode === 'dark' ? m.fgDark : m.fgBg;
          const { w, h } = img;
          let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
          for(let y = 0; y < h; y++) for(let x = 0; x < w; x++) if(mask[y*w+x]){
            if(x < minX) minX = x; if(x > maxX) maxX = x; if(y < minY) minY = y; if(y > maxY) maxY = y; }
          if(minX > maxX) return ok(res, { ok:true, name, cols, rows, mode, empty:true, lines:[] });
          const bw = maxX-minX+1, bh = maxY-minY+1, lines = [];
          for(let r = 0; r < rows; r++){
            const ya = minY + Math.floor(bh*r/rows), yb = Math.max(ya+1, minY + Math.floor(bh*(r+1)/rows));
            let s = '';
            for(let c = 0; c < cols; c++){
              const xa = minX + Math.floor(bw*c/cols), xb = Math.max(xa+1, minX + Math.floor(bw*(c+1)/cols));
              let nn = 0, hit = 0;
              for(let y = ya; y < yb; y++) for(let x = xa; x < xb; x++){ nn++; if(mask[y*w+x]) hit++; }
              s += (nn && hit/nn > 0.5) ? '1' : '0';
            }
            lines.push(s);
          }
          return ok(res, { ok:true, name, cols, rows, mode, empty:false,
            bbox:{ x:minX, y:minY, w:bw, h:bh, aspect:+(bw/bh).toFixed(4) }, lines });
        }

        if(req.method === 'DELETE'){
          if(seg.length === 2){
            const n = safeId(seg[1]);
            for(const ext of ['.png', '.meta.json']){ const p = path.join(DIR.refs, n + ext); if(fs.existsSync(p)) fs.rmSync(p, { force:true }); }
            _refCache.delete(n);
            return ok(res, { ok:true, removed:n });
          }
          let n = 0;
          for(const f of fs.readdirSync(DIR.refs)){ try{ fs.rmSync(path.join(DIR.refs, f), { force:true }); n++; }catch(e){} }
          _refCache.clear();
          return ok(res, { ok:true, removed:n });
        }
      }

      if(seg[0] === 'agent'){
        if(req.method === 'GET') return ok(res, { ok:true, ...agentView() });
        if(seg[1] === 'ping' && req.method === 'POST'){
          const a = readAgent();
          if(!a.agent) return bad(res, '当前没有 Agent 接管，不用 ping');
          a.heartbeat = Date.now();
          writeAgent(a);
          return ok(res, { ok:true, ...agentView(a) });
        }
        if(req.method === 'POST'){
          const j = body || {};
          const name = j.agent === null || j.agent === undefined || j.agent === '' ? null : String(j.agent).slice(0,80);
          const prev = readAgent();
          if(!name){
            // ★ 交还：清空接管者，但把「谁交还的、什么时候」记下来
            const rec = { agent:null, note: String(j.note || '').slice(0,400),
              since:null, heartbeat:null, ttlMinutes: prev.ttlMinutes || 30,
              releasedAt: Date.now(), releasedBy: prev.agent || null,
              history: [{ agent:prev.agent, note:prev.note, since:prev.since, releasedAt:Date.now() }].concat(prev.history||[]).slice(0,3) };
            writeAgent(rec);
            // ★ 交还时清掉这一轮的参照图（临时资产，不该留在盘上）
            let cleaned = 0;
            if(j.cleanRefs){
              for(const f of fs.readdirSync(DIR.refs)){ try{ fs.rmSync(path.join(DIR.refs, f), { force:true }); cleaned++; }catch(e){} }
              _refCache.clear();
            }
            return ok(res, { ok:true, released:true, releasedBy:rec.releasedBy, refsRemoved:cleaned, ...agentView(rec) });
          }
          const ttl = Number(j.ttlMinutes) > 0 ? Math.min(24*60, Number(j.ttlMinutes)) : 30;
          const rec = { agent:name, note: String(j.note || '').slice(0,400),
            since: Date.now(), heartbeat: Date.now(), ttlMinutes: ttl,
            history: (prev.agent ? [{ agent:prev.agent, note:prev.note, since:prev.since, releasedAt:Date.now() }] : [])
                     .concat(prev.history||[]).slice(0,3) };
          writeAgent(rec);
          return ok(res, { ok:true, ...agentView(rec) });
        }
      }
      return die(res, '未知 API: ' + p);
    }catch(e){ return send(res, 500, JSON.stringify({ ok:false, error:String(e && e.message || e) })); }
  }

  /* ---- 静态 ----
   * ★ 目录归类（2026-09）：页面在 pages/、共享 JS 在 src/、CSS 在 styles/、工具在 tools/。
   *   旧的根路径（/character-editor.html 等）用 LEGACY 表 302 过去，书签和外部链接不会断。 */
  const LEGACY = {
    '/index.html':'/pages/index.html', '/character-editor.html':'/pages/character-editor.html',
    '/character-lab.html':'/pages/character-lab.html', '/weapon-editor.html':'/pages/weapon-editor.html',
    '/model-import.html':'/pages/model-import.html', '/ai-workflow.html':'/pages/ai-workflow.html',
    '/system.html':'/pages/system.html', '/docs.html':'/pages/docs.html',
    '/shell.css':'/styles/shell.css', '/model-import.css':'/styles/model-import.css',
    '/shell.js':'/src/shell.js', '/model-readout.js':'/src/model-readout.js',
    '/docs-viewer.js':'/src/docs-viewer.js', '/pipeline.js':'/src/pipeline.js',
    '/quality-gates.js':'/src/quality-gates.js', '/vox-import.js':'/src/vox-import.js',
    '/characters.orig.js':'/src/characters.orig.js', '/characters.face.js':'/src/characters.face.js',
    '/characters.hires2.js':'/src/characters.hires2.js', '/characters.store.js':'/src/characters.store.js',
    '/_serve.js':'/tools/_serve.js', '/selfcheck.js':'/tools/selfcheck.js',
  };
  let rel = p === '/' ? '/pages/index.html' : (LEGACY[p] || p);
  if(/^\/pages\/$/.test(rel)) rel = '/pages/index.html';
  if(rel !== p){
    res.writeHead(302, { 'Location': rel, 'Cache-Control':'no-cache' });
    return res.end();
  }
  const file = path.join(root, path.normalize(rel).replace(/^([/\\])+/, ''));
  if(!file.startsWith(root)) return die(res, 'forbidden');
  fs.readFile(file, (e, d) => {
    if(e) return send(res, 404, '404 ' + rel, 'text/plain; charset=utf-8');
    send(res, 200, d, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
});

function readAgent(){
  try{
    const j = JSON.parse(fs.readFileSync(path.join(DIR.cache, 'agent.json'), 'utf8'));
    return { agent:null, note:'', since:null, heartbeat:null, ttlMinutes:30, releasedAt:null, releasedBy:null, history:[], ...j };
  }catch(e){ return { agent:null, note:'', since:null, heartbeat:null, ttlMinutes:30, releasedAt:null, releasedBy:null, history:[] }; }
}
function writeAgent(rec){
  fs.writeFileSync(path.join(DIR.cache, 'agent.json'), JSON.stringify(rec, null, 2), 'utf8');
}
/** 给前端看的状态：把「租约过期」算出来。
 *  Agent 干活时要定期 ping；超过 ttlMinutes 没动静就当作**已经退出**（不再占用接管位） */
function agentView(a){
  a = a || readAgent();
  const beat = a.heartbeat || a.since || 0;
  const age = beat ? Math.round((Date.now() - beat) / 60000) : null;
  const stale = !!(a.agent && age !== null && age >= (a.ttlMinutes || 30));
  return { agent: a.agent, note: a.note, since: a.since, heartbeat: a.heartbeat,
    ttlMinutes: a.ttlMinutes || 30, ageMinutes: age, stale,
    occupying: !!(a.agent && !stale),
    releasedAt: a.releasedAt || null, releasedBy: a.releasedBy || null,
    history: a.history || [],
    note2: stale ? ('这个 Agent 超过 ' + (a.ttlMinutes||30) + ' 分钟没动静，已按「退出」处理（接管位空出来了）') : '' };
}

const PORT = Number(process.env.PORT || 8765);
const HOST = process.env.HOST || '0.0.0.0';   // 默认所有网卡（原行为）；想只给本机/反代就设 HOST=127.0.0.1
server.listen(PORT, HOST, () => {
  console.log('低模工坊 · serving on http://' + HOST + ':' + PORT);
  console.log('  （开源项目 · 无鉴权：/api/* 可读可写）');
  console.log('  正式模型  ' + DIR.confirmed);
  console.log('  临时模型  ' + DIR.temporary);
  console.log('  临时缓存  ' + DIR.cache);
});
