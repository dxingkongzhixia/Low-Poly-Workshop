# 低模工坊 · 文档索引

> **先看这一页。** 它是给**人和 AI Agent** 共用的地图：遇到问题按症状查，不用通读全部文档。
>
> 📄 **两份入口，内容完全一样**：
> - **给人看**：浏览器里打开 <a href="../docs.html">`pages/docs.html`</a> —— 左边选文件、右边渲染好的正文，能切「原始 .md」
> - **给 AI 读**：直接读本目录的 **原始 `.md`**（`fetch('/docs/xx.md')`）。原始文件**一个字都没改**，
>   没有 HTML 包装，Markdown 原样保留 —— Agent 的读取路径是 `/docs/<名字>.md`，不受阅读器影响。

---

## 一、按症状查（最快路径）

| 症状 / 你想做什么 | 看这里 |
|---|---|
| 「让 AI 帮我改模型，怎么开始？」 | [`ai-workflow.md`](ai-workflow.md) §2 接管方式（网页版：`pages/ai-workflow.html`） |
| 「AI 跑到一半停了 / 说硬停」 | [`ai-workflow.md`](ai-workflow.md) §5 循环上限与硬停 |
| 「质量门没过，看不懂它在说什么」 | [`ai-pipeline.md`](ai-pipeline.md) §5 质量门 + [`troubleshooting.md`](troubleshooting.md) §3 |
| 「某个 API 命令怎么用 / 有哪些字段」 | [`editor-api.md`](editor-api.md) 命令速查 |
| 「模型存哪了 / 怎么保存 / 怎么确认」 | [`storage.md`](storage.md) |
| 「缓存文件在哪 / 怎么清」 | [`storage.md`](storage.md) §3 + 主界面「系统状态」面板 |
| 「页面卡 / 黑屏 / 转不动 / 说没有显卡」 | [`gpu.md`](gpu.md) |
| 「保存/缓存/Agent 显示连不上服务」 | [`gpu.md`](gpu.md) §4 或 [`troubleshooting.md`](troubleshooting.md) §5（服务器没起） |
| 「新增模型在实验室里看不到」 | [`storage.md`](storage.md) §2 + [`troubleshooting.md`](troubleshooting.md) §6 |
| 「**武器**存哪 / 怎么拿 / 怎么绑动作」 | [`weapon-files.md`](weapon-files.md) ★ |
| 「自己写的 / 外部的角色怎么接进工坊（状态机 + 武器池）」 | [`lowpoly-runtime.md`](lowpoly-runtime.md) ★ |
| 「让 AI **自己**建一个角色（不用给图）/ 怎么拿最新系统提示词」 | [`ai-pipeline.md`](ai-pipeline.md) §十一 + [`lowpoly-runtime.md`](lowpoly-runtime.md) §0；运行时 `EditorAPI.systemPrompt()` |
| 「武器怎么建 / 怎么把共享武器拆开改」 | [`weapon-files.md`](weapon-files.md) §6 武器建模流水线 ★ |
| 「怎么部署到服务器（宝塔 / Docker）/ 要不要鉴权 / 反代 413」 | [`deploy.md`](deploy.md) ★ |
| 「想拿原作 14 个角色的比例数据」 | [`../data/reference-models.json`](../data/reference-models.json) 或 `GET /api/characters` |
| 「**AI 怎么直接拿到模型文件**」 | [`model-files.md`](model-files.md) ★ |
| 「刘海/头发/变体为什么这么写」 | [`editor-api.md`](editor-api.md) 预设小节（三条写部件的坑） |

---

## 二、文档清单

