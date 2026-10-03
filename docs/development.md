# 代码开发文档 —— 低模工坊

> 面向**改这套代码的人**（和要理解它再动手的 AI）。
> 用户文档看 [`README.md`](README.md)；AI 干活看 [`ai-workflow.md`](ai-workflow.md) / [`ai-pipeline.md`](ai-pipeline.md)。
>
> **改任何东西之前先读 §6「关键不变量」** —— 这个项目几乎所有的坑都在那儿。

---

## 1. 这是什么

从 Bilibili 游戏《企鹅物流·未登记访客》的 three.js bundle 里**逐字提取**出低模角色生成器，
做成一套本地工具：**拆分 · 调色 · 混搭 · 导入**，全部由同一个「命名部件 + 四种图元」的规格驱动。

三个设计目标，决定了很多看起来奇怪的设计：

| 目标 | 导致的设计 |
|---|---|
| **保真** —— 不重画，用原作的几何 | `boxify()` 按 `geometry.userData.primitiveVertexCounts` 精确切图元（**不是** AABB 近似） |
| **一份模型代码，四个工具共用** | 规格 `spec` 是唯一的真源；编辑器/实验室/武器编辑器/导入页都读它 |
| **能被 AI Agent 驱动** | 所有能力都挂在 `window.EditorAPI`（108 个命令），有 `pipeline()` 状态机 + 8 个质量门 |

**没有构建步骤。** 没有 npm、没有打包器、没有 TypeScript。浏览器直接吃 ES module，
`node tools/_serve.js` 就是全部基础设施。

---

## 2. 分层架构

```
┌───────────────────────────── 浏览器（8 个页面，全静态 ES module）─────────────────────────────┐
│                                                                                              │
│  src/shell.js / styles/shell.css  ── 注入统一导航条（TOOLS + INFO 两组）+ 显卡/Agent 实时 chip             │
│                                                                                              │
│  ┌── 页面层 ───────────────────────────────────────────────────────────────────────────────┐ │
│  │ pages/index.html          启动页（4 张工具卡 + 三个区块）                                      │ │
│  │ pages/ai-workflow.html    AI 工作流（接管方式 / 谁在接管 / 接口红线）                           │ │
│  │ pages/system.html         系统状态（显卡 / Agent 租约 / 缓存 / 新增模型）                       │ │
│  │ pages/docs.html + src/docs-viewer.js   文档阅读器（自写 Markdown 渲染，无 CDN）                     │ │
│  │ pages/character-editor.html  ★部件编辑器 + window.EditorAPI（108 命令）                        │ │
│  │ pages/character-lab.html   ★角色实验室（14 低模 + 6 高模 + 新增模型独立分区）                    │ │
│  │ pages/weapon-editor.html 武器编辑器（独立路线：共享武器库拆解 + 视口编辑 + 武器建模流水线）        │ │
│  │ pages/model-import.html    模型导入（.vox/.glb/.gltf/.obj → 方块）                              │ │
│  └──────────────────────────────────────────────────────────────────────────────────────────┘ │
│                     │                        │                        │                       │
│  ┌── 逻辑层 ────────┴────────┐  ┌────────────┴──────────┐  ┌──────────┴──────────────────┐  │
│  │ src/pipeline.js              │  │ src/quality-gates.js      │  │ src/characters.store.js          │  │
│  │ 27 步状态机 / 循环上限    │  │ 8 个质量门（纯函数）   │  │ 保存/缓存/Agent租约/显卡      │  │
│  │ 质量契约                  │  │ 全部只吃 canvas/几何   │  │ 全部走 fetch                  │  │
│  └──────────────────────────┘  └───────────────────────┘  └───────────────────────────────┘  │
│                     │                        │                        │                       │
│  ┌── 逆向层（原作代码，逐字，只读）──────────────────────────────────────────────────────────┐│
│  │ src/characters.orig.js    XT(id) 低模生成器 / Q 构架 / KT·AT 调色板                          ││
│  │ src/characters.face.js    jT 头脸贴图 / attachFace                                            ││
│  │ src/characters.hires2.js  $O(id,variant) 高模 / initHires 载 /models/*.json                   ││
│  └──────────────────────────────────────────────────────────────────────────────────────────┘│
│                                                                                              │
│  ┌── 我们的运行时（程序化）─────────────────────────────────────────────────────────────────┐│
│  │ src/lowpoly/*             ★ 模型 / 武器 / 动作 / 武器池 / 角色抽象（Builder 与 Q 同源）         ││
│  │ src/lowpoly/orig/*        14 个原作低模的移植数据（*_DATA）+ port.js                           ││
│  │ vendor/three/*            three.js 本地化（页面 importmap 指它，**零 CDN**）                   ││
│  └──────────────────────────────────────────────────────────────────────────────────────────┘│
│                                                                                              │
│  src/vox-import.js ── .vox / .glb / .gltf / .obj → 可编辑方块（独立，不依赖上面）                  │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                                        │ fetch /api/*
┌───────────────────────────────────────┴──────────────────────────────────────────────────────┐
│ tools/_serve.js（Node，零依赖，50 KB）                                                              │
│   静态：整个目录当 web root（ES module 必须走 http，file:// 不行）                             │
│   REST：/api/index /api/characters /api/store /api/models[...] /api/weapons[...]             │
│         /api/original-weapons /api/cache /api/agent /api/ref[...]                             │
│   磁盘：NewlyAddedModelList/ · NewlyAddedModelTemporaryList/ · TemporaryCache/                │
│         NewlyAddedWeaponList/ · NewlyAddedWeaponTemporaryList/ · OriginalWeaponList/          │
│         data/characters.json（浏览器发布回来的角色索引）                                       │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 运行时：三条链路

### 链路 A：编辑器（最重的一条）

```
页面加载
 ├─ import 逆向层 + 逻辑层（characters.orig / face / hires2 / store / pipeline / gates）
 ├─ 建 THREE 场景（renderer / camera / OrbitControls / TransformControls）
 ├─ spec = lapplandSpec()            ← 默认进 base 模式（直接吃 XT('lappland')，25 个基础网格）
 ├─ build() → 建 3D；renderAll() → 建左栏部件树
 ├─ restorePipeline()                ← 从 localStorage 恢复流水线（对话丢了它也不丢）
 ├─ 核对 _agentPending 与服务端是否一致（不一致就清掉本地接管标记）
 └─ window.EditorAPI = EditorAPI      ← 108 个命令挂上去
