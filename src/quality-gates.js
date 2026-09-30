/* ============================================================================
 * 质量门（quality gates）—— 提炼自 img2threejs 的 forge/stage4_review/
 *
 * 为什么要有这个文件：
 *   img2threejs 的自评是「轮廓 IoU 0.40~0.47（阈值 0.85）→ FAIL」。
 *   它能算出来，靠的是 stage4_review 里一堆确定性度量脚本。我们搬过来，
 *   但**做成浏览器内可跑的**——因为我们的编辑器同时握着参考图和渲染结果，
 *   不需要像它那样「Python 出图 → 存盘 → 另一个脚本读回来」。
 *
 * 本文件里的算法是对原实现的忠实复刻（阈值、分辨率、公式照抄），
 * 只有「取图」那一步换成了 canvas，因为我们有 canvas。
 *
 *   遮罩     build_foreground_mask  —— 四角中位背景 + 动态阈值
 *   轮廓     224² 网格、先取最大连通块、再算交并比        （硬线 0.85）
 *   转盘     REQUIRED_AZIMUTHS=(0,90,180,270)±5°；面积塌缩 <15% 判死；
 *            内部空洞：最大洞 >4px 且占比 >1% 判死
 *   内外差   192² 网格、按高度分带、只比两侧都在前景区内的格子（只报数）
 *   左右     L/R 必须是「矢状面镜像」—— x 取反、其余不变（不是旋转！）
 *   接缝     相邻独立几何的包围盒必须重叠 ≥0.02 世界单位
 *   净空     standProud：采集点必须**在宿主外侧**，不能只是「在附近」
 *   穿插     3 条固定方向射线奇偶投票（至少 2 票）
 *
 * 纪律（照抄 img2threejs 的硬规矩）：
 *   · 脚本只度量，不评判视觉 —— 视觉分数由人/AI 给，这里只出确定性数字
 *   · 「没测」不等于「通过」—— 输入缺失一律报 unevaluated，绝不报 pass
 *   · 单视角不是证据 —— 转盘门和内外差门就是为了补这一点
 * ========================================================================== */
import * as THREE from 'three';

export const GATE_VERSION = 1;

/* ------------------------------------------------------------------ 常量 --- */
export const MASK_GRID         = 224;    // diagnose_render.MASK_GRID_SIZE
export const INTERIOR_GRID     = 192;    // interior_difference.GRID
export const IOU_THRESHOLD     = 0.85;   // SILHOUETTE_IOU_THRESHOLD（硬）
export const ASPECT_DELTA_MAX  = 0.05;   // ASPECT_SOFT_MAX
export const SCALE_DELTA_MAX   = 0.08;   // SCALE_HARD_MAX
export const COLLAPSE_RATIO    = 0.15;   // DEFAULT_COLLAPSE_RATIO
export const HOLE_PIXEL_FLOOR  = 4;      // INTERIOR_HOLE_PIXEL_FLOOR
export const HOLE_FRACTION_MAX = 0.01;   // INTERIOR_HOLE_FRACTION_THRESHOLD
export const REQUIRED_AZIMUTHS = [0, 90, 180, 270];
export const AZIMUTH_TOLERANCE = 5.0;
export const SEAM_OVERLAP_MIN  = 0.02;   // geometry_patterns：0.02~0.05 世界单位

/** 每一遍（pass）的轮廓 IoU 门槛：越到后面越严。
 *  img2threejs 只有一个全局 0.85 —— 那是它做不到分遍；我们做得到，就分遍。
 *  blockout 只要求大形对，成品遍要求 0.85。 */
export const IOU_BY_PASS = {
  blockout:  0.60,
  structure: 0.72,
  hair:      0.78,
  detail:    0.80,
  color:     0.85,
  _default:  0.80,
};

/* ============================================================ 前景遮罩 ==== */

/** 四角中位背景色 + 噪声（照抄 build_foreground_mask 的取背景方式）*/
function cornerBackground(data, w, h){
  const r = Math.max(3, Math.floor(Math.min(w, h) / 40));
  const patches = [[0,0],[w-r,0],[0,h-r],[w-r,h-r]];
  const chans = [[],[],[]];
  for(const [px,py] of patches)
    for(let y=py; y<py+r; y++) for(let x=px; x<px+r; x++){
      const i=(y*w+x)*4;
      chans[0].push(data[i]); chans[1].push(data[i+1]); chans[2].push(data[i+2]);
    }
  const med = a => { const b=a.slice().sort((x,y)=>x-y); return b[b.length>>1]; };
  const bg = [med(chans[0]), med(chans[1]), med(chans[2])];
  const d = [];
  for(const [px,py] of patches)
    for(let y=py; y<py+r; y++) for(let x=px; x<px+r; x++){
      const i=(y*w+x)*4;
      d.push(Math.hypot(data[i]-bg[0], data[i+1]-bg[1], data[i+2]-bg[2]));
    }
  d.sort((x,y)=>x-y);
  const noise = d[Math.min(d.length-1, Math.floor(d.length*0.75))] || 0;
  return { bg, noise };
}

/**
 * 从 RGBA 数组取前景遮罩。
 * @param {Uint8ClampedArray} data RGBA
 * @param {object} opts
 *   · mode 'auto'（默认，参考图：四角中位背景）| 'flat'（渲染图：像素 ≠ bg 即前景）
 *   · bg   mode='flat' 的背景色 [r,g,b]
 * @returns {{mask:Uint8Array,w,h,coverage,warnings,bg,threshold}}
 */
export function maskFromRGBA(data, w, h, opts = {}){
  const mask = new Uint8Array(w * h);
  const warnings = [];
  const mode = opts.mode || 'auto';
  const { bg, noise } = mode === 'flat'
    ? { bg: opts.bg || [255,255,255], noise: 0 }
    : cornerBackground(data, w, h);
  const threshold = mode === 'flat' ? (opts.tolerance ?? 8) : Math.max(24.0, noise * 2.4);

  let transparent = 0;
  for(let i=3; i<w*h*4; i+=4) if(data[i] < 24) transparent++;
  const useAlpha = (transparent / (w*h)) > 0.03;

  let count = 0;
  for(let p=0, i=0; p<w*h; p++, i+=4){
    const a = data[i+3];
    let fg;
    if(useAlpha){
      fg = a > 24;
    }else{
      const dist = Math.hypot(data[i]-bg[0], data[i+1]-bg[1], data[i+2]-bg[2]);
      const mx = Math.max(data[i],data[i+1],data[i+2]), mn = Math.min(data[i],data[i+1],data[i+2]);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      const luma = (0.2126*data[i] + 0.7152*data[i+1] + 0.0722*data[i+2]) / 255;
      fg = a > 16 && (dist > threshold || (sat > 0.16 && luma < 0.94));
    }
    if(fg){ mask[p] = 1; count++; }
  }
  const coverage = count / (w*h);
  if(coverage < 0.035) warnings.push('前景 <3.5% 画面 → 遮罩不可靠，IoU 视为不可用');
  if(coverage > 0.90) warnings.push('前景 >90% 画面 → 主体没有被清晰分离');
  return { mask, w, h, coverage, warnings, bg, threshold };
}