| 文件 | 给谁看 | 内容 |
|---|---|---|
| `README.md`（本文件） | 人 + AI | 索引、按症状查、文件地图 |
| [`ai-workflow.md`](ai-workflow.md) | **AI Agent + 用户** | AI 怎么接管：接口边界、会话登记、接管流程、用户怎么和它对话、当前谁在接管 |
| [`ai-pipeline.md`](ai-pipeline.md) | AI | 27 步流水线、8 个质量门与阈值、反模式、可整段复制的命令序列；**§〇·B 建模顺序规程** |
| [`ai-pipeline-overview.md`](ai-pipeline-overview.md) | AI / 人 | ★ **一张图看懂主流程 + 7 个分支**（`.mmd` 同源）；分支速查表 |
| [`../低模工坊-制作流程笔记.md`](../低模工坊-制作流程笔记.md) | **AI Agent + 用户** | ★ **踩坑笔记**：怎么「看」模型（render 特写 + `ModelReadout` 文本读数 + 服务端参照图）、**建模顺序规程**、靴翼几何写法、`geo`/`setRig` 等一堆坑 |
| [`model-files.md`](model-files.md) | **AI Agent** | ★ **怎么直接拿到模型文件**：三种模型的三种拿法、`/bundle`、`/file/:name`、没保存的状态、拿不到的东西 |
| [`weapon-files.md`](weapon-files.md) | **AI Agent + 用户** | ★ **武器文件**：独立路线、`NewlyAddedWeaponList/` 的形状、`/api/weapons`、`WeaponAPI`、挂载数 / 种类 / 动作绑定 |
| [`editor-api.md`](editor-api.md) | 人 + AI | **108 条命令**的速查、规格结构、四种图元、预设与写部件的坑 |
| [`lowpoly-runtime.md`](lowpoly-runtime.md) | **AI Agent + 改代码的人** | ★ **自定义运行时**：程序化角色（初音未来 / 黑岩射手）、状态机动画、武器池（两池互斥 / 角色绑定 / 单手·双手）、导出 spec |
| [`storage.md`](storage.md) | 人 + AI | 三个目录的分工、保存/确认/缓存的 REST API、数据格式 |
| [`gpu.md`](gpu.md) | 用户 | 显卡检测、**没有显卡怎么办**、软件渲染的降级建议 |
| [`troubleshooting.md`](troubleshooting.md) | 人 + AI | 按症状排查表 + 常见报错 + §8 CSS 类名撞车 |
| [`deploy.md`](deploy.md) | 运维 / 用户 | ★ **部署到服务器**：宝塔 / PM2 / systemd / Docker、环境变量（`PORT`/`HOST`/`AUTH_*`）、反代与 `client_max_body_size`、安全清单、升级备份、排错 |
| [`development.md`](development.md) | **改代码的人** | ★ 架构分层 / 模块参考 / 数据模型 / **关键不变量** / 怎么扩展 / 自检脚本 |

---

## 三、文件地图

```
低模工坊/
├─ pages/index.html                ★ 启动页：4 个工具 + AI 工作流 / 系统状态 / 文档（同内容也在独立页里）
├─ pages/ai-workflow.html            AI 工作流页（接管方式 / 谁在接管 / 接口红线）
├─ pages/system.html                 系统状态页（显卡 / Agent 租约 / 缓存 / 新增模型）
├─ pages/docs.html                   文档页（按症状查 + 全部文档 + 文件地图）
├─ pages/character-editor.html       部件编辑器（window.EditorAPI，生成流水线，保存/缓存）
├─ pages/character-lab.html          角色实验室（原始模型 14 低模 + 6 高模 · 新增模型（初音 / 黑岩）· 运行时）
├─ pages/weapon-editor.html          武器编辑器（独立路线：共享武器库一键拆解 + 视口 gizmo 编辑 / 增删 + 模型代码 + 武器建模流水线 · window.WeaponAPI）
├─ pages/model-import.html           模型导入（.vox/.glb/.gltf/.obj → 可编辑方块）
│
├─ 代码
│   ├─ tools/_serve.js              本地服务器 + 存储 REST API（★必须先跑）
│   ├─ src/characters.orig.js     原作低模：XT(id) / Q / KT 调色板
│   ├─ src/characters.lowpoly.js  ★我们的运行时入口（barrel）→ src/lowpoly/*
│   ├─ src/lowpoly/              ★程序化角色运行时（拆成模块）：
│   │      model.js 人物模型 · weapons.js 武器本体 · moves.js 武器动作 · rig.js 武器池绑定
│   │      actions.js 动作绑定（移动/活动）· character.js 抽象类 · export.js 导出 · index.js 出口
│   │      orig/ 14 个原作低模的移植数据（*_DATA）+ port.js（buildFromPort）
│   ├─ src/characters.face.js     原作头脸管线：jT 贴图 / MT / attachFace
│   ├─ src/characters.hires2.js   原作高模：$O(id,variant) / ek 骨架
│   ├─ src/characters.store.js    ★浏览器侧：模型保存 / 缓存 / Agent 租约 / 显卡检测
│   ├─ src/pipeline.js            ★生成流水线：步骤表 / 状态机 / 循环上限 / 质量契约
│   ├─ src/quality-gates.js       ★质量门：8 个门的度量算法
│   ├─ src/vox-import.js          体素/外部模型导入器
│   ├─ styles/shell.css / src/shell.js   统一导航条 + 主题（★页面底色/字色也在这）
│   ├─ src/docs-viewer.js         自写 Markdown 渲染（离线可用，不依赖 CDN）
│   └─ tools/selfcheck.js           ★自检脚本：node tools/selfcheck.js（引用/文档/服务端）
│
├─ 数据
│   ├─ models/*.json          烘焙高模数据（texas / exusiai / lappland）+ _shared-baseline
│   ├─ data/reference-models.json  原作 14 个低模的测量数据（rig/调色板/包围盒）
│   └─ data/characters.json   ★原作角色权威索引（角色实验室打开时自动发布，供 /api/characters）
│
├─ 产物（★别混用，见 storage.md）
│   ├─ NewlyAddedModelList/          确认的新增模型（正式）—— 含 `miku/`、`brs/`（程序化角色）
│   ├─ OriginalWeaponList/             共享武器库（= **共享池**本体：黑刃 / 黑岩巨炮 / 葱…；目录名沿用）
│   ├─ NewlyAddedWeaponList/         确认的新增武器（正式）· NewlyAddedWeaponTemporaryList/ 待确认
│   ├─ NewlyAddedModelTemporaryList/ 待确认的新增模型（临时）
│   └─ TemporaryCache/               AI 测试产物 + agent.json（随时可清）
│
├─ 素材
│   ├─ images/previews/       启动页缩略图
│   ├─ images/ai/             AI 卡片图（SVG）
│   ├─ images/refs/           参考图（三视图等）
│   └─ refs/                  外部参考素材（img2threejs 技能的工作目录，只读参照）
│
├─ docs/                      本目录（全部文档）
└─ skills/                    第三方技能（`ThreejS_Standard_modeling` 低模建模 SKILL + 使用手册）
```