```

**`boxify(source)` 是整个项目的核心动作**：

```
XT('lappland') 的 24 个网格
   │  每个网格的 geometry.userData.primitiveVertexCounts  ← ★ 精确的图元边界
   ├─ 按 counts 切成一个个「原作图元」
   ├─ 每个图元算形心 → 当作它在新部件里的 x/y/z
   ├─ 按「分区规则 zones」（包围盒 + 切割面）决定它归哪个部件 / 什么角色
   └─ 产出 spec.parts[24]，每个图元是 kind:'op'（只读几何 + 可改变换/颜色）
        → 像素级 diff vs 原作 = 0.000%
```

### 链路 B：AI Agent 接管

```
AI 读 /docs/ai-workflow.md  →  Store.setAgent('名字','备注')  登记（租约 30 分钟）
   ↓ 每个回合
EditorAPI.pipeline()          ← ★ 权威：现在该干哪一步、下一句命令是什么
   ↓ 执行 nextCommand
EditorAPI.pipelineMark(step, {status,evidence})
   ↓ 每遍结束
EditorAPI.render({pass:true}) → EditorAPI.gates() → EditorAPI.record('continue', {...})
   ↓  同一遍修正 >3 次 或 总计 >6 次  →  status='stopped'（硬停，必须交还）
