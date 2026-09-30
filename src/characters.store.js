/* ============================================================================
 * characters.store.js —— 浏览器侧：模型保存 / 临时缓存 / Agent 接管 / 显卡检测
 *
 * 配套服务端：_serve.js 的 /api/* （同一个 http 源，直接 fetch 即可）
 *
 * 三个目录的分工（**别混用**）：
 *   NewlyAddedModelList/           确认的新增模型 —— 正式产物，角色实验室「新增模型」里展示
 *   NewlyAddedModelTemporaryList/  新增模型的临时区 —— 存下来但还没确认的
 *   TemporaryCache/                AI 测试/缓存产物 —— 随时可清，**不要往这里放正式数据**
 *
 * 用法：
 *   import { Store, gpuInfo, gpuAdvice } from './characters.store.js';
 *   await Store.saveModel({ id:'myguy', name:'通用体型', spec });
 *   await Store.confirm('myguy');
 *   await Store.cachePut({ name:'gate-report', data:{...} });
 *   Store.gpu(); Store.gpuAdvice();
 * ========================================================================== */

const J = async (url, opt) => {
  const r = await fetch(url, opt);
  const t = await r.text();
  let j = null; try{ j = JSON.parse(t); }catch(e){ j = { ok:false, error:t.slice(0, 300) }; }
  if(!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
  return j;
};
const post = (url, body) => J(url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body || {}) });

export const Store = {
  /* ---- 模型 ---- */
  listModels:  ()      => J('/api/models'),
  overview:    ()      => J('/api/store'),
  getModel:    id      => J('/api/models/' + encodeURIComponent(id)),
  /** { id, name, spec, js?, thumb?, note?, category?, stats?, dir:'temporary'|'confirmed' }
   *  默认进**临时区**；要直接进正式区传 dir:'confirmed' */
  saveModel:   o       => post('/api/models', o),
  confirm:     id      => post('/api/models/' + encodeURIComponent(id) + '/confirm'),
  unconfirm:   id      => post('/api/models/' + encodeURIComponent(id) + '/unconfirm'),
  removeModel: id      => J('/api/models/' + encodeURIComponent(id), { method:'DELETE' }),

  /* ---- ★ 模型文件：AI Agent 取用（详见 docs/model-files.md）---- */
  /** AI 入口总览：有什么、从哪拿 */
  index:      () => J('/api/index'),
  /** 原作角色索引（低模 14 + 高模烘焙变体）；POST 版本把权威清单写回 data/characters.json */
  characters: () => J('/api/characters'),
  publishCharacters: c => post('/api/characters', c),
  /** ★ 一次拿全：meta + spec + js + 文件清单 + 直链（等价于「模型文件」）*/
  getModelBundle: id => J('/api/models/' + encodeURIComponent(id) + '/bundle'),
  /** 模型目录里的文件清单 */
  getModelFiles:  id => J('/api/models/' + encodeURIComponent(id) + '/files'),
  /** 取原始文件（model.json / model.js / thumb.png …）；download=true 时服务端带 attachment
   *  返回的是 URL，可直接 <a href> / curl / fetch */
  modelFileURL: (id, name, download) =>
    '/api/models/' + encodeURIComponent(id) + '/file/' + encodeURIComponent(name) + (download ? '?download=1' : ''),
  /** 直接把模型文件读成文本（AI Agent 最常用：一次调用拿到 model.js 源码）*/
  readModelFile: async (id, name) => {
    const r = await fetch(Store.modelFileURL(id, name));
    if(!r.ok) throw new Error('读不到 ' + id + '/' + name + '：HTTP ' + r.status);
    return r.text();
  },

  /* ---- 临时缓存（AI 测试产物都丢这里）---- */
  cacheList:  () => J('/api/cache'),
  /** { name, data, ext?, thumb? } —— data 是对象就自动 JSON 序列化 */
  cachePut:   o  => post('/api/cache', o),
  cacheClear: () => J('/api/cache', { method:'DELETE' }),
  /** 便捷：把一次质量门报告 + 截图丢进缓存 */
  cacheGate:  (label, report, shotDataUrl) => post('/api/cache', {
    name: 'gate-' + label + '-' + new Date().toISOString().replace(/[:.]/g, '-'),
    data: report, thumb: shotDataUrl || null }),

  /* ---- Agent 接管（租约制：不 ping 就自动过期，等于已退出）---- */
  getAgent: () => J('/api/agent'),
  /** { agent:'claude-code'|'codex'|'opencode'|… , note, ttlMinutes? }
   *  ★ 交还：setAgent({ agent:null, note:'做完交还' }) 或 releaseAgent() */
  setAgent: o  => post('/api/agent', o),
  /** 显式交还（等价于 setAgent({agent:null})）*/
  releaseAgent: note => post('/api/agent', { agent:null, note: note || '' }),
  /** 续约：正在干活的 Agent 要定期调，否则超过 ttlMinutes 会被当作已退出 */
  pingAgent: () => post('/api/agent/ping', {}),

  /* ---- 显卡 ---- */
  gpu: () => gpuInfo(),
};

