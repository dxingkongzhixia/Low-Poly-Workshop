# 故障排查 —— 按症状查

> 先看 [`README.md`](README.md) §1 的「按症状查」表。这一篇是详细版。

---

## 1. 页面打不开 / 白屏 / 404

| 现象 | 原因 | 解决 |
|---|---|---|
| 双击 html 白屏、Console 报 `Failed to load module` | ES module 在 `file://` 下被 CORS 拦 | 必须先 `node tools/_serve.js`，用 `http://localhost:8765/` 打开 |
| `http://localhost:8765/` 404 | 服务器没跑在项目根目录 | `cd` 到仓库根（含 `tools/`）再 `node tools/_serve.js` |
| 首页正常，子页 404 | 文件被移走过 | 页面都在 `pages/` 下：`character-editor.html` / `character-lab.html` / `weapon-editor.html` / `model-import.html` |
| Console 报 `import ... from 'three'` 失败 | 页面 importmap 解析不到 | three 已**本地化**在 `vendor/three/` —— 检查它在不在（自检 `node tools/selfcheck.js`）；确认页面 importmap 指向 `/vendor/three/...` |

---

## 2. 卡 / 黑屏 / 转不动

→ 看 [`gpu.md`](gpu.md)。一句话：主界面「系统状态 → 显卡」会告诉你是不是软件渲染，
软件渲染就按 `gpu.md` §3 降级。

---

## 3. 质量门报错看不懂

**先记住**：`verdict` 有三态，`unevaluated` **不是通过**。

| 门报的话 | 真实意思 | 怎么办 |
|---|---|---|
| `silhouette: iou=0.54（需 ≥ 0.72）` | 剪影对不上。0.72 是 `structure` 遍的门槛 | 检查比例：用 `data/reference-models.json` 里对应角色的 rig 当基准；`boxify` 一个原作角色拿真实包围盒 |
| `silhouette: aspect-delta=0.68` | 宽高比差太多 | 多半是**参考图是多视图拼版**。先 `admit()` 看 `detectedViews`，再 `refCrop({index:1})` 切一屏 |
| `silhouette: 参考图里有 3 个分离的视图…` | 同上，门主动拒绝算 | 同上；不切的话数字是噪声 |
| `turntable: 有视图没被清晰分离` | 某个方位的**前景被切成了好几块**（部件没连上） | 常见原因：手臂没伸进肩里、大腿没伸进胯里。用 `describe(id)` 看包围盒，确认相邻件在**三个轴上都重叠** |
| `turntable: 面积塌缩（<15%）` | 那个角度几乎是纸片 | 侧面太薄了 |
| `turntable: 轮廓内部有洞` | 破面 / 部件缺失 | 检查该方位看到的部件 |
| `chirality: L.x=+0.30 R.x=-0.28 之和=0.02` | 左右不是镜像 | 用 `mirrorPair(id)` 重建孪生，别手工填负号（绕 y/z 的旋转也要取反） |
| `seam: 重叠厚度 0.013 < 0.02` | 部件悬空 | 把两件的重叠做到 ≥0.02 世界单位 |
| `clearance: 87% 采样点在宿主内部` | 整件几乎全埋进去了（看不见） | 那件挪出去。**注意 40~60% 埋入是正常的**（发根本来就埋在头骨里） |
| `scalp: 头皮有 12% 露出来了（上限 5%）` | **秃斑** —— 这是头发真正的判据 | 加发束/加宽主帽把它盖住。`scalpGate` 会给出示例点坐标 |
| `penetration: 左臂 穿进 左腿 13%` | 真穿模（>10%） | 把大腿收窄或手臂外移；<10% 的压叠属正常连接，只 warning |
| `interior-difference: 还没有基线图` | 第一次跑，已自动把当前帧存成基线 | 改完再跑一次就能看到内部差异 |

---

## 4. 流水线 / 硬停

| 现象 | 意思 | 怎么办 |
|---|---|---|
| `pipeline().status === 'stopped'` | **硬停**：同一遍修正 3 次或总计 6 次 | 停下来问用户，别继续、别自己 reset。`pipelineReset()` 只在用户同意后用 |
| `必须按顺序：当前该做的是 X，不是 Y` | 跳步了 | 按 `pipeline().currentStep` 走 |
| `标记 done 必须带 evidence` | 想空手通过 | 补证据（部件 id 列表 / 截图名 / gate 报告） |
| `continue 要求分数 ≥ 0.7` | 分数不够 | 用 `refine-code` 或 `refine-spec` |
| `pipeline()` 说 `status:'complete'` | 27 步走完了 | 去 `export` |

---

## 5. 保存 / 缓存 / Agent 不工作