/** 从 canvas / image 取遮罩 */
export function maskFromCanvas(src, opts = {}){
  const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0);
  return maskFromRGBA(ctx.getImageData(0, 0, w, h).data, w, h, opts);
}

/** 只保留最大 4-连通块（照抄 largest_component）*/
export function largestComponent(m){
  const { mask, w, h } = m;
  const seen = new Uint8Array(w*h);
  let best = null, bestN = 0, total = 0;
  for(let i=0;i<w*h;i++) if(mask[i]) total++;
  const stack = new Int32Array(w*h);
  for(let p=0; p<w*h; p++){
    if(!mask[p] || seen[p]) continue;
    let sp = 0, n = 0; stack[sp++] = p; seen[p] = 1;
    const cells = [];
    while(sp){
      const q = stack[--sp]; cells.push(q); n++;
      const x = q % w, y = (q - x) / w;
      if(x > 0   && mask[q-1] && !seen[q-1]){ seen[q-1]=1; stack[sp++]=q-1; }
      if(x < w-1 && mask[q+1] && !seen[q+1]){ seen[q+1]=1; stack[sp++]=q+1; }
      if(y > 0   && mask[q-w] && !seen[q-w]){ seen[q-w]=1; stack[sp++]=q-w; }
      if(y < h-1 && mask[q+w] && !seen[q+w]){ seen[q+w]=1; stack[sp++]=q+w; }
    }
    if(n > bestN){ bestN = n; best = cells; }
  }
  const out = new Uint8Array(w*h);
  if(best) for(const q of best) out[q] = 1;
  const discarded = total ? (total - bestN) / total : 0;
  return { mask: out, w, h, kept: bestN, total, discarded, coverage: bestN / (w*h),
    warnings: discarded > 0.02 ? [`丢弃了 ${(discarded*100).toFixed(1)}% 前景像素（非最大连通块）`] : [] };
}

/** 前景包围盒（半开区间）*/
export function maskBBox(m){
  const { mask, w, h } = m;
  let x0=w, y0=h, x1=-1, y1=-1;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) if(mask[y*w+x]){
    if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y;
  }
  if(x1<0) return null;
  return { x0, y0, x1:x1+1, y1:y1+1, w:x1+1-x0, h:y1+1-y0, aspect:(x1+1-x0)/(y1+1-y0) };
}

/** 最近邻重采样到 size×size（照抄 downsample）*/
export function resampleMask(m, size){
  const { mask, w, h } = m;
  const out = new Uint8Array(size*size);
  for(let y=0;y<size;y++) for(let x=0;x<size;x++){
    const sx = Math.min(w-1, Math.floor(x*w/size));
    const sy = Math.min(h-1, Math.floor(y*h/size));
    out[y*size+x] = mask[sy*w+sx];
  }
  return { mask: out, w: size, h: size };
}

/** 裁到包围盒再重采样 —— 只比「形状」，不比「在画面里的位置/大小」*/
export function normalizeShape(m, size){
  const bb = maskBBox(m);
  if(!bb) return null;
  const out = new Uint8Array(size*size);
  for(let y=0;y<size;y++) for(let x=0;x<size;x++){
    const sx = bb.x0 + Math.min(bb.w-1, Math.floor(x*bb.w/size));
    const sy = bb.y0 + Math.min(bb.h-1, Math.floor(y*bb.h/size));
    out[y*size+x] = m.mask[sy*m.w+sx];
  }
  return { mask: out, w: size, h: size, bbox: bb };
}

/** 交并比（照抄 silhouette_iou）*/
export function iouOf(a, b){
  if(a.w !== b.w || a.h !== b.h) throw new Error('iouOf: 尺寸不一致');
  let inter = 0, union = 0;
  for(let i=0;i<a.mask.length;i++){
    const x = a.mask[i], y = b.mask[i];
    if(x && y) inter++;
    if(x || y) union++;
  }
  return union === 0 ? 1.0 : inter / union;
}

/** 内部空洞：从边界泛洪，没被泛洪到的背景就是洞（照抄 turntable_gate）*/
export function interiorHoles(m){
  const { mask, w, h } = m;
  const outside = new Uint8Array(w*h);
  const stack = new Int32Array(w*h);
  let sp = 0;
  const push = p => { if(p>=0 && !mask[p] && !outside[p]){ outside[p]=1; stack[sp++]=p; } };
  for(let x=0;x<w;x++){ push(x); push((h-1)*w+x); }
  for(let y=0;y<h;y++){ push(y*w); push(y*w+w-1); }
  while(sp){
    const q = stack[--sp];
    const x = q % w, y = (q - x) / w;
    push(x>0 ? q-1 : -1); push(x<w-1 ? q+1 : -1);
    push(y>0 ? q-w : -1); push(y<h-1 ? q+w : -1);
  }
  let hole = 0, largest = 0;
  const seen = new Uint8Array(w*h);
  const st2 = new Int32Array(w*h);
  for(let p=0;p<w*h;p++){
    if(mask[p] || outside[p] || seen[p]) continue;
    let sp2 = 0, n = 0; st2[sp2++] = p; seen[p] = 1;
    while(sp2){
      const q = st2[--sp2]; n++;
      const x = q % w, y = (q - x) / w;
      const nb = [x>0?q-1:-1, x<w-1?q+1:-1, y>0?q-w:-1, y<h-1?q+w:-1];
      for(const z of nb) if(z>=0 && !mask[z] && !outside[z] && !seen[z]){ seen[z]=1; st2[sp2++]=z; }
    }
    hole += n; if(n > largest) largest = n;
  }
  return { holePixels: hole, largestHole: largest, interiorHoleFraction: hole / (w*h) };
}

/** 竖切检测：被空白列隔开的若干个视图 —— 用来识别「三视图拼版」。
 *  注意不能用「列计数==0」判空：拼版常有一条淡淡的连通带（地面阴影/基线），
 *  所以用「列高 < 峰值 × minColFrac」判空。*/