EditorAPI.saveModel({name})   →  confirmModel(id)  →  releaseAgent()
```

`pipeline()` 的特殊行为：**调用它时顺带 ping 租约**（1 分钟最多一次），所以 Agent 只要在干活就不会过期。

### 链路 C：文档阅读器（人和 AI 分叉的地方）

```
人  → pages/docs.html#<id>       fetch('docs/<id>.md') → src/docs-viewer.js 渲染 → 左右两栏
AI  → fetch('/docs/xx.md')  ★ 拿到的是**原始 Markdown**，一个字没改
```

`pages/docs.html` 里的「查看原始 .md ↗」直链就是指那条给 AI 的路径。

---

## 4. 模块参考

### 4.1 逆向层（**只读，不要改**）

| 文件 | 行 / 大小 | 导出 | 说明 |
|---|---|---|---|
| `src/characters.orig.js` | 119 行 / 53 KB | `XT` `Q` `KT` `AT` `It` `Bt` `zt` `Vt` `Mt` `Nt` `Pt` `Ft` `qT` `JT` `YT` `ET` `OT` `NT` `MT` `jT` `UT` `VT` `HT` `PT` | `XT(id)` → `{root, body, head, arms, legs, coatTails, tail}`。**极密**（为了保真保持原样的压缩代码），改它 = 放弃保真 |
| `src/characters.face.js` | 56 行 / 8 KB | `attachFace` `AT` `jT` `NT` `MT` | 头脸贴图管线。`attachFace` 把脸贴到头上（保表情） |
| `src/characters.hires2.js` | 1060 行 / **836 KB** | `HIRES_VARIANTS` `initHires` `buildHires` `HIRES_PALETTES` `$O` … | 烘焙高模。`initHires()` 必须先 await 才载 `models/*.json`（约 8 MB） |

> **红线**：`ai-workflow.md` §3 明确禁止 Agent 直接改这三个文件。它们被改动会让「保真」这个核心价值失效。

### 4.2 逻辑层

| 文件 | 行 / 大小 | 导出 | 说明 |
|---|---|---|---|
| `src/quality-gates.js` | 885 行 / 43 KB | 8 个门 + 13 个度量工具 + 常量 | **纯函数，不吃 DOM 全局**。输入是 canvas / 几何，输出是 `{verdict, score, detail}` |
| `src/pipeline.js` | 361 行 / 20 KB | `Pipeline` `buildChecklist` `newState` `PASS_ORDER` `COMPLEXITY_MINIMUMS` … | 状态机 + 步骤表 + 质量契约。**没有 DOM 依赖**，可以单独 require |
| `src/characters.store.js` | 147 行 / 9 KB | `Store` `gpuInfo` `gpuAdvice` | 全部是 `fetch('/api/*')` 的薄封装。`Store` 的异步方法**失败返回 `{ok:false,error}` 而不是 reject**（有测试覆盖） |
| `src/vox-import.js` | 334 行 / 17 KB | `parseVox` `voxGreedy` `meshToBoxes` `voxelizeMesh` `loadMeshBoxes` | 体素/网格 → 方块。完全独立，不 import 其它本项目的模块 |

**质量门签名**（都返回同一种结构）：

```js
silhouetteGate(refCanvas, renderCanvas, opts)   // IoU，224²；门槛分遍 0.60→0.85
turntableGate(views, opts)                      // 8 方位面积塌缩 / 空洞 / 必需方位
interiorDifference(baselineCanvas, renderCanvas) // 轮廓内部色差（只报数）
chiralityGate(spec, opts)                       // L/R 是否矢状面镜像
seamGate(spec, boxes, opts)                     // 部件与挂靠组重叠 ≥ 0.02
clearanceGate(probes, hosts, opts)              // 身份件埋在宿主里 >85% 判死
scalpGate(host, probes, opts)                   // 头皮露出比例 ≤5%（头发专用硬门）
penetrationGate(objects, opts)                  // 单对穿插 >10% 判死
// 统一出口
failDetail(gate)   // gate → 人话
summarize(report)  // 报告 → verdict
```

### 4.3 服务端 `tools/_serve.js`

788 行 / 50 KB，**零依赖**（只用 `http` `fs` `path`）。见文件头注释有完整端点表。

三条必须知道的实现约定：

```js
// ① 无条件读干请求体 —— 否则残留数据污染 keep-alive，表现为**随机 502**
const raw = ['POST','PUT','DELETE','PATCH'].includes(req.method) ? await readBody(req) : '';

// ② safeId() 是防目录穿越的唯一闸门（去掉 / \ 和 .. 前缀，限 64 字符）
const safeId = s => String(s||'').trim().replace(/[^A-Za-z0-9_\u4e00-\u9fa5.\-]/g,'_').replace(/^\.+/,'').slice(0,64);

// ③ 缩略图落盘成 thumb.png，**绝不**把 dataURL 写进 model.json（会让文件爆到几 MB）
```

### 4.4 外壳 `src/shell.js` / `styles/shell.css`

`src/shell.js`（159 行）是个 **classic script（不是 module）**，因为要在 `<script src>` 里直接引。
它靠**动态 `import()`** 复用 `src/characters.store.js` 的显卡/Agent 检测（普通脚本里静态 import 会报错）。

它往每个页面注入 `#shellbar`，并在右侧渲染两个实时 chip（显卡 / 接管 Agent）和一个
**浅色·深色切换按钮**。chip 的图标是**内联 SVG + `currentColor`**，不是 emoji
（emoji 颜色由字体写死，没法跟着状态变红变绿）。

`styles/shell.css` 的加载顺序**在页面自己的 `<style>` 之后** —— 这是 §6 里两个大坑的根因。
**同时它也是主题的唯一来源**：`:root`（深色）/ `:root[data-theme="light"]`（浅色）两套
语义变量都在这里，页面只许用变量、不许写死颜色（见 §6.12）。

### 4.5 编辑器页面 `pages/character-editor.html`（273 KB 单文件）

没有拆分文件，因为它是唯一持有 THREE 场景和完整 `spec` 闭包的地方。内部分区：

| 区间 | 干什么 |
|---|---|
| 顶部 `<style>` | 编辑器自己的 UI 样式（`#left` `#right` `#hud` `#toolbar` `#tip`） |
| 逆向层 import | `XT` / `attachFace` / `Store` / `Pipeline` / `GATES` |
| spec 与构建 | `spec` 变量、`build()`、`buildPart()`、`boxifySpec()`、`rezone()` |
| 部件树 UI | `renderPartList()`、拖拽选择、`snapshotPrimPositions()` 还原选择 |
| 流水线面板 | `renderPipelinePanel()`、`persistPipeline()` / `restorePipeline()` |
| **`EditorAPI` 对象** | 108 个命令的唯一出口 |
| 尾部自举 | 自动包装 undo + 兜底 try/catch + `window.EditorAPI = EditorAPI` |

**尾部那段包装很重要**：

```js
// 会改规格的命令自动记 undo（栈上限 60）
for(const k of ['setSpec','loadBase','boxify','addPart', … ]) EditorAPI[k] = 带 pushUndo 的包装;
// 其余命令统一 try/catch → 出错也返回 {ok:false,error}，不抛给调用方
for(const k of Object.keys(EditorAPI)) … 包一层 try/catch …
window.EditorAPI = EditorAPI;
```

所以**新增命令时不用自己处理异常**（但如果你加的是「会改规格」的命令，记得把它加进那个 undo 名单）。

---

## 5. 数据模型

### 5.1 `spec`（唯一的真源）

```jsonc
{
  "id": "lappland",
  "name": "拉普兰德（低模）",
  "mode": "base | parts",              // base = 直接吃原作；parts = 拆分后的可编辑部件
  "base": {
    "source": "角色id",
    "transforms": { "base#0.1": { "p":[x,y,z], "r":[x,y,z], "s":[x,y,z] } },
    "hidden": ["base#0.4.3"]           // 隐藏的基础网格 key
  },
  "useOrigFace": true,                 // 用原作脸（保表情）
  "iris": [0xRRGGBB, 0xRRGGBB, 0xRRGGBB],
  "palette": { "hair": 0xRRGGBB, "shade": …, "coat": …, "trim": …, "eye": … },
  "rig": {
    // ★ 新格式（推荐）：每个组的完整 TRS
    "groups": { "body|head|armL|armR|legL|legR|coatTails|tail|root": { "p":[x,y,z], "r":[x,y,z], "s":[x,y,z] } },
    // 旧格式（仍支持）：扁平字段
    "legacy": { "bodyY", "headY", "headScale":[x,y,z], "armX", "armY", "legX", "legY", "rootScale", "coatTails":[x,y,z], "tail":[x,y,z] }
  },
  "parts": [ { "id", "name", "category", "parent", "metalness", "mirror", "primitives":[…] } ],
  "zones": [ { "enabled", "label", "role", "cat",
               "box": { "x":[min,max], "y":[min,max], "z":[min,max] },
               "planes": [ { "enabled", "n":[x,y,z], "d", "side":">= | <=" } ] } ]
}
```

### 5.2 四种图元

```js
// ① box —— 方块（最常用）
{ kind:'box', x,y,z, w,h,d, color, rotX,rotY,rotZ }

// ② panel —— 2D 多边形挤出（做发片/衣片）
{ kind:'panel', points:[[x,y],…], depth, z, color }

// ③ op —— ★ boxify() 拆出来的「原作图元引用」，几何只读
{ kind:'op', src:'角色id', mesh:int, prim:int, tris:[…]|null,
  x,y,z, rotX,rotY,rotZ, sclX,sclY,sclZ,
  color:null|0xRRGGBB,        // null = 用原始顶点色
  metalness, roughness }      // 从原网格带过来，保证外观一致

// ④ geo —— 通用几何体（导入 Meshy/TRELLIS 等平滑网格后才用得上）
{ kind:'geo', shape:'box|sphere|ellipsoid|cylinder|cone|capsule|torus|lathe|extrude',
  params:{ seg, seg2, tube, open, points:[[x,y]], depth }, w,h,d, sclX,sclY,sclZ }
```

> **平滑网格 → 体素（`voxelizeMesh`），低模 → `boxify`**。别把 `boxify` 用在平滑网格上，
> 它依赖 `primitiveVertexCounts` —— **原作低模**（`Q.build`）和**我们的 `Builder.build`**（程序化移植 `orig/*`）都会写；
> 部件编辑器的「基础模型 / 拆分源」现在**优先走程序化移植**（`LP.PORTS` → `buildFromPort`），没有移植的才回退 `XT`。

### 5.3 质量契约

```js
contract = {
  complexity: 'simple | moderate | complex | ultra-complex',
  //                     parts primitives detailPerPart identityParts
  // simple                3       8          2             2
  // moderate              6      24          3             4
  // complex              10      70          5             7
  // ultra-complex        16     150          8            11
  definitionOfDone: [...],
  featureGroups: [   // 5 组，每组都必须**可验证**，不能是一句形容词
    { id:'overall-silhouette',     verify:'gates.silhouette.iou' },
    { id:'primary-structure',      verify:'contract.parts/primitives' },
    { id:'attachment-correctness', verify:'gates.seam + gates.penetration' },
    { id:'hair-and-identity',      verify:'contract.detailPerPart + gates.clearance' },
    { id:'color-palette',          verify:'palette 覆盖' },
  ]
}
```

---

## 6. ★ 关键不变量（改代码前必读）

### 6.1 CSS：`styles/shell.css` 会盖掉页面自己的样式

`styles/shell.css` 在每个页面自己的 `<style>` **之后**加载 → **同优先级直接盖掉**。
曾经因此在 `styles/shell.css` 里放了一条 `.scroll{max-height:220px}`，
把编辑器和武器编辑器的面板正文区全卡在 220px（下面一大片空白）。

**规矩**：
- `styles/shell.css` 里只放 `#shellbar*`、`:root` 变量、以及明确属于「信息页」的样式
- **不要**放 `.scroll` / `.card` / `.panel` 这种「看似通用的工具类」
- 改完跑一遍 §9 的撞车自查，**撞车数必须是 0**

### 6.2 CSS：`src/shell.js` 注入的 DOM 类名不能撞车

`src/shell.js` 往每个页面注入 `#shellbar`。它的类名会和**工具页自己的类**撞 ——
曾经用 `class="tab sec"` 表示「信息页标签」，而 4 个工具页自己都有一个通用 `.sec`
（面板里的小区块：`border` + `margin-bottom` + `overflow:hidden`）→
导航条那三个标签被压窄、上移 5~11px，**每个页面偏移量还不一样**。

现在用的是 `infotab`。**新加类名前先 grep 一遍所有工具页。**
**注入的元素连标签名都要挑**：主题切换按钮本来用 `<button>`，被 editor / mixer 的通用
`button{…}` 规则连带命中（撞车数从 0 变 1）→ 改成 `<span role="button" tabindex="0">`
并在 `src/shell.js` 里补键盘事件。**`#shellbar` 里不要用 `button` / `input` / `select`
这类会被页面通用规则命中的标签。**

### 6.3 `boxify` 必须保持几何精确

```js
// ✅ 正确：按几何自带的图元边界切
const counts = o.geometry.userData.primitiveVertexCounts;

// ❌ 错误：用包围盒近似 —— 会丢掉原作里的斜切/圆角
```

验收标准：`boxify` 之后渲染结果与 `.getSpec()` 之前的像素 diff = **0.000%**。

### 6.4 父级矩阵：`Box3.setFromObject` 不会更新父级

```js
// ❌ 得到错的世界坐标
new THREE.Box3().setFromObject(obj);

// ✅ 先刷一遍父链
built.root.updateMatrixWorld(true);
new THREE.Box3().setFromObject(obj);
```

`partBoxes()` 里已经这么做了，但你自己写测量代码时会踩。

### 6.5 `Pipeline.record()` 里必须把 `<pass>/review` 标记完成

`review` 这一步是在 `record()` **内部**被标记 done 的。拿掉这一句，
流水线**永远到不了 `complete`**（会一直卡在 review）。

### 6.6 `PIPELINE_VERSION` 必须继续导出

`pages/character-editor.html` 靠它做 `persistPipeline` / `restorePipeline` 的版本判断。
改名或去掉 → 老存档无法恢复，且不会有报错提示。

### 6.7 Agent 租约

- `setAgent(name, note, ttlMinutes)` —— 默认 30 分钟
- `pipeline()` / `pipelineMark()` / `record()` 顺带 ping（**1 分钟最多一次**，靠 `_lastPing` 节流）
- 超过 ttl 没 ping → 服务端把 `occupying` 算成 `false`（`stale:true`），接管位自动空出来
- **跑到 `complete` / `stopped` 自动交还**（`record()` 里触发）
- 页面加载时 `_agentPending` 要和 `/api/agent` 核对，**不一致必须清掉本地标记**

### 6.8 `rezone()` 之后 selection key 会失效

部件 id 和图元索引都会变。要保住选择用**位置**：

```js
const snap = EditorAPI.snapshotPrimPositions();   // [{x,y,z}, …]
// …改规格（可能触发 rezone）…
EditorAPI.selectByPositions(snap);                // 按位置找回来并选中
```

### 6.9 命名撞车：`armL/armR/legL/legR` 既是组名又是部件 id

`seamGate` 会跳过 `p.parent === p.id` 的部件，并退回「每个部件必须和至少一个别的部件重叠 ≥0.02」。

### 6.10 空规格的 `validate()` / `contract()`

早期版本空规格会「通过」、非法的复杂度档位会被静默接受。现在两者都显式报错 —— **别退回去**。

### 6.11 服务端：读干请求体 + 静态路径与目录名

- `tools/_serve.js` 对所有写请求**无条件读 body**，否则随机的 `HTTP 502`
- 模型文件的**静态 URL 用真实目录名**（`NewlyAddedModelList`），
  不是内部键名（`confirmed`）—— 用错了会 404
- `path.normalize` 在 Windows 上会把 `..` 夹回根目录，加上 `safeId()`，**没有目录穿越**

### 6.12 主题：颜色只能来自变量

深色 / 浅色两套配色**全部**是 `styles/shell.css` 里 `:root` / `:root[data-theme="light"]`
的变量。页面自己的 `<style>` 和 **JS 拼的内联样式**里一个 `#hex` 都不能有 ——
写死了就会在另一套主题下变成一块抹不掉的深色 / 看不清的浅字。

切换链路：

```
页面 <head> 里的一行内联脚本    ← 先按 localStorage 套 data-theme（防闪）
   ↓
src/shell.js  bindTheme()           ← 绑定导航条上的圆按钮
   ↓
<html data-theme="light">       ← styles/shell.css 的 :root[data-theme="light"] 生效
   ↓
dispatchEvent('themechange')    ← 页面想跟着变（比如 3D 场景底色）可以监听
```

⚠ **3D 视口**：4 个工具页的 `scene.background` / `fog` 都是 `0xa9b4ba`（中灰影棚底），
两套主题下都合适，**故意不跟着切**。如果哪天要切，改 `scene.background` 的那几行，
不用动 CSS。

### 6.14 ★ 骨架：`spec.rig` 有两个表示，只有 `groups` 算数

`spec.rig` 里同时躺着两套东西：

```jsonc
{
  "groups": { "head": {"p":[0,1.47,0], "r":[0,0,0], "s":[1.672,1.54,1.518]}, … },  // ① 权威
  "headY": 1.47, "bodyY": -0.11, "armX": 0.36, "headScale": […], …                  // ② 镜像
}
```

**`applyRig()` 一见 `groups` 就 `return`** —— 而第一次 `build()` 一定会用
`measureRig()` 把 `groups` 填上。所以**任何只写扁平字段的代码，对已经 build 过一次的
规格都是「改了没用」**。曾经中招的三处，症状都是「数字变了但模型纹丝不动」：

| 位置 | 症状 |
|---|---|
| 骨架比例面板 | 拖动滑块模型不动，看着像「骨架比例坏了」 |
| `EditorAPI.setRig(ref.rig)` | 文档推荐的「照抄某个角色的比例」完全无效 |
| `variantSpec()` | 几何缩了、骨架没挪 → 头掉到脚上、腿插进地面 |

**规矩**：所有骨架写入都走 `rigMerge()` / `rigSet()`（在 `pages/character-editor.html` 的
`applyRig` 后面那一块），它们会**两边一起写**。读用 `rigRead()`（groups 优先、扁平兜底）。

```js
rigPut(rig, axis, v, live)   // 6 个自由度：headY bodyY armX armY legX legY（arm/leg 自动写左右）
rigMerge(rig, patch, live)   // 批量；headScale→head.s、rootScale→root.s、coatTails/tail→xxx.p
rigRead(rig, axis, fallback) // groups 优先
```

另外 `rigGroupOf()` 会保证 `p/r/s` 都是**长度 3 的数组** ——
否则 `applyRig` 里的 `position.set(...g.p)` 会把缺的分量当 0，整条胳膊掉到 `y=0`。

> **`variantSpec()` 还有自己的护栏**：两个约束求解（腿长、头座位）依赖**可测量的
> box / geo 图元**。`boxify()` 出来的 `op` 图元既量不到也缩不了，会导致
> `legsReach()=0`（除零）和 `torsoTopOf()=0`（`headY` 只剩 `0.04×headScaleY≈0.07`，
> 等于把头按到脚上）。现在这种情况会退化成「只按比例挪骨架」，并在返回里带一条 `warn`。

### 6.15 其它「漏网」的老地方（已修，但同类问题还会再出现）

- **`mk(文字, 样式类, 函数)` 少传参数**：`pages/character-lab.html` 的导出按钮曾经写成
  `mk('截图', ()=>{})`，函数被当成样式类 → 按钮**根本没有点击处理器**。
  现在 `mk` 会识别「第二个参数是函数」并自动补位。
- **`delete KT[id]` 不能用来「还原配色」**：`src/characters.orig.js` 的 `XT(id)` 是
  `let t = KT[e]` 然后直接读 `t.coat`，删了就 `TypeError`。
  正确做法是启动时深拷贝一份原厂调色板，还原 = 覆盖回去（见 `KT0` / `AT0`）。
- **`userData` 里不能放循环引用**：`m.root.userData.orig = m` 会让 `GLTFExporter`
  抛 `Converting circular structure to JSON`（导出 GLB 永远失败，导出 JSON 却没事）。
  要用就用 `Object.defineProperty(…, {enumerable:false})`。

---

## 7. 怎么扩展

### 7.1 加一个 `EditorAPI` 命令

```js
// 在 pages/character-editor.html 的 EditorAPI = { … } 对象里加：
myCommand(arg){
  if(!arg) return err('myCommand 需要参数');        // err() 返回 {ok:false,error}
  …做事…
  return ok({ …结果… });                            // ok() 返回 {ok:true,…}
}
```

- **异常不用管**：尾部会统一包 try/catch
- **如果它会改规格** → 把名字加进尾部那个 undo 名单
- **结果必须能 JSON 序列化**（`ok()` 会 `JSON.stringify`）—— 别返回 Float32Array / THREE 对象
- 加完更新 [`editor-api.md`](editor-api.md) 的命令速查表（§9 有自动核对脚本）

### 7.2 加一个质量门

```js
// src/quality-gates.js —— 写成纯函数，不要碰全局
export function myGate(input, opts = {}){
  if(!input) return { verdict:'unevaluated', score:null, detail:'没有可测的输入' };
  const score = …;
  return { verdict: score >= 0.8 ? 'pass' : 'fail', score, detail:[…] };
}
```

然后注册进 `pages/character-editor.html` 的 `gates()` 汇总器 + `src/quality-gates.js` 的 `summarize()`。
**「没测」必须返回 `unevaluated`，不能当成通过** —— `summary.verdict` 会因此变 `unevaluated`。

### 7.3 加一个流水线步骤

`src/pipeline.js` 里改 `SETUP_STEPS` / `PASS_STEPS` / `FINAL_STEPS`。
⚠ 改完 **27 步这个总数`会变** → 所有文档里写「27 步」的地方都要跟着改（grep `27`）。

### 7.4 加一个页面

1. 复制一个现有页面的骨架（推荐 `pages/system.html`，最薄）
2. `<link rel="stylesheet" href="./shell.css">` + `<script src="./shell.js" defer></script>`
3. 在 `src/shell.js` 的 `TOOLS` 或 `INFO` 数组里登记（`[文件名, 显示名, 悬停说明]`）
4. 页面自己的固定面板记得用 `#left` / `#right` / `#panel`（`styles/shell.css` 会自动给它们让出导航条高度），
   或者 `padding-top: calc(var(--shell-h) + …)`
5. 跑 §9 的撞车自查

### 7.5 加一种可保存的产物

`tools/_serve.js` 加端点 → `src/characters.store.js` 加 `Store.*` 封装 → `EditorAPI` 加命令 → 文档。

### 7.6 让 AI 能拿到一种新文件

`/api/index` 的 `endpoints` 数组里登记，再在 [`model-files.md`](model-files.md) 写清楚。

---

## 8. 版本与兼容

| 常量 | 值 | 在哪 | 作用 |
|---|---|---|---|
| `API_VERSION` | `'1.0'` | `pages/character-editor.html` | `EditorAPI.version`，console 会打 |
| `PIPELINE_VERSION` | `1` | `src/pipeline.js` | 流水线存档兼容判断 |
| `GATE_VERSION` | `1` | `src/quality-gates.js` | 门算法版本 |
| `schema: 'lowpoly-workshop/model@1'` | | `model.json` | 磁盘模型格式 |
| `schema: 'lowpoly-workshop/characters@1'` | | `data/characters.json` | 角色索引格式 |

**localStorage**（编辑器会持久化，`pipelineReset()` 会清）：

| key | 内容 |
|---|---|
| `lowpoly-editor-pipeline-v1` | `{ v, savedAt, agent, state }` —— 流水线 + 接管者 |
| `lowpoly-editor-session-v1` | 会话存档（`saveSession()` / `loadSession()`） |

**兼容原则**：`spec.rig` 两种格式（`groups` / legacy 扁平）**都必须继续支持** ——
老存档和 `data/reference-models.json` 用的是扁平格式。

---

## 9. 自检（改完必跑）

### 9.1 一条命令：`node tools/selfcheck.js`

```bash
node tools/_serve.js            # 先起服务（不起的话 ④ 会自动跳过并提示）
node tools/selfcheck.js         # 另一个窗口
# node tools/selfcheck.js --quiet   只打印问题
```

它跑四组检查，**有问题就退出码 1**：

| 组 | 查什么 |
|---|---|
| ① 引用完整性 | 所有 HTML 的 `src`/`href`、所有 JS 的相对 `import` 都指向真实文件；没有没人引用的孤儿文件 |
| ② 页面外壳 | 8 个页面都引了 `styles/shell.css` + `src/shell.js`；`pages/docs.html` 额外引 `src/docs-viewer.js` |
| ③ 文档 vs 命令 | **双向**核对 `editor-api.md` 和 `pages/character-editor.html` 里的 `EditorAPI` 成员 |
| ④ 服务端 | `/api/*` 端点状态码（含 404 分支）；模型文件的静态直链能不能访问；角色索引是不是 14 + 3 |

### 9.2 `tools/selfcheck.js` **查不出来**的两件事，要在浏览器 Console 里跑

| 为什么查不出来 | 检查片段 |
|---|---|
| **CSS 类名撞车** 需要真实布局 | 见下 §9.3 |
| 控制台报错 / 横向溢出 / 导航条标签对齐 | 见下 §9.4 |

### 9.3 CSS 撞车（**必须为 0**）

```js
const bar = document.getElementById('shellbar'); const bad = [];
for (const el of bar.querySelectorAll('*'))
  for (const sh of document.styleSheets) {
    if (sh.href && sh.href.includes('styles/shell.css')) continue;   // 只看页面自己的样式
    let rules; try { rules = sh.cssRules } catch (e) { continue }
    for (const r of rules) {
      if (!r.selectorText || r.selectorText.includes('shellbar')) continue;
      let hit = false; try { hit = el.matches(r.selectorText) } catch (e) {}
      if (hit && (r.style.overflow || r.style.marginBottom || r.style.background))
        bad.push(el.className + ' ← ' + r.selectorText);
    }
  }
console.log('CSS 撞车数', bad.length, bad);   // 必须 0
```

### 9.4 8 个页面：报错 / 溢出 / 标签对齐 / 面板被限高

在每个页面里跑一次：

```js
(() => {
  const bar = document.getElementById('shellbar');
  const tabs = [...bar.querySelectorAll('a.tab')];
  const centers = [...new Set(tabs.map(a => {
    const r = a.getBoundingClientRect(); return +(r.top + r.height / 2).toFixed(1);
  }))];
  console.log({
    标签垂直中心: centers,                                   // 只该有一个值
    被限高的面板: [...document.querySelectorAll('.scroll')]
      .filter(e => e.scrollHeight > e.clientHeight && e.clientHeight <= 240).length,  // 必须 0
    横向溢出: document.documentElement.scrollWidth - document.documentElement.clientWidth, // 必须 0
  });
})()
```

### 9.5 ★ 主题：浅色模式下还有没有「深底 / 浅字」

**改过任何颜色相关的东西就跑一遍。** 先切到浅色（`document.documentElement.setAttribute('data-theme','light')`），再：

```js
(() => {
  const lum = c => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c);
    if (!m) return null;
    if (m[4] !== undefined && parseFloat(m[4]) < 0.15) return null;   // 几乎透明，忽略
    return (0.2126*m[1] + 0.7152*m[2] + 0.0722*m[3]) / 255;
  };
  const darkBg = [], lightInk = [];
  for (const e of document.querySelectorAll('body *')) {
    const r = e.getBoundingClientRect();
    if (r.width < 24 || r.height < 14) continue;
    const cs = getComputedStyle(e);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.1) continue;
    const bg = lum(cs.backgroundColor);
    if (bg !== null && bg < 0.30 && cs.position !== 'fixed')      // 浅色下不该有深底
      darkBg.push(e.tagName.toLowerCase() + '.' + e.className + ' ' + cs.backgroundColor);
    const fg = lum(cs.color);
    if (fg !== null && fg > 0.80 && e.textContent.trim() && !e.children.length)   // 浅色下不该有浅字
      lightInk.push(e.tagName.toLowerCase() + '.' + e.className + ' ' + cs.color);
  }
  console.log('深底', darkBg.length, darkBg.slice(0,10));
  console.log('浅字', lightInk.length, lightInk.slice(0,10));      // 两个都必须 0
})()
```

> 深色模式同理，把判据反过来（**深字压深底**）。`#3D` 那种透明黑要排除，否则全是误报。

---


## 10. 调试技巧

| 想干什么 | 怎么做 |
|---|---|
| 看真实 `spec` | 编辑器 Console：`window.__ed.spec` |
| 看场景/相机/渲染器 | `window.__ed.scene` / `.camera` / `.renderer` |
| 看当前选中 | `window.__ed.selection` |
| 截当前视口 | `window.__ed.shot()` → dataURL |
| 看流水线状态 | `EditorAPI.pipeline()`；重置 `EditorAPI.pipelineReset()` |
| 看质量门常量 | `EditorAPI.gates()` 的返回里带阈值；或直接 import `src/quality-gates.js` |
| 看服务端日志 | 跑 `node tools/_serve.js` 的那个窗口 |
| 服务端没起 | 所有 `Store.*` 报 `Failed to fetch`；导航条 Agent chip 显示「服务未启动」 |
| 页面改不动 | 硬刷新（Ctrl+F5）—— ES module 缓存很顽固 |
| 模型文件内容 | `curl http://localhost:8765/api/models/brm/file/model.js` |

---

## 11. 一句话总结每个文件

```
tools/_serve.js              静态 + REST，零依赖。读干 body / safeId / 缩略图落盘
src/characters.orig.js     原作低模生成器（只读）
src/characters.face.js     原作头脸贴图（只读）
src/characters.hires2.js   原作烘焙高模（只读，836 KB）
src/quality-gates.js       8 个质量门，纯函数
src/pipeline.js            27 步状态机 + 质量契约，无 DOM 依赖
src/characters.store.js    浏览器侧 fetch 封装（模型/缓存/Agent/显卡）
src/vox-import.js          .vox/.glb/.gltf/.obj → 方块，完全独立
src/shell.js               注入导航条 + 两个实时 chip（classic script + 动态 import）
styles/shell.css              主题变量 + 导航条 + 让位规则（★ 加载在页面样式之后）
src/docs-viewer.js         自写 Markdown 渲染（无 CDN，保住「离线可用」）
pages/docs.html              文档阅读器（人看这个；AI 读原始 .md）
pages/character-editor.html  ★部件编辑器 + EditorAPI（108 命令，287 KB 单文件）
pages/character-lab.html     14 低模 + 6 高模 + 新增模型独立分区（还会发布角色索引）
pages/weapon-editor.html    武器编辑器（共享武器库拆解 / 视口 gizmo 编辑 / 武器建模流水线）
pages/model-import.html      外部模型导入
```
