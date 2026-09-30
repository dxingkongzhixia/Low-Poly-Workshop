/* ============================================================================
   低模工坊 · 统一外壳脚本
   在任意页面引入 <script src="./shell.js" defer></script> 即可得到：
     · 顶部导航条（启动页 + 各工具页 + 三个信息页，当前页高亮）
     · 导航条右侧两个实时指示：**渲染显卡** 和 **当前接管的 AI Agent**
     · body.has-shell 让该页的固定面板自动让位（见 shell.css）

   导航条结构：
     低模工坊 │ 部件编辑器 角色实验室 换装室 模型导入 │ AI 工作流 系统状态 文档 │ …  ▣显卡  ⬒接管
     ↑ 品牌              ↑ 工具页（干活）                 ↑ 信息页              ↑ 实时状态（内联 SVG 图标）
   ========================================================================== */
(function () {
  /* 工具页：做模型 */
  var TOOLS = [
    ['character-editor.html', '部件编辑器',  '逐图元编辑 · 分区规则 · 刀切平面 · EditorAPI'],
    ['character-lab.html',    '角色实验室',  '14 低模 + 6 高模 + 新增模型 · 动画 · 调色 · 导出'],
    ['character-mixer.html',  '换装室',      '槽位混搭 · 跨角色部件互换'],
    ['model-import.html',     '模型导入',    '.vox / .glb / .gltf / .obj → 可编辑方块']
  ];
  /* 信息页：看流程 / 看状态 / 查文档 */
  var INFO = [
    ['ai-workflow.html', 'AI 工作流', 'AI 怎么接管 · 谁在接管 · 接口边界'],
    ['system.html',      '系统状态',  '显卡 / Agent 租约 / 临时缓存 / 新增模型'],
    ['docs.html',        '文档',      '按症状查 · 9 篇文档 · 文件地图']
  ];
  var ALL = TOOLS.concat(INFO);

  /* ---- 图标：内联 SVG，不用 emoji ------------------------------------------
     emoji 的颜色由系统字体写死（🎮 是深蓝灰、🤖 是深灰），放在深色导航条上发闷，
     而且没法跟着 chip 变绿变红。内联 SVG 用 stroke/fill="currentColor"，
     颜色自动跟着 chip 走（绿=正常 / 红=有问题 / 灰=空闲），任何时候都清楚。
     必须定义在 bar.innerHTML 之前，首帧就直接是图标，不会先闪一下占位文字。 */
  var ICON = {
    gpu: '<svg viewBox="0 0 16 16" aria-hidden="true">'
       + '<rect x="4.6" y="4.6" width="6.8" height="6.8" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.4"/>'
       + '<path d="M6.5 4.6V2.3M9.5 4.6V2.3M6.5 11.4v2.3M9.5 11.4v2.3M4.6 6.5H2.3M4.6 9.5H2.3M11.4 6.5h2.3M11.4 9.5h2.3"'
       + ' stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    gpuOff: '<svg viewBox="0 0 16 16" aria-hidden="true">'
       + '<rect x="4.6" y="4.6" width="6.8" height="6.8" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.4"/>'
       + '<path d="M6.5 4.6V2.3M9.5 4.6V2.3M6.5 11.4v2.3M9.5 11.4v2.3M4.6 6.5H2.3M11.4 6.5h2.3"'
       + ' stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'
       + '<path d="M2.7 13.3 13.3 2.7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    bot: '<svg viewBox="0 0 16 16" aria-hidden="true">'
       + '<rect x="2.7" y="5.2" width="10.6" height="7.8" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.4"/>'
       + '<path d="M8 5.2V3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'
       + '<circle cx="8" cy="2.4" r="1.2" fill="currentColor"/>'
       + '<circle cx="5.9" cy="9.1" r="1.25" fill="currentColor"/>'
       + '<circle cx="10.1" cy="9.1" r="1.25" fill="currentColor"/></svg>',
    plug: '<svg viewBox="0 0 16 16" aria-hidden="true">'
       + '<path d="M6 2.3v3.3M10 2.3v3.3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'
       + '<path d="M4.2 5.6h7.6v2.1a3.8 3.8 0 0 1-7.6 0z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>'
       + '<path d="M8 11.5v2.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'
  };

  var here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  if (here === '') here = 'index.html';
  var tip = '';
  for (var i = 0; i < ALL.length; i++) if (ALL[i][0] === here) tip = ALL[i][2];

  function link(t) {
    return '<a class="tab' + (t[0] === here ? ' on' : '') + '" href="' + t[0] + '" title="' + t[2] + '">' + t[1] + '</a>';
  }

  var bar = document.createElement('div');
  bar.id = 'shellbar';
  var html = '<a class="brand" href="index.html"><i>&#9632;</i>低模工坊</a>';
  for (var j = 0; j < TOOLS.length; j++) html += link(TOOLS[j]);
  html += '<span class="vsep"></span>';
  for (var k = 0; k < INFO.length; k++) html += link(INFO[k]).replace('class="tab', 'class="tab infotab');
  html += '<span class="spacer"></span>'
        + '<span class="hint">' + (tip ? '<b>' + tip + '</b>' : '<b>启动页</b> · 四个工具 + AI 工作流 / 系统状态 / 文档') + '</span>'
        + '<span class="tgl" id="shellTheme" role="button" tabindex="0" title="切换浅色 / 深色"></span>'
        + '<a class="chip" id="shellGpu" href="system.html" title="当前浏览器用哪块显卡跑 3D">' + ICON.gpu + '<span class="tx">检测中…</span></a>'
        + '<a class="chip" id="shellAgent" href="ai-workflow.html" title="当前接管生成流程的 AI Agent">' + ICON.bot + '<span class="tx">读取中…</span></a>';
  bar.innerHTML = html;

  /* ---------------------------------------------------------- 浅色 / 深色 --- */
  /* 主题的颜色全在 shell.css 的 :root / :root[data-theme="light"] 里。
     这里只管：读存下来的选择、切 <html data-theme>、换按钮图标。
     每个页面的 <head> 里有一行内联脚本会**先**套用一次，避免深→浅闪白。 */
  var THEME_KEY = 'lowpoly-theme';
  var T_SUN = '<svg viewBox="0 0 16 16" aria-hidden="true">'
    + '<circle cx="8" cy="8" r="3.1" fill="none" stroke="currentColor" stroke-width="1.5"/>'
    + '<path d="M8 1.2v1.9M8 12.9v1.9M1.2 8h1.9M12.9 8h1.9M3.2 3.2l1.35 1.35M11.45 11.45l1.35 1.35M12.8 3.2l-1.35 1.35M4.55 11.45 3.2 12.8"'
    + ' stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  var T_MOON = '<svg viewBox="0 0 16 16" aria-hidden="true">'
    + '<path d="M13.4 9.6A5.9 5.9 0 0 1 6.4 2.6a5.9 5.9 0 1 0 7 7z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';

  function themeNow(){
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }
  /** t: 'light' | 'dark'；save=true 时写 localStorage */
  function applyTheme(t, save){
    if(t === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    var b = document.getElementById('shellTheme');
    if(b){
      // 按钮画的是「点一下就变成的那个」
      b.innerHTML = (t === 'light' ? T_MOON : T_SUN);
      b.title = (t === 'light' ? '当前：浅色模式 —— 点击切到深色' : '当前：深色模式 —— 点击切到浅色');
      b.setAttribute('aria-label', b.title);
    }
    if(save){ try{ localStorage.setItem(THEME_KEY, t); }catch(e){} }
    // 页面（比如 3D 场景想跟着换底色）可以监听这个
    try{ dispatchEvent(new CustomEvent('themechange', { detail:{ theme:t } })); }catch(e){}
  }
  function bindTheme(){
    var b = document.getElementById('shellTheme');
    if(!b) return;
    var flip = function(){ applyTheme(themeNow() === 'light' ? 'dark' : 'light', true); };
    b.onclick = flip;
    /* 用 <span role=button> 是为了避开页面里通用的 `button{…}` 规则（撞车自查要求为 0），
       所以键盘可达性得自己补上 */
    b.onkeydown = function(e){
      if(e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar'){ e.preventDefault(); flip(); }
    };
    applyTheme(themeNow(), false);
  }

  function mount() {
    if (document.getElementById('shellbar')) return;
    document.body.classList.add('has-shell');
    document.body.insertBefore(bar, document.body.firstChild);
    bindTheme();
    paint();
  }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);

  /* ---------------------------------------------------------------- 实时状态 --- */
  /* 显卡型号太长，压成一眼能认的短名 */
  function shortGpu(r){
    var s = String(r || '');
    s = s.replace(/^ANGLE\s*\(\s*[^,]+,\s*/, '')                  // 去掉 "ANGLE (Google, "
         .replace(/,\s*D3D\d+.*$/i, '')                           // 去掉尾巴 ", D3D11)"
         .replace(/\s*\(0x[0-9a-f]+\)/ig, '')                     // 去掉 (0x000015BF)
         .replace(/\s+(Direct3D\d*|OpenGL|Metal|Vulkan|vs_\d+_\d+|ps_\d+_\d+)/ig, '')
         .replace(/\s*\)\s*$/, '')
         .replace(/\s+/g, ' ').trim();
    if(!s) return '未知显卡';
    return s.length > 26 ? s.slice(0, 25) + '…' : s;
  }

  var storeMod = null;
  function loadStore(){
    if(storeMod) return Promise.resolve(storeMod);
    return import('./characters.store.js').then(function (m) { storeMod = m; return m; });
  }

  function setChip(el, cls, icon, text, title){
    if(!el) return;
    el.className = 'chip' + (cls ? ' ' + cls : '');
    el.innerHTML = (icon || '') + '<span class="tx"></span>';
    el.lastChild.textContent = text;          /* 文本走 textContent，不拼 HTML */
    if(title) el.title = title;
  }

  function paint(){
    var gpuEl = document.getElementById('shellGpu');
    var agEl  = document.getElementById('shellAgent');

    loadStore().then(function (m) {
      /* ① 显卡（纯浏览器检测，不依赖服务器）*/
      try{
        var g = m.gpuInfo(), adv = m.gpuAdvice(g);
        var cls = adv.level === 'ok' ? 'ok' : adv.level === 'unknown' ? '' : 'warn';
        setChip(gpuEl, cls, g.supported ? ICON.gpu : ICON.gpuOff,
          g.supported ? shortGpu(g.renderer) : '无 WebGL',
          '渲染后端：' + (g.renderer || '未知') + '\n' + (g.webgl || '—') + ' · ' + adv.title
          + '\n' + adv.steps.join('\n') + '\n\n点一下去「系统状态」页看完整排查');
      }catch(e){ setChip(gpuEl, 'warn', ICON.gpuOff, '检测失败', String(e.message || e)); }

      /* ② Agent 接管（读服务端；服务器没起就标离线）*/
      return m.Store.getAgent();
    }).then(function (a) {
      if(!a) return;
      var occupying = !!a.occupying;
      if(occupying){
        setChip(agEl, 'ok', ICON.bot, a.agent,
          'AI Agent 接管中：' + a.agent + '\n' + (a.note || '（没有备注）')
          + '\n自 ' + new Date(a.since).toLocaleString()
          + ' · ' + a.ageMinutes + ' 分钟前有动作（租约 ' + a.ttlMinutes + ' 分钟）'
          + '\n\n点一下去「AI 工作流」页看接管规矩');
      }else if(a.agent && a.stale){
        setChip(agEl, 'warn', ICON.bot, a.agent + '（已退出）',
          (a.note2 || '超过租约没动静，已按退出处理') + '\n接管位是空的，新 Agent 可以登记');
      }else{
        setChip(agEl, '', ICON.bot, '未接管',
          '当前没有 AI Agent 接管\n把 docs/ai-workflow.md 交给一个 Agent，它会调 Store.setAgent(名字,备注) 登记\n点一下去「AI 工作流」页看怎么接管');
      }
    }).catch(function (e) {
      setChip(agEl, 'off', ICON.plug, '服务未启动',
        '连不上本地服务（_serve.js 没跑）：' + (e && e.message || e)
        + '\n\n双击 启动-低模工坊.bat 即可');
    });
  }

  /* 定时刷新 + 回到前台时立刻刷新（比如 Agent 刚登记/交还）*/
  setInterval(paint, 30000);
  addEventListener('focus', paint);
  document.addEventListener('visibilitychange', function () { if(!document.hidden) paint(); });
  addEventListener('storage', paint);
})();