export function detectViews(m, opts = {}){
  const { mask, w, h } = m;
  const minGap = Math.max(2, Math.round(w * (opts.minGapFrac ?? 0.03)));
  const col = new Int32Array(w);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) if(mask[y*w+x]) col[x]++;
  let peak = 0;
  for(let x=0;x<w;x++) if(col[x] > peak) peak = col[x];
  const thr = Math.max(1, Math.round(peak * (opts.minColFrac ?? 0.10)));
  const empty = x => col[x] < thr;

  const segs = [];
  let st = -1, gap = 0;
  for(let x=0;x<w;x++){
    if(!empty(x)){ if(st < 0) st = x; gap = 0; }
    else if(st >= 0){ gap++; if(gap >= minGap){ segs.push([st, x-gap]); st = -1; } }
  }
  if(st >= 0) segs.push([st, w-1]);
  const minW = Math.max(3, Math.round(w * (opts.minWidthFrac ?? 0.03)));
  const spans = segs.filter(s => (s[1]-s[0]) >= minW);
  return { count: spans.length, spans, minGap, columnThreshold: thr, peakColumn: peak,
    crops: spans.map(([x0,x1],i)=>({ index:i,
      rect:{ x: x0/w, y:0, w:(x1-x0+1)/w, h:1 },
      label: `视图 ${i+1}（x ${(x0/w*100).toFixed(0)}%–${((x1+1)/w*100).toFixed(0)}%，占宽 ${(((x1-x0+1)/w)*100).toFixed(0)}%）` })) };
}

/** 取一个归一化裁切区（{x,y,w,h}，0~1）*/
export function cropMask(m, rect){
  if(!rect) return m;
  const x0 = Math.max(0, Math.floor(rect.x * m.w)), y0 = Math.max(0, Math.floor((rect.y||0) * m.h));
  const x1 = Math.min(m.w, Math.ceil((rect.x + rect.w) * m.w));
  const y1 = Math.min(m.h, Math.ceil(((rect.y||0) + (rect.h||1)) * m.h));
  const w = Math.max(1, x1-x0), h = Math.max(1, y1-y0);
  const out = new Uint8Array(w*h);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) out[y*w+x] = m.mask[(y0+y)*m.w + (x0+x)];
  return { mask: out, w, h, coverage: m.coverage, warnings:[], crop:rect };
}

/* ============================================================== 门 0 ==== */
/**
 * 轮廓门：参考图 vs 渲染图的剪影一致性。
 * @param refCanvas    参考图（原图像素，自动取背景）
 * @param renderCanvas 渲染图（纯背景，便于分割）
 * @param opts { grid, iouMin, passId, bg, tolerance, skipNormalize }
 * @returns 任何一环测不了 → verdict:'unevaluated'（**绝不报 pass**）
 */
export function silhouetteGate(refCanvas, renderCanvas, opts = {}){
  const grid = opts.grid || MASK_GRID;
  const passId = opts.passId || '';
  const iouMin = opts.iouMin ?? (IOU_BY_PASS[passId] ?? IOU_BY_PASS._default);
  const out = { gate:'silhouette', passId, grid, iouMin, verdict:'unevaluated', checks:[], warnings:[], metrics:{} };

  let refM, renM;
  try{
    refM = largestComponent(maskFromCanvas(refCanvas, { mode:'auto' }));
    if(opts.refCrop){
      refM = largestComponent(cropMask(refM, opts.refCrop));
      out.refCrop = opts.refCrop;
    }
    renM = largestComponent(maskFromCanvas(renderCanvas,
      { mode:'flat', bg: opts.bg || [255,255,255], tolerance: opts.tolerance ?? 8 }));
  }catch(e){
    out.reason = '取图失败：' + ((e && e.message) || e);
    out.warnings.push(out.reason);
    return out;
  }
  out.warnings.push(...refM.warnings.map(x=>'参考图：'+x), ...renM.warnings.map(x=>'渲染图：'+x));
  if(refM.coverage < 0.035 || renM.coverage < 0.035){
    out.reason = '前景太小，遮罩不可靠 → 门不可用（不报通过）';
    return out;
  }
  // 多视图拼版检测：拼版拿去比单视图，IoU 没有意义，必须说清楚
  const rv = detectViews(refM);
  if(!opts.refCrop && rv.count > 1){
    out.reason = `参考图里有 ${rv.count} 个分离的视图（疑似三视图拼版）→ 请先裁切：`
      + `setRefImage(..., { crop:{x,y,w,h} }) 或 gates({ refCrop:{...} })。`
      + '可选的裁切：' + rv.crops.map(c=>c.label+` {x:${c.rect.x.toFixed(3)},w:${c.rect.w.toFixed(3)}}`).join('；');
    out.views = rv;
    out.warnings.push(out.reason);
    return out;      // ★ 测不了就 unevaluated，绝不硬算一个数字出来
  }
  const refBB = maskBBox(refM), renBB = maskBBox(renM);
  if(!refBB || !renBB){ out.reason = '有一侧前景为空'; return out; }

  const skipNorm = !!opts.skipNormalize;
  const A = skipNorm ? resampleMask(refM, grid) : normalizeShape(refM, grid);
  const B = skipNorm ? resampleMask(renM, grid) : normalizeShape(renM, grid);

  const iou = iouOf(A, B);
  const aspectDelta = Math.abs(refBB.aspect - renBB.aspect) / Math.max(refBB.aspect, renBB.aspect);
  const fillRef = (refBB.w * refBB.h) / (refM.w * refM.h);
  const fillRen = (renBB.w * renBB.h) / (renM.w * renM.h);
  const scaleDelta = Math.abs(fillRef - fillRen) / Math.max(fillRef, fillRen);

  out.metrics = {
    iou:+iou.toFixed(4), normalized:!skipNorm,
    refAspect:+refBB.aspect.toFixed(4), renderAspect:+renBB.aspect.toFixed(4),
    aspectDelta:+aspectDelta.toFixed(4),
    refBoxFill:+fillRef.toFixed(4), renderBoxFill:+fillRen.toFixed(4), scaleDelta:+scaleDelta.toFixed(4),
    refCoverage:+refM.coverage.toFixed(4), renderCoverage:+renM.coverage.toFixed(4),
    refBBox:[refBB.x0,refBB.y0,refBB.w,refBB.h], renderBBox:[renBB.x0,renBB.y0,renBB.w,renBB.h],
    refDiscarded:+refM.discarded.toFixed(4), renderDiscarded:+renM.discarded.toFixed(4),
  };
  out.checks.push({ id:'iou', value:+iou.toFixed(4), min:iouMin, pass:iou>=iouMin,
    note:`轮廓交并比（${skipNorm?'原画面':'已归一到各自包围盒'}）` });
  out.checks.push({ id:'aspect-delta', value:+aspectDelta.toFixed(4), max:ASPECT_DELTA_MAX, pass:aspectDelta<=ASPECT_DELTA_MAX,
    note:'包围盒长宽比偏差（胖瘦）' });
  out.checks.push({ id:'scale-delta', value:+scaleDelta.toFixed(4), max:SCALE_DELTA_MAX, pass:scaleDelta<=SCALE_DELTA_MAX,
    note:'画面占比偏差（取景大小）', soft:true });

  out.verdict = out.checks.filter(c=>!c.soft).every(c=>c.pass) ? 'pass' : 'fail';
  out.iou = +iou.toFixed(4);
  return out;
}

