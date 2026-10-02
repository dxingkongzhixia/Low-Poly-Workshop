#!/usr/bin/env node
/* ============================================================================
 * selfcheck.js —— 低模工坊自检
 *
 *   node selfcheck.js            只跑静态 + 服务端（服务没起就跳过那部分）
 *   node selfcheck.js --quiet    只打印问题
 *
 * 检查什么：
 *   ① 所有 HTML 的 src/href、所有 JS 的 import 都指向真实存在的文件
 *   ② 没有「谁都没引用」的孤儿文件
 *   ③ 8 个页面都引了 shell.css / shell.js；docs.html 额外引 docs-viewer.js
 *   ④ 文档里的 EditorAPI 命令名 vs 代码里真实的命令名（双向）
 *   ⑤ 服务端：/api/* 冒烟 + 模型文件直链能不能访问
 *
 * **它查不出来的**（要在浏览器 Console 里跑，见 docs/development.md §9）：
 *   · CSS 类名撞车（#shellbar 被页面自己的样式污染）
 *   · 控制台报错 / 横向溢出 / 标签对齐
 *   这两个的片段在文档里，copy 一下就是。
 * ========================================================================== */
'use strict';
const fs = require('fs'), path = require('path');
// ★ 归类后：工作根目录 = 本文件上一级；页面在 pages/、共享 JS 在 src/、CSS 在 styles/
const ROOT = path.resolve(__dirname, '..');
const PAGES_DIR  = path.join(ROOT, 'pages');
const SRC_DIR    = path.join(ROOT, 'src');
const STYLES_DIR = path.join(ROOT, 'styles');
const TOOLS_DIR  = path.join(ROOT, 'tools');
const QUIET = process.argv.includes('--quiet');
const PORT = Number(process.env.PORT || 8765);
const BASE = 'http://localhost:' + PORT;

const PAGES = ['pages/index.html', 'pages/ai-workflow.html', 'pages/system.html', 'pages/docs.html',
  'pages/character-editor.html', 'pages/weapon-editor.html', 'pages/character-lab.html', 'pages/model-import.html'];

/* 本来就不该被页面引用的元文件 / 工具脚本 —— 别把它们报成孤儿 */
const META_FILES = new Set(['selfcheck.js', '_serve.js', 'README.md', '低模工坊-制作流程笔记.md',
  '发布到GitHub.bat', '启动-低模工坊.bat']);

const problems = [], notes = [];
const ok = m => { if(!QUIET) console.log('  \u2714 ' + m); };
const bad = m => { problems.push(m); console.log('  \u2718 ' + m); };
const head = m => { if(!QUIET) console.log('\n' + m); };

