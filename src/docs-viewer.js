/* ============================================================================
 * docs-viewer.js —— 极简 Markdown 渲染器（**不依赖任何外部库/网络**）
 *
 * 为什么自己写：
 *   · 这套工具承诺「无需联网即可运行」，不该为了看文档去拉一个 CDN 的 markdown 库
 *   · 我们的文档只用到一个很小的 markdown 子集，够用就行
 *
 * ★ 重要：本文件只负责「给人看」。**AI 读的还是 docs/*.md 原始文件**，
 *   原始 md 一个字都没改，随时可以 fetch。
 *
 * 支持：# ## ### #### / --- / > 引用 / - * 无序 / 1. 有序 / ``` 代码块 /
 *       | 表格 | / 行内 `code` **粗** *斜* [链接](url) / 段落
 * ========================================================================== */

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* 行内标记 */
function inline(s){
  let t = esc(s);
  // 行内代码先抽出来（避免里面的 * 被当强调）
  const codes = [];
  t = t.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
  // 链接：.md → 文档阅读器锚点；其它原样
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, txt, href) => {
    let h = href.trim();
    if(/\.md$/i.test(h)) h = '#' + h.split('/').pop().replace(/\.md$/i, '');
    const raw = /\.md$/i.test(href.trim()) ? '' : ' target="_blank" rel="noopener"';
    if(/^https?:/i.test(h)) return `<a href="${h}"${raw}>${txt}</a>`;
    return `<a href="${h}"${raw}>${txt}</a>`;
  });
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
  t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => '<code>' + codes[+i] + '</code>');
  return t;
}

/* 主渲染 */
export function mdToHtml(src){
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const listStack = [];               // 用于有序/无序列表嵌套
  const closeLists = n => { while(listStack.length > (n || 0)) out.push('</' + listStack.pop() + '>'); };

  while(i < lines.length){
    const ln = lines[i];

    /* 代码块 */
    const fence = /^\s*```(\w*)\s*$/.exec(ln);
    if(fence){
      closeLists();
      const buf = [];
      i++;
      while(i < lines.length && !/^\s*```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;
      const lang = fence[1] ? ` data-lang="${esc(fence[1])}"` : '';
      out.push(`<pre class="code"${lang}><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }

    /* 表格：当前行有 | 且下一行是分隔行 */
    if(/\|/.test(ln) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i+1]) && /-/.test(lines[i+1])){
      closeLists();
      const cells = r => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(s => s.trim());
      const head = cells(ln);
      i += 2;
      const body = [];
      while(i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) body.push(cells(lines[i++]));
      out.push('<div class="tblwrap"><table class="tbl"><thead><tr>'
        + head.map(h => '<th>' + inline(h) + '</th>').join('')
        + '</tr></thead><tbody>'
        + body.map(r => '<tr>' + head.map((_, k) => '<td>' + inline(r[k] ?? '') + '</td>').join('') + '</tr>').join('')
        + '</tbody></table></div>');
      continue;
    }

    /* 标题 */
    const h = /^(#{1,6})\s+(.*)$/.exec(ln);
    if(h){
      closeLists();
      const lv = h[1].length;
      const txt = inline(h[2]).replace(/\s*#+\s*$/, '');
      const slug = h[2].toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
      out.push(`<h${lv} id="${slug}">${txt}</h${lv}>`);
      i++;
      continue;
    }

    /* 分隔线 */
    if(/^\s*(-{3,}|\*{3,})\s*$/.test(ln)){ closeLists(); out.push('<hr>'); i++; continue; }

    /* 引用 */
    if(/^\s*>\s?/.test(ln)){
      closeLists();
      const buf = [];
      while(i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push('<blockquote>' + mdToHtml(buf.join('\n')) + '</blockquote>');
      continue;
    }

    /* 列表 */
    const ul = /^(\s*)([-*+])\s+(.*)$/.exec(ln);
    const ol = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(ln);
    if(ul || ol){
      const depth = Math.floor((ul ? ul[1] : ol[1]).length / 2);
      const tag = ul ? 'ul' : 'ol';
      while(listStack.length > depth + 1) out.push('</' + listStack.pop() + '>');
      if(listStack.length < depth + 1){ out.push('<' + tag + '>'); listStack.push(tag); }
      else if(listStack[listStack.length - 1] !== tag){ out.push('</' + listStack.pop() + '>'); out.push('<' + tag + '>'); listStack.push(tag); }
      out.push('<li>' + inline((ul ? ul[3] : ol[3])) + '</li>');
      i++;
      continue;
    }
    closeLists();

    /* 空行 */
    if(!ln.trim()){ i++; continue; }

    /* 段落（连续非空行合并） */
    const buf = [];
    while(i < lines.length && lines[i].trim()
      && !/^\s*```/.test(lines[i]) && !/^(#{1,6})\s/.test(lines[i])
      && !/^\s*>\s?/.test(lines[i]) && !/^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i])
      && !/^\s*(-{3,}|\*{3,})\s*$/.test(lines[i])) buf.push(lines[i++]);
    out.push('<p>' + inline(buf.join('\n')).replace(/\n/g, '<br>') + '</p>');
  }
  closeLists();
  return out.join('\n');
}

/* 目录（从正文抽 #/##/###） */
export function mdOutline(src){
  const out = [];
  for(const ln of String(src).replace(/\r\n?/g, '\n').split('\n')){
    const m = /^(#{1,3})\s+(.*)$/.exec(ln);
    if(!m) continue;
    const txt = m[2].replace(/\s*#+\s*$/, '');
    out.push({ level: m[1].length, text: txt,
      slug: txt.toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) });
  }
  return out;
}

export default { mdToHtml, mdOutline };