/* ============================================================== 门 1 ==== */
/**
 * 转盘门：多角度自洽（**不需要参考图**）。
 * 「单个视角不是关于模型的证据。」
 * @param views Array<{azimuth:number, canvas}>
 */
export function turntableGate(views, opts = {}){
  const required = opts.requiredAzimuths || REQUIRED_AZIMUTHS;
  const tol = opts.tolerance ?? AZIMUTH_TOLERANCE;
  const out = { gate:'turntable', verdict:'unevaluated', warnings:[], views:[], missingAzimuths:[], degenerate:[] };
  if(!views || !views.length){ out.reason = '没有轨道视图'; return out; }

  const areas = [];
  let anyUnsegmented = false;
  for(const v of views){
    let m;
    try{ m = largestComponent(maskFromCanvas(v.canvas, { mode:'flat', bg:opts.bg||[255,255,255], tolerance:opts.tolerance2??8 })); }
    catch(e){ out.warnings.push('方位 '+v.azimuth+'° 取图失败：'+((e&&e.message)||e)); continue; }
    if(m.warnings.length) anyUnsegmented = true;
    const areaFraction = m.kept / (m.w*m.h);
    const hole = interiorHoles(m);
    const holed = hole.largestHole > HOLE_PIXEL_FLOOR && hole.interiorHoleFraction > HOLE_FRACTION_MAX;
    out.views.push({ azimuth:v.azimuth, areaFraction:+areaFraction.toFixed(4),
      largestHole:hole.largestHole, interiorHoleFraction:+hole.interiorHoleFraction.toFixed(4), holed });
    areas.push({ azimuth:v.azimuth, areaFraction, holed });
  }
  if(!areas.length){ out.reason = '所有轨道视图都取图失败'; return out; }

  const maxArea = Math.max(...areas.map(a=>a.areaFraction)) || 0;
  const minArea = Math.min(...areas.map(a=>a.areaFraction));
  for(const a of areas) if(maxArea > 0 && a.areaFraction/maxArea < COLLAPSE_RATIO) out.degenerate.push(a.azimuth);

  const got = areas.map(a=>a.azimuth);
  for(const r of required){
    const near = got.some(g => { const d = Math.abs(((g - r) % 360 + 540) % 360 - 180); return (180 - d) <= tol; });
    if(!near) out.missingAzimuths.push(r);
  }
  out.coverage = { required, got: got.slice().sort((a,b)=>a-b), missing: out.missingAzimuths };
  out.maxArea = +maxArea.toFixed(4);
  out.minArea = +minArea.toFixed(4);
  out.collapseRatio = +(maxArea ? minArea/maxArea : 0).toFixed(4);
  out.holes = areas.filter(a=>a.holed).map(a=>a.azimuth);

  const ok = !out.missingAzimuths.length && !out.degenerate.length && !anyUnsegmented
          && (opts.allowHoles || !out.holes.length);
  out.verdict = ok ? 'pass' : 'fail';
  if(out.missingAzimuths.length) out.warnings.push('缺方位：'+out.missingAzimuths.join('°/')+'°（必须补拍，单视角不算证据）');
  if(out.degenerate.length) out.warnings.push('面积塌缩（<15% 最大面积）：'+out.degenerate.join('°/')+'° → 这些角度几乎是纸片');
  if(out.holes.length) out.warnings.push('轮廓内部有洞：'+out.holes.join('°/')+'° → 破面或部件缺失');
  if(anyUnsegmented) out.warnings.push('有视图没被清晰分离，分割不可信 → 判死');
  out.failures = out.warnings;
  return out;
}

/* ============================================================== 门 2 ==== */
/**
 * 内外差门：只比轮廓**内部**的外观。
 * 「轮廓 IoU 只读到约 11% 的格子：一个把脸删掉的模型，正面 IoU 和做完脸的一模一样。0.8803。」
 * 输入必须是**同相机同取景**的两张图（用 EditorAPI.render({bake:true}) 出基线，gates 出门时图）。
 * 只报数，不设死线 —— 这是"证据"，不是"判决"。
 */
export function interiorDifference(baselineCanvas, renderCanvas, opts = {}){
  const grid = opts.grid || INTERIOR_GRID;
  const bg = opts.bg || [255,255,255];
  const bands = opts.bands || [{ id:'head', from:0, to:0.19 }, { id:'torso', from:0.19, to:0.62 }, { id:'legs', from:0.62, to:1.0 }];
  const out = { gate:'interior-difference', verdict:'unevaluated', grid, bands:[], warnings:[] };
  const sample = cv => {
    const c = document.createElement('canvas'); c.width = grid; c.height = grid;
    c.getContext('2d', { willReadFrequently:true }).drawImage(cv, 0, 0, grid, grid);
    return c.getContext('2d').getImageData(0, 0, grid, grid).data;
  };
  let A, B;
  try{ A = sample(baselineCanvas); B = sample(renderCanvas); }
  catch(e){ out.reason = '取图失败：'+((e&&e.message)||e); return out; }

  const fg = new Uint8Array(grid*grid);
  for(let p=0,i=0;p<grid*grid;p++,i+=4){
    const dA = Math.hypot(A[i]-bg[0], A[i+1]-bg[1], A[i+2]-bg[2]);
    const dB = Math.hypot(B[i]-bg[0], B[i+1]-bg[1], B[i+2]-bg[2]);
    fg[p] = (dA > 8 && dB > 8) ? 1 : 0;      // 只比「两侧都在前景区内」的格子
  }
  const bb = maskBBox({ mask:fg, w:grid, h:grid });
  if(!bb){ out.reason = '两张图没有共同的前景格子（相机/取景必须一致）'; return out; }

  let totalDiff = 0, cells = 0;
  const acc = bands.map(()=>({ d:0, n:0 }));
  for(let y=bb.y0;y<bb.y1;y++) for(let x=bb.x0;x<bb.x1;x++){
    const p = y*grid+x;
    if(!fg[p]) continue;
    const i = p*4;
    const d = (Math.abs(A[i]-B[i]) + Math.abs(A[i+1]-B[i+1]) + Math.abs(A[i+2]-B[i+2])) / 3 / 255;
    totalDiff += d; cells++;
    const t = (y - bb.y0) / Math.max(1, bb.h);
    bands.forEach((b,bi)=>{ if(t >= b.from && t < b.to){ acc[bi].d += d; acc[bi].n++; } });
  }
  out.interiorDifference = cells ? +(totalDiff/cells).toFixed(4) : null;
  out.cellsCompared = cells;
  out.bands = bands.map((b,i)=>({ id:b.id, from:b.from, to:b.to, cells:acc[i].n,
    difference: acc[i].n ? +(acc[i].d/acc[i].n).toFixed(4) : null }));
  out.verdict = cells ? 'report' : 'unevaluated';
  if(!cells) out.reason = '没有共同前景格子';
  return out;
}