| 现象 | 原因 | 解决 |
|---|---|---|
| 「连不上本地服务」 | `tools/_serve.js` 没跑 | 见 [`gpu.md`](gpu.md) §4 |
| 随机 `HTTP 502` | 服务器有 body 没读干，污染了 keep-alive 连接 | 已修（`tools/_serve.js` 对所有 POST/DELETE 无条件读 body）。如果自己改过服务器，注意这一点 |
| 保存后文件好几 MB | 缩略图 dataURL 被写进了 `model.json` | 已修：缩略图落盘成 `thumb.png`。老文件可以手工删掉 `"thumb": "data:image..."` 那个字段 |
| `saveModel` 很慢（>1s） | 在截大视口 + 导出整个 spec 的 JS | 关掉 `withThumb:false`；或者先 `render({pass:true,size:512})` 再存 |
| `confirmModel` 失败 | id 不在临时区 | 先 `listStoredModels()` 看 `temporary` 里有没有 |

---

## 6. 新增模型在实验室里看不到

1. **它不在「干员」列表里** —— 那是原作 14 人。去「**新增模型**」分区（独立，避免数据污染）。
2. 点「刷新列表」；或者主界面「系统状态 → 新增模型」看是不是 **0**。
3. 如果是 0：去编辑器「保存 · 新增模型」→「存为新增模型」。
4. 按钮能点但载入失败：多半是**没存 `model.js`**。
   提示原文：`这个模型只存了规格（spec），没有 model.js 工厂`。
   重新存一次，别关 `withJs`。
5. 载入报 `model.js 里找不到 build_xxx 工厂函数`：文件被手工改坏了 —— 重新导出。

---

## 7. 编辑器里改不动 / 改错

| 现象 | 原因 | 解决 |
|---|---|---|
| 点不到某个图元 | 它被隐藏了（`boxify` 会藏原作的基础网格） | 「显示全部基础网格」；或者用 `state().skippedHiddenMeshes` 看被跳过了哪些 |
| 改了颜色没反应 | `op` 图元的 `color:null` 表示"用原始顶点色" | 给了值才会覆盖 |
| 撤销栈爆了 | `undo` 上限 60 步 | 大改动分几次做，中途 `saveModel` |
| `boxify` 之后部件名很乱 | 按分区规则自动命名的 | 用「分区规则」面板调，或者 `zonesFromSelection('名字')` 按选中图元自动建规则 |

---

## 8. 面板里一大片空白 / 导航条标签被压扁

**两个症状，两个不同的 CSS 撞车。**改 `styles/shell.css` 或 `src/shell.js` 时最容易踩。

### 8.1 工具页侧栏「正文区」只占一小截，下面一大片空

| 现象 | 原因 | 解决 |
|---|---|---|
| `部件编辑器` / `武器编辑器` 左、右面板的列表只显示到一半就断，下面全是空的，右侧还挤出一根很短的滚动条 | `styles/shell.css` 里有一条 `.scroll{max-height:220px}`，而 editor / mixer 的 `.scroll` 是「面板里可滚动的正文区」（`.scroll{overflow:auto;flex:1}`）。**`styles/shell.css` 是在页面自己的 `<style>` 之后加载的**，同优先级直接盖掉 | 已修：`styles/shell.css` 里的 `.scroll` 已删除。各页自己定义自己的 `.scroll`，`styles/shell.css` 不要放这种「看似通用的工具类」 |

自查命令（在页面 Console 里）：

```js
[...document.querySelectorAll('.scroll')].map(e => ({
  面板: e.parentElement.id || e.parentElement.className,
  正文高: e.clientHeight, 面板高: e.parentElement.clientHeight, 应有: e.scrollHeight
}))
// 正文高应该 ≈ 面板高 - 头部高度；如果是 220 左右就是又被限高了
```

### 8.2 导航条上「AI 工作流 / 系统状态 / 文档」比别的标签高、还被压窄

| 现象 | 原因 | 解决 |
|---|---|---|
| 这三个标签比左边 4 个**高一截**、宽度被压扁（文字挤在一起），在「模型导入」页甚至多出一个边框和背景色；几个页面偏移量还不一样（5px / 7px） | 导航条这三个 `<a>` 原本是 `class="tab sec"`，而 **4 个工具页自己都有一个通用的 `.sec`**（面板里的小区块：`border` + `margin-bottom` + `overflow:hidden`）。类名撞车 → 导航条标签被当成面板区块排版 | 已修：类名改成 `infotab`，并在 `.tab` 上加 `flex:none` 防止被压缩 |

> **教训**：`src/shell.js` 注入的 DOM 里，类名必须足够独特。`sec` / `scroll` / `card` / `panel` 这种「短又通用」的名字，工具页几乎一定也在用。
> 改完之后用下面这段自查，**撞车数必须是 0**：