/* ------------------------------------------------------------ ① 引用完整性 --- */
head('① 引用完整性');
{
  const files = [];
  for(const [d, re] of [[PAGES_DIR, /\.html$/], [SRC_DIR, /\.js$/], [STYLES_DIR, /\.css$/]])
    if(fs.existsSync(d)) for(const f of fs.readdirSync(d)) if(re.test(f)) files.push(path.join(d, f));
  const RE_ATTR = /(?:src|href)\s*=\s*["']([^"']+)["']/g;
  const RE_IMPORT = /(?:import\s+(?:[^'"]*?\sfrom\s+)?|import\s*\()\s*["']([^"']+)["']/g;
  let checked = 0, missing = 0;
  for(const fp of files){
    const txt = fs.readFileSync(fp, 'utf8');
    const short = path.relative(ROOT, fp).replace(/\\/g, '/');
    const re = fp.endsWith('.js') ? RE_IMPORT : RE_ATTR;
    re.lastIndex = 0; let m;
    while((m = re.exec(txt))){
      const v = m[1];
      if(/^(https?:|data:|mailto:|#|javascript:)/.test(v)) continue;   // 外链 / 锚点
      if(/\$\{/.test(v)) continue;                                     // JS 模板串
      // 裸模块名（`three` / `three/addons/…`）由页面的 <script type="importmap"> 解析，不是磁盘路径
      if(!/^[./]/.test(v)) continue;
      const rel = v.split('#')[0].split('?')[0];
      if(!rel) continue;
      checked++;
      // ★ 相对引用按「所在文件目录」解析（页面搬到 pages/ 之后必须这样算）
      const target = rel.startsWith('/') ? path.join(ROOT, decodeURIComponent(rel))
                                         : path.resolve(path.dirname(fp), decodeURIComponent(rel));
      if(!fs.existsSync(target)){ missing++; bad(short + ' → 目标不存在: ' + v); }
    }
  }
  if(!missing) ok('检查了 ' + checked + ' 个引用，全部存在');
}
/* ★ 资源引用必须是「根绝对」或「../」——页面在 pages/ 下，裸相对路径会指错目录（踩过：图片全挂） */
{
  const RE_ATTR = /(?:src|href)\s*=\s*["']([^"']+)["']/g;
  const ASSET = /\.(?:png|jpe?g|webp|gif|svg|ico|css|js|json|glb|gltf|obj|vox|md)$/i;
  let bads = [];
  for(const f of fs.existsSync(PAGES_DIR) ? fs.readdirSync(PAGES_DIR).filter(x => x.endsWith('.html')) : []){
    const t = fs.readFileSync(path.join(PAGES_DIR, f), 'utf8');
    RE_ATTR.lastIndex = 0; let m;
    while((m = RE_ATTR.exec(t))){
      const v = m[1];
      if(/^(https?:|data:|mailto:|#|javascript:|\/|\.\.?\/)/.test(v)) continue;   // 外链/锚点/根绝对/./ ../ → 合格
      if(/\$\{/.test(v)) continue;
      if(/^pages\//.test(v)){ bads.push(f + ' → ' + v + '（页面彼此是同目录，导航应该用裸文件名）'); continue; }
      if(!ASSET.test(v)) continue;                                        // 页面间导航（*.html）同目录，允许
      bads.push(f + ' → ' + v);
    }
  }
  if(bads.length) bad('页面里有 ' + bads.length + ' 个会指错目录的引用（页面在 pages/ 下）: '
    + bads.slice(0, 4).join(' · ') + (bads.length > 4 ? ' …' : ''));
  else ok('页面里的引用都指向正确目录（资源用 / 绝对，页间导航用裸名）');
}
{
  const all = [];
  for(const d of [ROOT, PAGES_DIR, SRC_DIR, STYLES_DIR, TOOLS_DIR]){
    if(!fs.existsSync(d)) continue;
    for(const f of fs.readdirSync(d)){
      const st = fs.statSync(path.join(d, f));
      if(!st.isDirectory() && /\.(html|js|css|md)$/.test(f))
        all.push({ f, p: path.join(d, f), txt: fs.readFileSync(path.join(d, f), 'utf8') });
    }
  }
  const orphans = all.filter(o => {
    if(o.f.startsWith('.')) return false;
    if(META_FILES.has(o.f)) return false;
    return !all.some(x => x !== o && x.txt.includes(o.f));
  }).map(o => path.relative(ROOT, o.p).replace(/\\/g, '/'));
  if(orphans.length) notes.push('没人引用的文件（可能是死文件）: ' + orphans.join(', '));
  else ok('没有孤儿文件');
}

/* --------------------------------------------------------- ② 页面外壳引用 --- */
head('② 页面外壳');
{
  let bad0 = 0;
  for(const p of PAGES){
    const f = path.join(ROOT, p);
    if(!fs.existsSync(f)){ bad('页面不存在: ' + p); bad0++; continue; }
    const t = fs.readFileSync(f, 'utf8');
    if(!/shell\.css/.test(t)){ bad(p + ' 没有引 shell.css（导航条会没样式）'); bad0++; }
    if(!/shell\.js/.test(t)){ bad(p + ' 没有引 shell.js（不会有导航条）'); bad0++; }
    if(p === 'docs.html' && !/docs-viewer\.js/.test(t)){ bad(p + ' 没有引 docs-viewer.js'); bad0++; }
  }
  if(!bad0) ok(PAGES.length + ' 个页面都引了 shell.css + shell.js');
}

/* ------------------------------------------------- ③ 文档 vs EditorAPI 命令 --- */
head('③ 文档 vs EditorAPI');
let apiCommands = null;
{
  // 从编辑器里把 EditorAPI 的方法名抠出来（对象字面量的 `name(` 形式）
  const t = fs.readFileSync(path.join(PAGES_DIR, 'character-editor.html'), 'utf8');
  const start = t.indexOf('const EditorAPI = {');
  const end = t.indexOf('\nwindow.EditorAPI', start);
  apiCommands = new Set();
  if(start > 0 && end > start){
    const body = t.slice(start, end);
    // 成员可能是 `name(` / `async name(` / `name:` —— 只认「2 空格缩进 + 名字」的行首成员，
    // 并排掉 JS 关键字，免得抓到对象体里的 for/if 之类
    const KW = new Set(['for','if','while','switch','return','function','catch','else','do','try','const','let','var','new','typeof','await']);
    const NOT_A_CMD = new Set(['version']);        // 对象里的非函数成员
    for(const m of body.matchAll(/^  (?:async\s+|get\s+|set\s+)?([a-zA-Z_$][A-Za-z0-9_$]*)\s*[(:]/gm)){
      if(!KW.has(m[1]) && !NOT_A_CMD.has(m[1])) apiCommands.add(m[1]);
    }
  }
  if(!apiCommands.size){ notes.push('没能从 character-editor.html 抠出 EditorAPI 命令名（结构变了？）'); }
  else {
    const md = fs.readFileSync(path.join(ROOT, 'docs', 'editor-api.md'), 'utf8');
    const documented = new Set([...md.matchAll(/EditorAPI\.([A-Za-z]\w*)/g)].map(m => m[1]));
    for(const m of md.matchAll(/`([a-zA-Z][A-Za-z0-9_]*)\(/g)) documented.add(m[1]);
    const undoc = [...apiCommands].filter(k => !documented.has(k)).sort();
    if(undoc.length) bad('editor-api.md 没写的命令 (' + undoc.length + '): ' + undoc.join(', '));
    else ok('editor-api.md 覆盖了全部 ' + apiCommands.size + ' 个命令');
    // 反向：文档提到的「看起来像命令」却没实现的（会有一堆字段名误报，只报明显的）
    const phantom = [...documented].filter(k => !apiCommands.has(k) && /^[a-z][a-zA-Z]{3,}$/.test(k)
      && !['await','from','error','errors','warnings','count','width','height','scale','size','color',
           'material','palette','planes','groups','radius','length','thick','spread','strands','seed',
           'shell','depth','shape','points','tris','kind','mesh','prim','spec','rig','role','side'].includes(k));
    if(phantom.length) notes.push('文档里提到但编辑器里没有的（可能是内部函数或字段名）: ' + phantom.join(', '));
  }
}

/* ----------------------------------------------------------- ③.5 主题卫生 --- */
head('③ 主题');
{
  const NEUTRAL = /^#(fff|ffffff|000|000000|111|111111)$/i;
  let bads = 0;
  for(const p of PAGES){
    const t = fs.readFileSync(path.join(ROOT, p), 'utf8');
    /* a) 防闪脚本必须在 shell.css **之前** */
    const cssIdx = t.search(/<link[^>]*shell\.css/i);
    const guardIdx = t.search(/lowpoly-theme/);
    if(guardIdx < 0){ bad(p + ' 缺防闪脚本（<head> 里要在 shell.css 之前套用 data-theme）'); bads++; }
    else if(guardIdx > cssIdx){ bad(p + ' 防闪脚本排在 shell.css 之后了，会闪一下深色'); bads++; }
    /* b) <style> 块里的硬编码颜色 */
    const hard = new Set();
    for(const m of t.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g))
      for(const c of (m[1].match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) || []))
        if(!NEUTRAL.test(c)) hard.add(c);
    if(hard.size){ bad(p + ' <style> 里有写死的颜色: ' + [...hard].slice(0, 5).join(' ')); bads++; }
    /* c) JS 里的写死颜色：**只看真正在设置样式的行**（逐行判断，不跨行结转）
     *    涵盖 el.style.x= / style.cssText= / innerHTML 里的 style="…" / canvas 的 ctx.fillStyle=
     *    排除：`opts.color || '#8d979c'` 这种**数据默认值**，它不是样式 */
    const RE_STYLE_LINE = /\.style\.[a-zA-Z]+\s*=|cssText|style\s*=\s*["']|ctx\.(?:fill|stroke)Style\s*=/;
    let jsHard = 0;
    for(const ln of t.split('\n')){
      if(!RE_STYLE_LINE.test(ln)) continue;
      if(/themeColor\(/.test(ln)) continue;                  // 已经走变量读取
      for(const c of (ln.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) || []))
        if(!NEUTRAL.test(c)) jsHard++;
    }
    if(jsHard){ bad(p + ' JS 里有 ' + jsHard + ' 个写死的样式颜色（浅色模式会露馅）'); bads++; }
  }
  /* d) 外部样式表 */
  for(const f of (fs.existsSync(STYLES_DIR) ? fs.readdirSync(STYLES_DIR).filter(x => /\.css$/.test(x) && x !== 'shell.css') : [])){
    const hard = [...new Set((fs.readFileSync(path.join(STYLES_DIR, f), 'utf8')
      .match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) || []))].filter(c => !NEUTRAL.test(c));
    if(hard.length){ bad(f + ' 里有写死的颜色: ' + hard.slice(0, 5).join(' ')); bads++; }
  }
  if(!bads) ok(PAGES.length + ' 个页面：防闪脚本就位 · 没有写死的颜色（深浅两套都能用）');
}

/* ------------------------------------------------------------ ④ 服务端冒烟 --- */
head('④ 服务端');
(async () => {
  let up = false;
  try{ const r = await fetch(BASE + '/api/index'); up = r.ok; }catch(e){ up = false; }
  if(!up){
    notes.push('服务端没起（node _serve.js）—— 跳过 API 冒烟。ES module 页面也打不开，先起服务。');
  }else{
    const cases = [
      ['GET', '/api/index', 200], ['GET', '/api/characters', 200], ['GET', '/api/store', 200],
      ['GET', '/api/models', 200], ['GET', '/api/cache', 200], ['GET', '/api/agent', 200],
      ['GET', '/api/nonesuch', 404], ['GET', '/api/models/__nope__', 404],
    ];
    let fail = 0;
    for(const [m, p, want] of cases){
      let code = 0;
      try{ code = (await fetch(BASE + p)).status; }catch(e){ code = -1; }
      if(code !== want){ bad(m + ' ' + p + ' → ' + code + '（期望 ' + want + '）'); fail++; }
    }
    // 模型文件直链
    try{
      const list = await (await fetch(BASE + '/api/models')).json();
      const one = (list.confirmed || [])[0] || (list.temporary || [])[0];
      if(one){
        const b = await (await fetch(BASE + '/api/models/' + encodeURIComponent(one.id) + '/bundle')).json();
        if(!b.ok) { bad('bundle 接口对 ' + one.id + ' 返回 not-ok'); fail++; }
        else {
          for(const [k, u] of Object.entries(b.urls || {})){
            if(!u) continue;
            const r = await fetch(BASE + u);
            if(!r.ok){ bad('模型直链打不开: ' + u + ' → ' + r.status); fail++; }
          }
          if(!b.spec) { bad(one.id + ' 的 bundle 里没有 spec'); fail++; }
        }
      }else{ notes.push('两个模型目录都是空的，跳过了模型文件直链检查'); }
    }catch(e){ bad('模型文件检查异常: ' + (e.message || e)); fail++; }

    if(!fail) ok(cases.length + ' 个端点状态码都对；模型文件直链可访问');
    const ch = await (await fetch(BASE + '/api/characters')).json();
    if(ch.low && ch.low.length === 14 && ch.high && ch.high.length === 3)
      ok('角色索引：低模 14 + 高模 3（' + ch.high.map(h => h.id + ':' + h.variants.length).join(' ') + '）');
    else notes.push('角色索引看着不全（低模 ' + ((ch.low || []).length) + ' / 高模 ' + ((ch.high || []).length) +
      '）—— 打开一次角色实验室，或调 EditorAPI.exportCharacterIndex()');
  }

  /* --------------------------------------------------------------- 汇总 --- */
  console.log('\n' + '─'.repeat(60));
  if(notes.length){ console.log('提示：'); notes.forEach(n => console.log('  · ' + n)); }
  if(problems.length){ console.log('\n发现问题 ' + problems.length + ' 个：'); problems.forEach(p => console.log('  ✘ ' + p)); process.exit(1); }
  else console.log('全部通过 ✔    （CSS 撞车 / 控制台报错 仍需在浏览器里看一眼：docs/development.md §9.3）');
})();