/* ============================================================== 门 3 ==== */
/**
 * 左右门：L/R 必须是「矢状面镜像」，不是旋转。
 * 「一套左右两边都错得一样的部件照样通过」—— 所以要成对检查。
 * 规则：名字以 L/R（或 左/右）收尾的部件，位置 x 必须互为相反数。
 */
export function chiralityGate(spec, opts = {}){
  const rel = opts.relTolerance ?? 0.02;    // 相对容差
  const out = { gate:'chirality', verdict:'unevaluated', pairs:[], failures:[], warnings:[] };
  const parts = (spec && spec.parts) || [];
  if(!parts.length){ out.reason = '没有部件可比（base 模式请在 boxify 之后跑）'; return out; }

  const side = name => {
    const m = /^(.*?)[\s_\-·]*(L|R)$/.exec(name || '') || /^(.*?)[\s_\-·]*(左|右)$/.exec(name || '');
    if(!m) return null;
    return { base: m[1].trim(), s: (m[2]==='L'||m[2]==='左') ? 'L' : 'R' };
  };
  const groups = new Map();
  for(const p of parts){
    const s = side(p.name) || side(p.id);
    if(!s) continue;
    if(!groups.has(s.base)) groups.set(s.base, {});
    const cur = groups.get(s.base);
    if(!cur[s.s]) cur[s.s] = p;
  }
  const centroidX = p => {
    const xs = (p.primitives||[]).map(q=>q.x || 0);
    return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0;
  };
  for(const [base, g] of groups){
    if(!g.L || !g.R) continue;
    const xl = centroidX(g.L), xr = centroidX(g.R);
    const sum = Math.abs(xl + xr);
    const scale = Math.max(Math.abs(xl), Math.abs(xr), 1e-3);
    const ok = sum <= rel * scale;
    out.pairs.push({ base, xL:+xl.toFixed(4), xR:+xr.toFixed(4), mirrorSum:+sum.toFixed(4), ok,
      note: ok ? '互为镜像' : '不是镜像（x 之和不为 0）' });
    if(!ok) out.failures.push(`${base}: L.x=${xl.toFixed(4)} R.x=${xr.toFixed(4)} 之和=${sum.toFixed(4)}（应≈0）`);
  }
  out.passedPairs = out.pairs.filter(p=>p.ok).length;
  out.verdict = out.failures.length ? 'fail' : (out.pairs.length ? 'pass' : 'unevaluated');
  if(!out.pairs.length) out.reason = '没找到 L/R 配对（部件名要以 L/R 或 左/右 收尾，例如「双马尾 L」）';
  return out;
}

/* ============================================================== 门 4 ==== */
/**
 * 接缝门：相邻的独立几何必须真的接上（包围盒重叠 ≥0.02 世界单位）。
 * 「部件必须物理上连在一起，不能只是彼此靠近。」
 * @param boxes       Map<partId, THREE.Box3>
 * @param opts.groupBoxes Map<groupKey, THREE.Box3>  —— 每个挂靠组的**基础几何**包围盒
 *        （只由原作/base 网格算出，**不能**把部件自己算进去，否则门恒真、毫无意义）
 */
export function seamGate(spec, boxes, opts = {}){
  const minOverlap = opts.minOverlap ?? SEAM_OVERLAP_MIN;
  const groupBoxes = opts.groupBoxes || null;
  const out = { gate:'seam', verdict:'unevaluated', checked:0, failures:[], warnings:[], minOverlap,
    checkedAgainstParts:0, checkedAgainstGroups:0, checkedAgainstSiblings:0, bestLinks:[] };
  const parts = (spec && spec.parts) || [];
  if(!boxes || !boxes.size){ out.reason = '没有包围盒（先 build()）'; return out; }
  const ids = new Set(parts.map(p=>p.id));
  const seen = new Set();
  for(const p of parts){
    const a = boxes.get(p.id);
    if(!a) continue;
    // ⚠ parent 可能是「同名部件」：通用体型里 部件 id armL 挂在组 armL 上，
    //    这时 p.parent === p.id，绝不能当成「部件→部件」→ 否则就是自己跟自己比、必然 pass
    const isPartParent = p.parent !== p.id && ids.has(p.parent);
    const host = isPartParent ? (boxes.get(p.parent) || null) : (groupBoxes ? (groupBoxes.get(p.parent) || null) : null);
    if(!host) continue;
    seen.add(p.id);
    out.checked++;
    if(isPartParent) out.checkedAgainstParts++; else out.checkedAgainstGroups++;
    const ov = a.clone().intersect(host);
    const size = ov.isEmpty() ? null : ov.getSize(new THREE.Vector3());
    const depth = size ? Math.min(size.x, size.y, size.z) : 0;
    if(depth < minOverlap){
      out.failures.push({ part:p.id, name:p.name, host: isPartParent ? p.parent : (p.parent+'（基础几何）'),
        hostKind: isPartParent ? 'part' : 'group', overlapDepth:+depth.toFixed(4),
        note: ov.isEmpty() ? '包围盒完全不相交（悬空）' : `重叠厚度 ${depth.toFixed(4)} < ${minOverlap}` });
    }
  }
  // ---- 兜底：纯手搓角色没有「原作几何」当宿主，那就查「有没有和任何别的部件相接」----
  //   一个真正悬空的部件（比如飘在空中的马尾）会和所有部件都不重叠 → 抓得到
  if(opts.selfConnect !== false){
    for(const p of parts){
      if(seen.has(p.id)) continue;
      const a = boxes.get(p.id); if(!a) continue;
      let best = 0, bestWith = null;
      for(const q of parts){
        if(q.id === p.id) continue;
        const b = boxes.get(q.id); if(!b) continue;
        const ov = a.clone().intersect(b);
        if(ov.isEmpty()) continue;
        const sz = ov.getSize(new THREE.Vector3());
        const d = Math.min(sz.x, sz.y, sz.z);
        if(d > best){ best = d; bestWith = q.id; }
      }
      out.checked++; out.checkedAgainstSiblings++;
      if(best < minOverlap){
        out.failures.push({ part:p.id, name:p.name, host:'（任何其它部件）', hostKind:'any',
          overlapDepth:+best.toFixed(4),
          note: best === 0 ? '不和任何部件相接 → 悬空' : `最大重叠只有 ${best.toFixed(4)} < ${minOverlap}` });
      }else if(!out.bestLinks) out.bestLinks = [];
      if(out.bestLinks && bestWith) out.bestLinks.push({ part:p.id, with:bestWith, depth:+best.toFixed(4) });
    }
  }
  out.verdict = out.checked === 0 ? 'unevaluated' : (out.failures.length ? 'fail' : 'pass');
  if(out.checked === 0) out.reason = '没有可比对象（既没有部件父子关系，也只有不到两个部件）';
  return out;
}