/* ------------------------------------------------------------ 显卡检测 --- */
/** 检测当前浏览器实际用来跑 3D 的渲染后端。
 *  返回 { supported, webgl, vendor, renderer, software, tier, maxTexture, error } */
export function gpuInfo(){
  const out = { supported:false, webgl:null, vendor:null, renderer:null, software:false,
    tier:'none', maxTexture:0, maxRenderbuffer:0, antialias:null, error:null };
  try{
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
    if(!gl){ out.error = '浏览器没有可用的 WebGL 上下文（WebGL 被禁用或显卡驱动异常）'; return out; }
    out.supported = true;
    out.webgl = (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext) ? 'WebGL 2' : 'WebGL 1';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    out.vendor   = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)   : gl.getParameter(gl.VENDOR);
    out.renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    out.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0;
    out.maxRenderbuffer = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || 0;
    const ca = gl.getContextAttributes(); out.antialias = ca ? !!ca.antialias : null;
    const r = String(out.renderer || '').toLowerCase();
    out.software = /swiftshader|llvmpipe|software|softpipe|basic render|microsoft basic|mesa offscreen/.test(r);
    out.tier = out.software ? 'software'
      : (/rtx|geforce|radeon|quadro|arc |iris|uhd graphics|vega|apple m|adreno|mali|powervr|gpu/.test(r) ? 'gpu' : 'unknown');
    try{ const lose = gl.getExtension('WEBGL_lose_context'); if(lose) lose.loseContext(); }catch(e){}
  }catch(e){ out.error = String((e && e.message) || e); }
  return out;
}

/** 把显卡检测结果翻译成「能不能用 / 不能用怎么办」 */
export function gpuAdvice(info){
  const i = info || gpuInfo();
  const name = i.renderer || '(未知)';
  if(!i.supported)
    return { level:'blocked', title:'跑不了 3D —— 没有可用的 WebGL',
      detail:i.error || '浏览器没有给出 WebGL 上下文。',
      steps:[
        '用 Chrome / Edge / Firefox 的最新版（IE、部分国产内核浏览器不行）',
        'Chrome 设置 → 系统 → 打开「使用硬件加速模式」，然后重启浏览器',
        '地址栏打开 chrome://gpu 看 “WebGL” 那一行是不是 Hardware accelerated；如果是 Software only 说明显卡驱动有问题',
        '更新显卡驱动（NVIDIA / AMD / Intel 官网，别用系统自带的通用驱动）',
        '虚拟机 / 远程桌面 / 无头服务器里通常没有 GPU：本工具必须在**有显卡的本机浏览器**里打开',
      ],
      docs:'docs/gpu.md' };
  if(i.software)
    return { level:'warn', title:'正在用软件渲染（CPU 模拟）—— 能跑，但很慢而且可能崩',
      detail:i.webgl + ' · ' + name,
      steps:[
        '这就是「没有显卡」的状态：SwiftShader / llvmpipe 是浏览器拿 CPU 顶的',
        '打开硬件加速：Chrome → 设置 → 系统 → 使用硬件加速模式 → 重启',
        'chrome://gpu 里确认 “WebGL” = Hardware accelerated（不是 Software only）',
        '本工具的渲染量不小（角色实验室同屏 6 个高模 + 动画），软件渲染下建议只开一个角色',
        '实在没有独显：把浏览器窗口调小、关掉动画、别开 GLB 导出（导出会一次性占满显存）',
      ],
      docs:'docs/gpu.md' };
  if(i.tier === 'gpu')
    return { level:'ok', title:'显卡正常（硬件加速）', detail:i.webgl + ' · ' + name,
      steps:['可以直接用全部功能（角色实验室同屏高模、GLB 导出）'], docs:'docs/gpu.md' };
  return { level:'unknown', title:'能用，但认不出是哪块显卡', detail:i.webgl + ' · ' + name,
    steps:['浏览器出于隐私把显卡型号藏了（常见于 Firefox）→ 用 chrome://gpu 看真实信息',
      '只要 chrome://gpu 显示 Hardware accelerated 就正常'], docs:'docs/gpu.md' };
}

export default Store;
