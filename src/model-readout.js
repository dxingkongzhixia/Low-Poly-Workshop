/* ============================================================================
 * model-readout.js —— 让 AI「直接读到」模型长什么样（而不是靠猜像素）
 * ----------------------------------------------------------------------------
 * 背景：AI 只靠 render() 出的图判断结构，误差很大（全身远景里一个小部件只有
 *       十几像素）。这个文件给编辑器加一条**文本读取通道**：
 *
 *   ModelReadout.dump()     → 结构化数据：每个部件的世界 AABB
 *                             + 每个 box/panel/geo 图元的世界中心/尺寸/旋转/颜色
 *   ModelReadout.ascii()    → 文本剪影（正面/侧面/顶面），可叠加参考图，
 *                             字符直接告诉你：重合 / 只有模型 / 只有参考
 *   ModelReadout.save()     → 把上面两份落到 TemporaryCache/，纯 HTTP 的 Agent 也能取
 *   ModelReadout.help()     → 用法
 *
 * 不依赖任何构建、不碰编辑器内部状态 —— 只调 window.EditorAPI 的公开命令。
 * 用法：编辑器页面里（或 browser.evaluate 里）直接 `await ModelReadout.ascii()`。
 *
 * 配套读：仓库根目录 `低模工坊-制作流程笔记.md`（建模顺序规程 + 一堆踩过的坑），
 *         以及 `docs/ai-pipeline.md` §〇·B。
 * ========================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- 4x4 数学 */
  // 16 个数，行主序：m[r*4+c]
  const I = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

  function mul(a, b) {
    const o = new Array(16);
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++)
        o[r*4+c] = a[r*4]*b[c] + a[r*4+1]*b[4+c] + a[r*4+2]*b[8+c] + a[r*4+3]*b[12+c];
    return o;
  }
  function trs(p, r, s) {
    const [rx, ry, rz] = r, [kx, ky, kz] = s;      // k* = 缩放
    const cx = Math.cos(rx), sx = Math.sin(rx);    // s* = 正弦
    const cy = Math.cos(ry), sy = Math.sin(ry);
    const cz = Math.cos(rz), sz = Math.sin(rz);
    // R = Rx * Ry * Rz （与 three.js 默认 Euler order 'XYZ' 一致）
    const m00 = cy*cz,              m01 = -cy*sz,             m02 = sy;
    const m10 = sx*sy*cz + cx*sz,   m11 = -sx*sy*sz + cx*cz,  m12 = -sx*cy;
    const m20 = -cx*sy*cz + sx*sz,  m21 = cx*sy*sz + sx*cz,   m22 = cx*cy;
    return [
      m00*kx, m01*ky, m02*kz, p[0],
      m10*kx, m11*ky, m12*kz, p[1],
      m20*kx, m21*ky, m22*kz, p[2],
      0,0,0,1
    ];
  }
  function apply(m, v) {
    return [
      m[0]*v[0] + m[1]*v[1] + m[2]*v[2] + m[3],
      m[4]*v[0] + m[5]*v[1] + m[6]*v[2] + m[7],
      m[8]*v[0] + m[9]*v[1] + m[10]*v[2] + m[11]
    ];
  }
  const r3 = a => a.map(v => +v.toFixed(4));
  const aabbOf = pts => {
    const mn = [Infinity,Infinity,Infinity], mx = [-Infinity,-Infinity,-Infinity];
    for (const p of pts) for (let i = 0; i < 3; i++) { if (p[i] < mn[i]) mn[i] = p[i]; if (p[i] > mx[i]) mx[i] = p[i]; }
    return { min: r3(mn), max: r3(mx), size: r3([mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]]) };
  };
  const unionA = (a, b) => !a ? b : {
    min: [Math.min(a.min[0],b.min[0]), Math.min(a.min[1],b.min[1]), Math.min(a.min[2],b.min[2])],
    max: [Math.max(a.max[0],b.max[0]), Math.max(a.max[1],b.max[1]), Math.max(a.max[2],b.max[2])]
  };

  /* ------------------------------------------------- 骨架：组的世界矩阵
   * 实测：除 root 外所有组都挂在 body 下（head/armL/armR/legL/legR/coatTails/tail）
   * world = M(root) · M(body) · M(group)
   */
  function groupMatrices(spec) {
    const g = (spec && spec.rig && spec.rig.groups) || {};
    const read = k => (g[k] ? { p: g[k].p || [0,0,0], r: g[k].r || [0,0,0], s: g[k].s || [1,1,1] } : null);
    const root = read('root') || { p:[0,0,0], r:[0,0,0], s:[1,1,1] };
    const body = read('body') || { p:[0,0,0], r:[0,0,0], s:[1,1,1] };
    const Mroot = trs(root.p, root.r, root.s);
    const Mbody = mul(Mroot, trs(body.p, body.r, body.s));
    const out = { root: Mroot, body: Mbody };
    for (const k of ['head','armL','armR','legL','legR','coatTails','tail']) {
      const gg = read(k);
      out[k] = gg ? mul(Mbody, trs(gg.p, gg.r, gg.s)) : Mbody;
    }
    return out;
  }

  /* ------------------------------------------------- 图元 → 世界 AABB（解析） */
  function primWorldAABB(prim, parentM) {
    const k = prim.kind;
    if (k === 'box') {
      const c = [prim.x||0, prim.y||0, prim.z||0];
      const hw = (prim.w||0)/2, hh = (prim.h||0)/2, hd = (prim.d||0)/2;
      const R = trs([0,0,0], [prim.rotX||0, prim.rotY||0, prim.rotZ||0], [1,1,1]);
      const pts = [];
      for (const sx of [-1,1]) for (const sy of [-1,1]) for (const sz of [-1,1]) {
        const local = apply(R, [sx*hw, sy*hh, sz*hd]);
        pts.push(apply(parentM, [c[0]+local[0], c[1]+local[1], c[2]+local[2]]));
      }
      return aabbOf(pts);
    }
    if (k === 'panel' || (k === 'geo' && prim.shape === 'extrude')) {
      const isPanel = (k === 'panel');
      const pp = isPanel ? prim.points : (prim.params && prim.params.points);
      const depth = isPanel ? (prim.depth ?? 0.05) : ((prim.params && prim.params.depth) ?? 0.05);
      if (!pp || !pp.length) return null;
      // panel：points 是父级局部**绝对** XY，z 是挤出**中心** → z ± depth/2
      // geo extrude：points 相对 x/y，z 是挤出**起点** → z … z+depth
      const ox = isPanel ? 0 : (prim.x || 0);
      const oy = isPanel ? 0 : (prim.y || 0);
      const zs = isPanel ? [(prim.z || 0) - depth / 2, (prim.z || 0) + depth / 2]
                         : [(prim.z || 0), (prim.z || 0) + depth];
      const R = trs([0, 0, 0], [prim.rotX || 0, prim.rotY || 0, prim.rotZ || 0], [1, 1, 1]);
      const pts = [];
      for (const pt of pp) for (const zz of zs) {
        pts.push(apply(parentM, apply(R, [ox + pt[0], oy + pt[1], zz])));
      }
      return aabbOf(pts);
    }
    if (k === 'geo') {
      const c = [prim.x||0, prim.y||0, prim.z||0];
      const hw = (prim.w||0.1)/2, hh = (prim.h||0.1)/2, hd = (prim.d||0.1)/2;
      const R = trs([0,0,0], [prim.rotX||0, prim.rotY||0, prim.rotZ||0], [1,1,1]);
      const pts = [];
      for (const sx of [-1,1]) for (const sy of [-1,1]) for (const sz of [-1,1])
        pts.push(apply(parentM, apply(R, [c[0]+sx*hw, c[1]+sy*hh, c[2]+sz*hd])));
      return aabbOf(pts);
    }
    return null;   // op：解析不出来，靠 describe() 的部件包围盒兜底
  }

  /* --------------------------------------------------------------- dump */
  function dump() {
    const API = window.EditorAPI;
    if (!API) return { ok:false, error:'EditorAPI 还没就绪' };
    const raw = (API.getSpec ? API.getSpec() : API.exportSpecJSON());
    const spec = (typeof raw === 'string') ? JSON.parse(raw) : (raw && raw.json ? raw.json : raw);
    const gm = groupMatrices(spec);
    const parts = [];
    for (const p of spec.parts || []) {
      const parentM = gm[p.parent] || gm.body;
      const boxes = [];
      (p.primitives || []).forEach((prim, i) => {
        const wb = primWorldAABB(prim, parentM);
        boxes.push({
          i, kind: prim.kind,
          color: prim.color == null ? null : prim.color,
          world: wb,                              // 解析值（op 为 null）
          src: prim.kind === 'op' ? { src: prim.src, mesh: prim.mesh, prim: prim.prim } : undefined
        });
      });
      let pb = null;
      try { const d = API.describe(p.id); if (d && d.bounds) pb = { min: r3(d.bounds.min), max: r3(d.bounds.max), size: r3(d.bounds.size) }; } catch (e) {}
      const analytic = boxes.reduce((a, b) => unionA(a, b.world), null);
      parts.push({
        id: p.id, name: p.name, category: p.category, parent: p.parent,
        prims: (p.primitives||[]).length,
        world: pb || (analytic && { min: analytic.min, max: analytic.max, size: analytic.size }) || null,
        hasOp: (p.primitives||[]).some(q => q.kind === 'op'),
        boxes
      });
    }
    // 整体包围盒：优先用官方 state()，没有就自己合
    let bbox = null;
    try { const s = API.state(); if (s && s.bbox) bbox = { min: r3(s.bbox.min), max: r3(s.bbox.max) }; } catch (e) {}
    if (!bbox) { let u = null; for (const q of parts) if (q.world) u = unionA(u, q.world); if (u) bbox = { min: u.min, max: u.max }; }
    if (bbox && !bbox.size) bbox.size = r3([bbox.max[0]-bbox.min[0], bbox.max[1]-bbox.min[1], bbox.max[2]-bbox.min[2]]);
    return {
      ok: true,
      schema: 'lowpoly-workshop/readout@1',
      id: spec.id, name: spec.name, mode: spec.mode,
      bbox, palette: spec.palette, rig: spec.rig,
      parts,
      note: 'world = 世界坐标 AABB。box/panel/geo 是解析算出来的（含旋转）；op 图元来自原作几何、解析不出，用该部件 describe().bounds 兜底（parts[].world）。'
    };
  }

  /* --------------------------------------------------------------- ascii */
  const REF_DEFAULT = { src: '/refs/img2threejs-work/reference.png', crop: { x: 0.0305, w: 0.36, y: 0.125, h: 0.81 } };

  function maskFromImage(img, crop, TH, cols, rows, ownBox) {
    const W = img.naturalWidth, H = img.naturalHeight;
    const cx0 = Math.round(crop.x*W), cw = Math.round(crop.w*W);
    const cy0 = Math.round((crop.y||0)*H), ch = Math.round((crop.h??1)*H);
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const g = c.getContext('2d'); g.drawImage(img, cx0, cy0, cw, ch, 0, 0, cw, ch);
    const d = g.getImageData(0, 0, cw, ch).data;
    const cell = (x,y) => { const i = (y*cw+x)*4; return ((d[i]+d[i+1]+d[i+2])/3) < TH ? 1 : 0; };
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++)
      if (cell(x,y)) { if (x<minX)minX=x; if (x>maxX)maxX=x; if (y<minY)minY=y; if (y>maxY)maxY=y; }
    if (minX > maxX) return null;
    const bw = maxX-minX+1, bh = maxY-minY+1;
    const M = [];
    for (let gy = 0; gy < rows; gy++) {
      const row = [];
      for (let gx = 0; gx < cols; gx++) {
        const x0 = minX + Math.floor(bw*gx/cols), x1 = minX + Math.floor(bw*(gx+1)/cols);
        const y0 = minY + Math.floor(bh*gy/rows), y1 = minY + Math.floor(bh*(gy+1)/rows);
        let s = 0, n = 0;
        for (let y = y0; y < Math.max(y1, y0+1); y++) for (let x = x0; x < Math.max(x1, x0+1); x++) {
          if (x>=0 && y>=0 && x<cw && y<ch) { s += cell(x,y); n++; }
        }
        row.push(n && s/n > 0.5 ? 1 : 0);
      }
      M.push(row);
    }
    return { M, bbox: { minX, maxX, minY, maxY, bw, bh }, own: !!ownBox };
  }

  async function ascii(opts) {
    const o = Object.assign({ plane:'front', cols:56, rows:64, ref:true, refSrc:null, refCrop:null, th:170 }, opts||{});
    const d = dump();
    if (!d.ok) return { ok:false, error:d.error };
    // 1) 收集世界 AABB（op 部件用 parts[].world 兜底）
    const boxes = [];
    for (const p of d.parts) {
      let any = false;
      for (const b of p.boxes) if (b.world) { boxes.push(b.world); any = true; }
      if (p.hasOp && p.world) boxes.push(p.world);   // op 几何兜底
      else if (!any && p.world) boxes.push(p.world);
    }
    // 2) 选投影轴
    const AX = {
      front: { h:0, v:1, flipH:false, label:'正面（右 = 世界 +X，上 = +Y）' },
      side:  { h:2, v:1, flipH:true,  label:'侧面（右 = 世界 −Z（朝前），上 = +Y）' },
      top:   { h:0, v:2, flipH:false, label:'顶面（右 = +X，上 = −Z）' }
    }[o.plane] || null;
    if (!AX) return { ok:false, error:'plane 只能是 front/side/top' };
    // 3) 网格范围（用模型包围盒，网格归一化）
    let mnH = Infinity, mxH = -Infinity, mnV = Infinity, mxV = -Infinity;
    for (const b of boxes) {
      mnH = Math.min(mnH, b.min[AX.h]); mxH = Math.max(mxH, b.max[AX.h]);
      mnV = Math.min(mnV, b.min[AX.v]); mxV = Math.max(mxV, b.max[AX.v]);
    }
    if (!isFinite(mnH)) return { ok:false, error:'没有可投影的几何' };
    const spanH = Math.max(mxH-mnH, 1e-6), spanV = Math.max(mxV-mnV, 1e-6);
    // ★ 各自归一到自己的包围盒后铺满网格（和 silhouette 门同一口径，非等比重采样）
    const cellH = spanH/o.cols, cellV = spanV/o.rows;
    const grid = Array.from({length: o.rows}, () => new Array(o.cols).fill(0));
    for (const b of boxes) {
      const h0 = (b.min[AX.h]-mnH)/cellH, h1 = (b.max[AX.h]-mnH)/cellH;
      const v0 = (mxV - b.max[AX.v])/cellV, v1 = (mxV - b.min[AX.v])/cellV;   // y 越大 → 行号越小（上方在前）
      for (let r = Math.max(0, Math.floor(v0)); r < Math.min(o.rows, Math.ceil(v1)); r++)
        for (let c = Math.max(0, Math.floor(h0)); c < Math.min(o.cols, Math.ceil(h1)); c++)
          grid[r][c] = 1;
    }
    // 4) 参考图：优先走服务端（refName），否则页面内解码兜底（src）
    let refMask = null, refInfo = '';
    if (o.ref) {
      if (o.refName) {
        try {
          const r = await fetch('/api/ref/' + encodeURIComponent(o.refName)
            + '/mask?cols=' + o.cols + '&rows=' + o.rows + '&mode=' + (o.refMode || 'dark')
            + '&dark=' + (o.refDark || 120));
          const j = await r.json();
          if (j.ok && !j.empty) { refMask = { M: j.lines.map(s => s.split('').map(Number)) };
            refInfo = '参考图：服务端 ' + o.refName + '（' + j.mode + ' 抠图，归一到自身包围盒）'; }
          else refInfo = '服务端参照图为空（或没这张图）';
        } catch (e) { refInfo = '服务端参照图失败：' + (e && e.message); }
      } else {
        try {
          const cfg = Object.assign({}, REF_DEFAULT, o.refCrop ? { crop: Object.assign({}, REF_DEFAULT.crop, o.refCrop) } : {});
          const img = new Image(); img.crossOrigin = 'anonymous';
          await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = o.refSrc || cfg.src; });
          refMask = maskFromImage(img, cfg.crop, o.th, o.cols, o.rows);
          refInfo = '参考图：页面内解码（各自归一到自己的包围盒）';
        } catch (e) { refInfo = '参考图读取失败：' + (e && e.message); }
      }
    }
    // 5) 出字符画
    const lines = [];
    let onlyM = 0, onlyR = 0, both = 0;
    for (let r = 0; r < o.rows; r++) {
      let s = '';
      for (let c = 0; c < o.cols; c++) {
        const m = grid[r][c], q = refMask ? refMask.M[r][c] : 0;
        if (m && q) { s += '@'; both++; }
        else if (m) { s += '#'; onlyM++; }
        else if (q) { s += 'o'; onlyR++; }
        else s += '.';
      }
      lines.push(s);
    }
    const inter = both, uni = both + onlyM + onlyR;
    return {
      ok: true, plane: o.plane, axisLabel: AX.label,
      cols: o.cols, rows: o.rows, refInfo,
      iou: uni ? +(inter/uni).toFixed(4) : null,
      legend: '@ 重合 / # 只有模型 / o 只有参考图 / . 都没有',
      text: lines.join('\n'),
      modelBox: { h:['min','max'].map(k => +[mnH,mxH][k==='min'?0:1].toFixed(3)), v:[+mnV.toFixed(3), +mxV.toFixed(3)] }
    };
  }

  /* ------------------------------------------------- refProfile：把参照图变成数据
   * 两种用法：
   *   refProfile({ name:'sheet', x,y,w,h,cols,rows })  ★ 推荐：走服务端 /api/ref/:name/profile
   *   refProfile({ src:'/xxx.png', ... })              页面内自己解码（无服务时兜底）
   */
  async function refProfile(opts) {
    const o = Object.assign({}, opts || {});
    if (o.name) {
      const q = new URLSearchParams();
      for (const k of ['x','y','w','h','cols','rows','tol','dark']) if (o[k] != null) q.set(k, o[k]);
      const res = await fetch('/api/ref/' + encodeURIComponent(o.name) + '/profile?' + q.toString());
      const j = await res.json();
      if (!j.ok) return { ok:false, error: j.error || ('HTTP ' + res.status) };
      j.via = 'server';
      return j;
    }
    return refProfileLocal(o);
  }

  async function refs() {
    try { const r = await fetch('/api/ref'); return await r.json(); }
    catch (e) { return { ok:false, error:String(e && e.message) }; }
  }

  async function refProfileLocal(opts) {
    const o = Object.assign({ src: REF_DEFAULT.src, x:0.60, y:0.55, w:0.22, h:0.34,
                              cols:76, rows:46, th:170, invert:false }, opts||{});
    const img = new Image(); img.crossOrigin = 'anonymous';
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = o.src; });
    const W = img.naturalWidth, H = img.naturalHeight;
    const x0 = Math.round(o.x*W), y0 = Math.round(o.y*H);
    const cw = Math.max(1, Math.round(o.w*W)), ch = Math.max(1, Math.round(o.h*H));
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const g = c.getContext('2d'); g.drawImage(img, x0, y0, cw, ch, 0, 0, cw, ch);
    const d = g.getImageData(0, 0, cw, ch).data;
    const isFg = (x,y) => { const i=((y*cw)+x)*4; const v=(d[i]+d[i+1]+d[i+2])/3; return o.invert ? v>o.th : v<o.th; };
    const lines = [], edges = [];
    for (let r = 0; r < o.rows; r++) {
      const ya = Math.floor(ch*r/o.rows), yb = Math.max(ya+1, Math.floor(ch*(r+1)/o.rows));
      let s = '', lo = -1, hi = -1;
      for (let q = 0; q < o.cols; q++) {
        const xa = Math.floor(cw*q/o.cols), xb = Math.max(xa+1, Math.floor(cw*(q+1)/o.cols));
        let n = 0, hit = 0;
        for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) { n++; if (isFg(x,y)) hit++; }
        const on = n && hit/n > 0.5;
        s += on ? '#' : '.';
        if (on) { if (lo < 0) lo = q; hi = q; }
      }
      lines.push(s);
      edges.push(lo < 0 ? null : { row:r, L:+ (lo/o.cols).toFixed(3), R:+((hi+1)/o.cols).toFixed(3) });
    }
    return {
      ok: true, src:o.src, region:{ x:o.x, y:o.y, w:o.w, h:o.h, px:{ x0, y0, w:cw, h:ch } },
      cell:{ pxW:+(cw/o.cols).toFixed(2), pxH:+(ch/o.rows).toFixed(2) },
      edges, text: lines.join('\n')
    };
  }

  /* --------------------------------------------------------------- save */
  async function save(name) {
    const API = window.EditorAPI;
    if (!API || !API.cachePut) return { ok:false, error:'EditorAPI/cachePut 不可用' };
    const nm = name || 'readout';
    const d = dump();
    const a = await ascii({ plane:'front' });
    const b = await ascii({ plane:'side' });
    const r = await API.cachePut({ name: nm, data: { dump: d, asciiFront: a.text, asciiSide: b.text, iou: a.iou, at: Date.now() } });
    return { ok: !!(r && r.ok), name: r && r.name, iou: a.iou, note: 'GET /TemporaryCache/<name>.json 即可读到' };
  }

  function help() {
    return [
      'ModelReadout —— 让 AI 直接读到模型结构 + 参照图数据（不用猜像素）',
      '  模型侧（本地解析）',
      '    dump()                                部件世界 AABB + 每个图元的世界中心/尺寸/旋转/颜色',
      '    await ascii({plane,cols,rows,ref:true,refName})  文本剪影；@ 重合 / # 只有模型 / o 只有参考图',
      '  参照图侧（★ 走服务端，参照图存在 TemporaryCache/refs/）',
      '    await refs()                          列出服务端参照图（含尺寸）',
      '    await refProfile({name,x,y,w,h,cols,rows})       区域轮廓：文本 + 每行左右边界（服务端算）',
      '    await refProfile({src:"/xxx.png",...})           无服务时页面内解码兜底',
      '  落盘',
      '    await save(name)                      dump + 正/侧面剪影 → TemporaryCache/<name>.json',
      '  上传参照图：POST /api/ref {name, dataURL|base64|path}（详见 /api/ref 的 howto）',
      '例： await ModelReadout.refProfile({name:"sheet", x:0.1,y:0.71,w:0.215,h:0.205, cols:86, rows:42})'
    ].join('\n');
  }

  window.ModelReadout = { dump, ascii, refProfile, refProfileLocal, refs, save, help,
                          _math: { trs, mul, apply, groupMatrices } };
})();