> **导航条分两组**：左边 4 个是「做模型的工具」，右边 3 个是「信息页」（AI 工作流 / 系统状态 / 文档），
> 中间用竖线分开。**右边三个是独立页面，不会跳回启动页。**
> 启动页上也保留了这三个区块的内容（锚点 `#ai` / `#sys` / `#docs`），方便一屏看完。
>
> **导航条最右侧还有两个实时指示**（8 个页面都有，30 秒自动刷新，回到前台立刻刷新）：
> - **显卡**（芯片图标）—— 绿色=硬件加速；红色=软件渲染（CPU 模拟）或没有 WebGL。鼠标悬停看完整信息，点一下去「系统状态」页
> - **接管 Agent**（机器人图标）—— 绿色=有 Agent 在接管；灰色「未接管」=空闲；红色「（已退出）」=租约超时；插头图标「服务未启动」=服务器没跑。
>   鼠标悬停看是谁、什么时候开始、多久没动作；点一下去「AI 工作流」页
>
> 这两个 chip 左边还有一个**圆形按钮切换浅色 / 深色**（图标画的是「点一下会变成的那个」）。
> 选择存在 `localStorage` 的 `lowpoly-theme`，8 个页面共享；每个页面 `<head>` 里有一行内联脚本
> **先套用一次**，所以刷新/跳页都不会闪。
>
> 这两个 chip 由 `src/shell.js` 用**动态 `import('./characters.store.js')`** 复用现成的检测函数渲染，
> 不重复实现；服务器没起时 Agent chip 会显示「服务未启动」而不会报错。
>
> **图标是内联 SVG，不是 emoji。** emoji（🎮 / 🤖）的颜色由系统字体写死（深蓝灰），
> 放在深色导航条上发闷，也没法跟着状态变绿变红。SVG 用 `stroke="currentColor"`，
> 颜色自动继承 chip 的颜色，所以「绿=正常 / 红=有问题 / 灰=空闲」一眼就能看出来。

---

## 四、六条铁律（人和 AI 都要遵守）

1. **必须先跑服务器**：`启动-低模工坊.bat` 或 `node tools/_serve.js`。
   所有页面都是 ES module，`file://` 打不开；保存/缓存/Agent 记录也全靠这个服务器。

2. **AI 每个回合的第一件事是 `EditorAPI.pipeline()`**。
   对话历史可以丢，`pipeline()` 的返回才是权威。返回 `status:'stopped'` 就是硬停，不要继续。

3. **三个目录别混用**：
   `NewlyAddedModelList` = 正式产物 / `NewlyAddedModelTemporaryList` = 待确认 /
   `TemporaryCache` = 随时可清的测试垃圾。**不要把正式数据放进 TemporaryCache。**

4. **改 `styles/shell.css` / `src/shell.js` 前先看 `docs/troubleshooting.md` §8。**
   `styles/shell.css` 是在每个页面自己的 `<style>` **之后**加载的 —— 同优先级会直接盖掉页面样式；
   而 `src/shell.js` 注入的 DOM 类名（`sec` / `scroll` / `card` / `panel` 这类短名字）
   很容易和工具页自己的类撞车。改完必须跑一遍撞车自查，**撞车数要是 0**。

5. **页面里不许写死颜色。** 颜色一律用 `styles/shell.css` 里 `:root` / `:root[data-theme="light"]`
   定义的**语义变量**（`--bg` `--panel` `--line` `--ink` `--ok-bg` …）。
   写死一个 `#1f3846`，浅色模式下那里就会是一块抹不掉的深色。
   包括 **JS 里拼的内联样式**（`el.style.cssText='background:#16252e'`）—— 那是主题的唯一漏洞来源。
   自查见 [`development.md`](development.md) §9.5。

6. **人物生成「程序化优先」**：① 优先用**代码 + 图元**建完整可动角色（`src/lowpoly/`）；
   ② **体态抄原版模型**（不取参考图的头身比 / 四肢 / 站姿 / 透视）；③ **特征让 AI 自己上网收集**（不要求用户给图）；
   ④ 有参考图**只参考图上的特征**，别做逐像素对剪影。详见 [`ai-pipeline.md`](ai-pipeline.md) §十一。