/* ==================================================== 三角面采样（共用）=== */
/** 把一个 Object3D 的所有网格烘成世界空间三角面汤，一次性预计算（性能关键）*/
export function triangleSoup(obj, maxTris = 20000){
  const tris = [];
  let skipped = 0;
  obj.traverse(o => {
    if(!o.isMesh || !o.geometry) return;
    o.updateWorldMatrix(true, false);
    const pos = o.geometry.attributes.position, idx = o.geometry.index;
    if(!pos) return;
    const n = idx ? idx.count/3 : pos.count/3;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for(let t=0;t<n;t++){
      if(tris.length/9 >= maxTris){ skipped++; continue; }
      let i0,i1,i2;
      if(idx){ i0=idx.getX(t*3); i1=idx.getX(t*3+1); i2=idx.getX(t*3+2); }
      else { i0=t*3; i1=t*3+1; i2=t*3+2; }
      a.fromBufferAttribute(pos,i0).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos,i1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos,i2).applyMatrix4(o.matrixWorld);
      tris.push(a.x,a.y,a.z, b.x,b.y,b.z, c.x,c.y,c.z);
    }
  });
  const bb = new THREE.Box3();
  for(let i=0;i<tris.length;i+=3) bb.expandByPoint(new THREE.Vector3(tris[i],tris[i+1],tris[i+2]));
  return { tris: new Float32Array(tris), count: tris.length/9, bbox: bb, skipped };
}

const RAY_DIRS = [
  new THREE.Vector3(0.577, 0.577, 0.577).normalize(),
  new THREE.Vector3(-0.802, 0.535, 0.267).normalize(),
  new THREE.Vector3(0.267, -0.802, 0.535).normalize(),
];
const EPS = 1e-9, GRAZE = 1e-7;

/** Möller–Trumbore：true=命中，'grazing'=擦边（这一票作废），null=不命中 */
function rayTri(ox,oy,oz, dx,dy,dz, ax,ay,az, bx,by,bz, cx,cy,cz){
  const e1x=bx-ax, e1y=by-ay, e1z=bz-az;
  const e2x=cx-ax, e2y=cy-ay, e2z=cz-az;
  const px = dy*e2z - dz*e2y, py = dz*e2x - dx*e2z, pz = dx*e2y - dy*e2x;
  const det = e1x*px + e1y*py + e1z*pz;
  if(Math.abs(det) < EPS) return null;
  const inv = 1/det;
  const tx = ox-ax, ty = oy-ay, tz = oz-az;
  const u = (tx*px + ty*py + tz*pz) * inv;
  if(u < -GRAZE || u > 1+GRAZE) return null;
  if(Math.abs(u) < GRAZE || Math.abs(u-1) < GRAZE) return 'grazing';
  const qx = ty*e1z - tz*e1y, qy = tz*e1x - tx*e1z, qz = tx*e1y - ty*e1x;
  const v = (dx*qx + dy*qy + dz*qz) * inv;
  if(v < -GRAZE || u+v > 1+GRAZE) return null;
  if(Math.abs(v) < GRAZE || Math.abs(u+v-1) < GRAZE) return 'grazing';
  const t = (e2x*qx + e2y*qy + e2z*qz) * inv;
  if(t < 1e-6) return null;
  return true;
}

/** 点是否在三角面汤内部（3 条固定方向奇偶投票，至少 2 票有效才下结论）*/
export function pointInSoup(p, soup){
  if(soup.count === 0) return { inside:false, votes:{in:0,total:0} };
  if(!soup.bbox.containsPoint(p)) return { inside:false, votes:{in:0,total:3} };   // 便宜的前置剪枝
  const T = soup.tris;
  let votesIn = 0, votesTotal = 0;
  for(const dir of RAY_DIRS){
    let crossings = 0, grazing = false;
    for(let t=0;t<T.length;t+=9){
      const r = rayTri(p.x,p.y,p.z, dir.x,dir.y,dir.z,
        T[t],T[t+1],T[t+2], T[t+3],T[t+4],T[t+5], T[t+6],T[t+7],T[t+8]);
      if(r === 'grazing'){ grazing = true; break; }
      if(r) crossings++;
    }
    if(grazing) continue;
    votesTotal++;
    if(crossings % 2 === 1) votesIn++;
  }
  const inside = votesTotal >= 2 && votesIn >= Math.ceil(votesTotal/2);
  return { inside, votes:{ in:votesIn, total:votesTotal } };
}

/** 从 Object3D 采一批表面点（顶点，按 stride 抽样）*/
export function samplePoints(obj, maxSamples = 300){
  const raw = [], meshes = [];
  obj.traverse(o => { if(o.isMesh && o.geometry && o.geometry.attributes.position) meshes.push(o); });
  const total = meshes.reduce((a,m)=>a+m.geometry.attributes.position.count, 0);
  if(!total) return [];
  const stride = Math.max(1, Math.ceil(total / maxSamples));
  const v = new THREE.Vector3();
  for(const m of meshes){
    const pos = m.geometry.attributes.position;
    m.updateWorldMatrix(true, false);
    for(let i=0;i<pos.count;i+=stride){
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      raw.push(new THREE.Vector3(v.x,v.y,v.z));
    }
  }
  return raw;
}