```js
const bar = document.getElementById('shellbar'); const bad = [];
for (const el of bar.querySelectorAll('*'))
  for (const sh of document.styleSheets) {
    if (sh.href && sh.href.includes('styles/shell.css')) continue;      // 只看页面自己的样式
    let rules; try { rules = sh.cssRules } catch (e) { continue }
    for (const r of rules) {
      if (!r.selectorText || r.selectorText.includes('shellbar')) continue;
      let hit = false; try { hit = el.matches(r.selectorText) } catch (e) {}
      if (hit && (r.style.overflow || r.style.marginBottom || r.style.background))
        bad.push(el.className + ' ← ' + r.selectorText);
    }
  }
console.log('撞车数', bad.length, bad);
```

### 8.3 切了浅色模式，某一块还是深色的

| 现象 | 原因 | 解决 |
|---|---|---|
| 浅色模式下某个面板 / 按钮 / 提示框还是深色，或者文字变成白底白字看不见 | 那一处的颜色**写死了**（没走 `styles/shell.css` 的语义变量）。两种写法都会漏：页面 `<style>` 里的 `#1f3846`，和 **JS 里拼的内联样式** `el.style.cssText='background:#16252e'` | 改成 `var(--panel)` / `var(--deep)` 之类的变量。用 [`development.md`](development.md) §9.5 的脚本扫一遍，**深底和浅字都要是 0** |
| 刚打开页面时先闪一下深色再变浅色 | 页面 `<head>` 里那行防闪内联脚本被删了（它要在样式生效前就把 `data-theme` 套上） | 每个页面 `<link ... styles/shell.css>` **之前**必须有：`<script>try{if(localStorage.getItem('lowpoly-theme')==='light')document.documentElement.setAttribute('data-theme','light')}catch(e){}</script>` |
| 点了圆按钮没反应 | `src/shell.js` 里 `bindTheme()` 没被 `mount()` 调到，或 `#shellTheme` 没渲染出来 | 检查 `src/shell.js` 的 `mount()` 里有没有 `bindTheme()` |
| 圆按钮被压扁 / 变成方角 | 它应该是 `<span role="button">` 而不是 `<button>`；用 `<button>` 会被工具页的通用 `button{…}` 规则命中 | 见 [`development.md`](development.md) §6.2 |
| 想换回深色 | — | 点导航条最右边那个圆按钮；或 `localStorage.removeItem('lowpoly-theme')` 后刷新 |

> **给 3D 视口说一句**：4 个工具页的 `scene.background` 都是中灰 `0xa9b4ba`，两套主题下都合适，
> **故意不跟着切**。所以「浅色模式下 3D 视口还是灰的」不是 bug。

### 8.4 骨架比例滑块拖了没反应 / 模型变成「头掉到脚上」

| 现象 | 原因 | 解决 |
|---|---|---|
| 拖「骨架比例」的滑块，**数字变了但模型纹丝不动** | 面板曾经只写 `spec.rig.headY` 这类**旧扁平字段**，而 `applyRig()` 一见 `groups` 就 `return`（第一次 build 之后每个规格都有 groups） | 已修：面板改走 `rigSet()`，它 `groups` + 扁平字段**一起写**。同类问题还在 `setRig()` / `variantSpec()` 里，也一并修了 —— 见 [`development.md`](development.md) §6.14 |
| 打开面板时**显示的数字和真实骨架对不上**（比如 `armX 0.51` 而实际是 `0.36`） | 面板是在第一次 `build()`（会跑 `measureRig()`）**之前**建好的，读到的是 `laplandSpec()` 的模板默认值 | 已修：面板挂了刷新器，`build()` 一跑就同步 |
| `setRig(ref.rig)` 抄了别的角色比例，模型没变 | 同上（只写扁平字段） | 已修：`setRig` 走 `rigMerge()`，会把旧格式搬到 `groups` |
| `variantSpec()` 出来的变体**头掉到脚上**、腿插进地面 | 两个约束求解（腿长 / 头座位）依赖**可测量的 box/geo 图元**；`boxify()` 出来的 `op` 图元量不到也缩不了 → `torsoTopOf()=0` → `headY` 只剩 `0.04×headScaleY≈0.07` | 已修：这种情况退化成「只按比例挪骨架」，返回里带 `warn`。**想真正改体型请从「通用体型」预设出发**（它全是 box 图元） |

**自查**：改完骨架后对比「滑块显示值」和「规格里的值」——两者应该一致：

```js
const G = window.__ed.built.G;                 // 真实骨架
EditorAPI.getSpec().rig.groups.head.p          // 规格里的权威值
// 用 EditorAPI.setRig({ armY: 1.2 }) 改 → 上面两个都要跟着变
```

---

## 9. 还是不行

在编辑器 Console 里收集这三样，一起贴出来：

```js
EditorAPI.state()          // 当前规格概况
EditorAPI.gpu()            // 显卡
await EditorAPI.pipeline() // 流水线状态（如果是 AI 流程问题）
```

再看浏览器 Console 有没有红色报错；有的话连同**第一行**一起贴。