/* ============================================================== 门 5 ==== */
/**
 * 净空门（standProud）：需要「站在外面的东西」必须真的在外面。
 * 「头发陷进头骨 = 那里渲染出来是秃的。近邻测试会放过它——顶点还在附近，
 *   只是沉到表面下面去了。」
 *
 * ⚠ 但注意：我们这套模型是**方块拼的**，发根、耳根、饰品的连接端**本来就该埋进宿主里**
 *   （「通用体型」的刘海有 50% 的采样点在额头内部，这是对的）。
 *   所以这个门只在**整件几乎全埋进去**时才判死（`maxInsideFraction` 默认 0.85），
 *   部分埋入只给 warning。**「秃斑」要用 `scalpGate` 判**，不是这个门。
 * @param probes [{name, object}] 外观件
 * @param hosts  [{name, object}] 宿主
 */
export function clearanceGate(probes, hosts, opts = {}){
  const samples = opts.samples ?? 300;
  const maxInside = opts.maxInsideFraction ?? 0.85;
  const warnOver = opts.warnInsideFraction ?? 0.45;
  const out = { gate:'clearance', verdict:'unevaluated', items:[], failures:[], warnings:[], maxInsideFraction:maxInside };
  if(!probes.length || !hosts.length){ out.reason = '需要同时给出外观件和宿主'; return out; }

  const hostSoups = hosts.map(h => ({ name:h.name || '(宿主)', soup: triangleSoup(h.object) }));
  for(const pr of probes){
    const pts = samplePoints(pr.object, samples);
    if(!pts.length) continue;
    let inside = 0, minDist = Infinity;
    for(const p of pts){
      let isIn = false, d = Infinity;
      for(const { soup } of hostSoups){
        const r = pointInSoup(p, soup);
        if(r.inside) isIn = true;
        // 到包围盒的距离（便宜的近似；判定"在内/在外"用的是奇偶投票）
        const c = soup.bbox.getCenter(new THREE.Vector3()), s = soup.bbox.getSize(new THREE.Vector3()).multiplyScalar(0.5);
        const dx = Math.max(0, Math.abs(p.x-c.x)-s.x), dy = Math.max(0, Math.abs(p.y-c.y)-s.y), dz = Math.max(0, Math.abs(p.z-c.z)-s.z);
        d = Math.min(d, Math.hypot(dx,dy,dz));
      }
      if(isIn) inside++;
      if(d < minDist) minDist = d;
    }
    const fraction = inside / pts.length;
    const rec = { name: pr.name || '(未命名)', total: pts.length, inside,
      insideFraction: +fraction.toFixed(4), distToHost: +minDist.toFixed(4), pass: fraction <= maxInside };
    out.items.push(rec);
    if(!rec.pass) out.failures.push(`${rec.name}: ${(fraction*100).toFixed(1)}% 采样点在宿主内部（整件几乎全埋进去了 → 看不见）`);
    else if(fraction > warnOver) out.warnings.push(`${rec.name}: ${(fraction*100).toFixed(1)}% 埋入宿主 → 属于正常连接，但埋得偏多`);
  }
  out.verdict = out.items.length ? (out.items.every(i=>i.pass) ? 'pass' : 'fail') : 'unevaluated';
  if(!out.items.length) out.reason = '没有取到采样点';
  return out;
}

/* ============================================================== 门 5b === */
/**
 * 头皮覆盖门（scalp exposure）—— 头发专用，**硬门**。
 * 「头发陷进头骨 = 那里渲染出来是秃的。」
 * ★ 但要问对问题：**不是「头发有没有在头骨里面」**（发根本来就是埋进去的，
 *   我们的刘海有 50% 的采样点都在额头里），而是「**头皮有没有露出来**」。
 * 所以：采样宿主上「朝上/朝后」的表面点，看点有没有被头发的体积盖住。
 * 露出的比例 > opts.maxExposed（默认 5%）→ 判死。
 */
export function scalpGate(host, probes, opts = {}){
  const maxExposed = opts.maxExposed ?? 0.05;
  const lateral = opts.lateral ?? 0.055;
  const maxHost = opts.hostSamples ?? 700;
  const out = { gate:'scalp-coverage', verdict:'unevaluated', maxExposed, lateral, samples:0, exposed:0,
    exposedFraction:null, failures:[], warnings:[] };
  if(!host || !probes || !probes.length){ out.reason = '需要宿主 + 至少一个头发件'; return out; }

  // 宿主的表面点 + 法线（世界空间，按 stride 抽样）
  const pts = [];
  const meshes = [];
  host.traverse(o => { if(o.isMesh && o.geometry && o.geometry.attributes.position) meshes.push(o); });
  const total = meshes.reduce((a,m)=>a+m.geometry.attributes.position.count, 0);
  if(!total){ out.reason = '宿主没有可采样的顶点'; return out; }
  const stride = Math.max(1, Math.ceil(total/maxHost));
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for(const m of meshes){
    const pos = m.geometry.attributes.position, nor = m.geometry.attributes.normal;
    if(!nor) continue;
    m.updateWorldMatrix(true, false);
    const nm = new THREE.Matrix3().getNormalMatrix(m.matrixWorld);
    for(let i=0;i<pos.count;i+=stride){
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      // 只取「朝上」或「朝后」的表面 = 头皮（脸/下巴不参与）
      if(n.y > 0.25 || (n.z < -0.40 && n.y > -0.15)) pts.push({ p:v.clone(), n:n.clone() });
    }
  }
  if(!pts.length){ out.reason = '宿主上找不到「朝上/朝后」的表面点（不是头吗？）'; return out; }

  // 头发的体积 + 顶点
  const soups = probes.map(pr => ({ name:pr.name, soup: triangleSoup(pr.object) }));
  const hairPts = [];
  for(const pr of probes) hairPts.push(...samplePoints(pr.object, 260));
  const lat2 = lateral*lateral;

  let exposed = 0;
  const bad = [];
  for(const { p } of pts){
    let covered = false;
    for(const s of soups){ if(pointInSoup(p, s.soup).inside){ covered = true; break; } }
    if(!covered){
      for(const q of hairPts){
        const dx=q.x-p.x, dy=q.y-p.y, dz=q.z-p.z;
        if(dx*dx+dy*dy+dz*dz <= lat2){ covered = true; break; }
      }
    }
    if(!covered){ exposed++; if(bad.length<8) bad.push([+p.x.toFixed(3),+p.y.toFixed(3),+p.z.toFixed(3)]); }
  }
  out.samples = pts.length;
  out.exposed = exposed;
  out.exposedFraction = +(exposed/pts.length).toFixed(4);
  out.sampleExposedPoints = bad;
  out.verdict = out.exposedFraction <= maxExposed ? 'pass' : 'fail';
  if(out.verdict==='fail')
    out.failures.push(`头皮有 ${(out.exposedFraction*100).toFixed(1)}% 露出来了（上限 ${(maxExposed*100).toFixed(0)}%）`
      + ` → 这些地方会渲染成秃的；示例点 ${JSON.stringify(bad.slice(0,3))}`);
  return out;
}

/* ============================================================== 门 6 ==== */
/**
 * 穿插门：两个部件互相穿过去。
 * 「头骨破个洞、帽子挂在胯高、吊坠飘着 —— 都熬过了八轮只看正面的评审。」
 * 只测包围盒相交的对，其余跳过（并在报告里说清"没测"）。
 *
 * ⚠ 我们这套模型是**靠互相压叠来避免接缝**的（相邻件要重叠 ≥0.02 才算接上），
 *   所以「有意为之的连接」必然会产生穿插。据此分两级：
 *     · fraction < opts.minFraction（默认 0.10）→ `minor`：列出来但不判死
 *     · 超过 → `fail`
 *   结构性连接可以用 `opts.allowPairs`（部件名对）显式放行。
 * @param objects Array<Object3D | {name, object, kind, hair}>
 */
export function penetrationGate(objects, opts = {}){
  const samples = opts.samples ?? 200;
  const maxPairs = opts.maxPairs ?? 60;
  const minFraction = opts.minFraction ?? 0.10;
  const allow = new Set((opts.allowPairs||[]).map(([a,b])=>JSON.stringify([a,b].sort())));
  const out = { gate:'penetration', verdict:'unevaluated', pairs:[], minor:[], failures:[], warnings:[],
    sampledPerObject: samples, testedPairs: 0, skippedPairs: 0, skippedByRule: 0, minFraction };
  const norm = objects.filter(Boolean).map(o => (o.isObject3D || o.traverse) ? { name:o.name||'(未命名)', object:o, kind:null } : o);
  const list = norm.filter(o => o && o.object);
  if(list.length < 2){ out.reason = '少于两个对象'; return out; }

  const soups = list.map(o => ({ ...o, soup: triangleSoup(o.object) }));
  const cand = [];
  for(let i=0;i<soups.length;i++) for(let j=i+1;j<soups.length;j++){
    if(!soups[i].soup.bbox.intersectsBox(soups[j].soup.bbox)) continue;
    if(opts.skipPair && opts.skipPair(soups[i], soups[j])){ out.skippedByRule++; continue; }
    if(allow.has(JSON.stringify([soups[i].name, soups[j].name].sort()))){ out.skippedByRule++; continue; }
    cand.push([i,j]);
  }
  out.candidatePairs = cand.length;
  if(cand.length > maxPairs){
    out.skippedPairs = cand.length - maxPairs;
    out.warnings.push(`候选对 ${cand.length} 超过上限 ${maxPairs}，只测前 ${maxPairs} 对（其余**未测 ≠ 通过**）`);
    cand.length = maxPairs;
  }
  for(const [i,j] of cand){
    out.testedPairs++;
    const A = soups[i], B = soups[j];
    const pts = samplePoints(A.object, samples);
    if(!pts.length) continue;
    let inside = 0;
    for(const p of pts) if(pointInSoup(p, B.soup).inside) inside++;
    if(inside > 0){
      const fraction = inside/pts.length;
      const rec = { a:A.name, b:B.name, sampled:pts.length, inside, fraction:+fraction.toFixed(4) };
      if(fraction < minFraction){ rec.severity='minor'; out.minor.push(rec); }
      else { rec.severity='fail'; out.pairs.push(rec);
        out.failures.push(`${A.name} 穿进 ${B.name}：${inside}/${pts.length}（${(fraction*100).toFixed(0)}%）个采样点在内部`); }
    }
  }
  out.verdict = out.failures.length ? 'fail'
    : (out.testedPairs ? (out.skippedPairs ? 'unevaluated' : 'pass') : 'unevaluated');
  if(!out.testedPairs) out.reason = out.skippedByRule
    ? `没有任何一对需要测（跳过了 ${out.skippedByRule} 对按规则忽略的配对）`
    : '没有任何一对包围盒相交';
  if(out.minor.length) out.warnings.push(`轻微压叠（<${(minFraction*100).toFixed(0)}%，属正常连接）：`
    + out.minor.map(r=>`${r.a}↔${r.b} ${(r.fraction*100).toFixed(1)}%`).join('、'));
  return out;
}

/* ============================================================ 汇总 ==== */
/** 一个门失败时的「人话原因」——优先 failures，其次 checks 里没过的那几条 */
export function failDetail(g){
  if(g.failures && g.failures.length) return String(g.failures[0]);
  if(g.reason) return g.reason;
  if(Array.isArray(g.checks)){
    const bad = g.checks.filter(c=>!c.soft && !c.pass);
    if(bad.length) return bad.map(c=>`${c.id}=${c.value}（需 ${c.min!=null?('≥ '+c.min):('≤ '+c.max)}）`).join('；');
  }
  if(g.warnings && g.warnings.length) return g.warnings[0];
  return g.gate+' 未通过';
}

/** 所有门都 pass 才算 pass；有 unevaluated 就是 unevaluated（**不是 pass**）*/
export function summarize(report){
  const gates = Object.values(report).filter(g => g && g.gate);
  const fails = gates.filter(g => g.verdict === 'fail');
  const un = gates.filter(g => g.verdict === 'unevaluated');
  const verdict = fails.length ? 'fail' : (un.length ? 'unevaluated' : 'pass');
  return {
    verdict, gates: gates.length,
    passed: gates.filter(g=>g.verdict==='pass').map(g=>g.gate),
    failed: fails.map(g=>g.gate),
    unevaluated: un.map(g=>g.gate),
    reported: gates.filter(g=>g.verdict==='report').map(g=>g.gate),
    reasons: fails.map(g=>`${g.gate}: ${failDetail(g)}`),
    advice: un.map(g=>`${g.gate}: ${g.reason||'没测到'}`),
    note: !fails.length && un.length ? '有门没测到：'+un.map(g=>g.gate).join(', ')+' —— 没测 ≠ 通过' : '',
  };
}

export { THREE };
