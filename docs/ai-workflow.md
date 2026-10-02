# AI 工作流 —— 让一个 AI Agent 直接接管这套工具

> 面向两类读者：
> - **用户**：想知道「我怎么让 AI 帮我改模型」；
> - **AI Agent**：想知道「我进来之后按什么规矩干活」。
>
> 具体 27 步流水线和门的阈值在 [`ai-pipeline.md`](ai-pipeline.md)；命令清单在 [`editor-api.md`](editor-api.md)。

---

## 1. 一句话

**用户和 AI 对话 → AI 调 `window.EditorAPI` → 改动落在既有的「命名部件 + 四种图元」框架内 → 跑质量门验证 → 存进 `NewlyAddedModelList`。**

不存在第二条路。AI **不允许**另造一套数据格式、不允许直接改 `src/characters.orig.js`、
不允许绕过质量门宣布完成。

---

## 2. 三种接管方式（按侵入性从低到高）

### 方式 A：只读建议（最安全）
把 [`ai-pipeline.md`](ai-pipeline.md) 和 [`editor-api.md`](editor-api.md) 交给 Agent，
让它读 `EditorAPI.state()` / `tree()` / `describe(id)` 的输出，然后**给你操作步骤**，你自己点。
> 适合：只是想让它帮你算坐标、判断比例对不对。

### 方式 B：Agent 驱动（推荐）
Agent 能执行 JS（有浏览器控制权 / 有 DevTools / 是能跑代码的 Agent），它直接：

```js
EditorAPI.pipeline()                     // ① 先问：现在该干什么
// ② 执行 nextCommand
// ③ 带证据标记完成
EditorAPI.pipelineMark(st.currentStep, { status:'done', evidence:'…' })
// ④ 每遍结束：渲染 → 跑门 → 写评审
EditorAPI.render({ pass:true }); await EditorAPI.gates({ turntable:true })
EditorAPI.record('continue', { evidence:'对比图 + gate 报告', score:0.85 })
```

**接管前先登记自己**（主界面和编辑器都能看到，避免两个 Agent 抢）：

```js
await Store.setAgent('claude-code', '按 ai-pipeline 跑「通用体型」的 hair 遍');
// 或者用 EditorAPI 的封装：
await EditorAPI.setAgent('claude-code', '按 ai-pipeline 跑 hair 遍');
```

**交还时清空**：

```js
await EditorAPI.setAgent(null, '已交还');
```

### 方式 C：脚本化批处理
Agent 不在浏览器里，而是生成一段 JS 让你粘进 DevTools Console，或者写成
`TemporaryCache/*.js` 让页面动态 import。适合一次性的批量改动。

---

## 3. 接口边界（Agent 必须知道的红线）

| 能做 | 不能做 |
|---|---|
| `EditorAPI.*` 全部命令 | ❌ 直接改 `src/characters.orig.js` / `src/characters.face.js` / `src/characters.hires2.js` |
| `EditorAPI.batch([...])` 批量命令 | ❌ 绕过 `pipeline()` 自己记进度 |
| `Store.*`（模型/缓存/Agent） | ❌ 把正式模型存到 `TemporaryCache/` |
| 读 `data/reference-models.json` 做比例参照 | ❌ 手工拼一套新的 spec 格式 |
| 直接用编辑器导出的 `model.js` 工厂 | ❌ 改 `tools/_serve.js` 的目录约定 |

**为什么**：这个项目的核心价值是「**同一份模型代码，四个工具共用，互不影响**」。
任何绕过 `EditorAPI` 的改动都会让编辑器、实验室、武器编辑器、导入页之间失配。

---

## 4. 关键接口速查（Agent 最少要会这些）

```js
// —— 进度 ——
EditorAPI.pipeline()                       // ★ 每回合第一件事
EditorAPI.pipelineMark(stepId, {status, evidence, reason})
EditorAPI.record(action, {evidence, score, note})   // continue|refine-spec|refine-code|request-input|stop
EditorAPI.contract(patch?)                 // 质量契约（复杂度档位 + 最小配额）
EditorAPI.saveSession() / loadSession()    // 会话存档（对话上下文可丢）

// —— 看结构 ——
EditorAPI.state() / tree({full?}) / describe(id) / findParts(q) / recipeSchema()

// —— 改模型 ——
EditorAPI.boxify(src)                      // 把原作角色精确拆成可编辑图元
EditorAPI.upsertPart(part)                 // 幂等加/改部件
EditorAPI.addParts([...], {upsert})        // 批量
EditorAPI.mirrorPair(id)                   // 正确的镜像孪生
EditorAPI.updatePrimitives([{partId,index,patch}])
EditorAPI.buildPart({recipe, params, mirror, parent, category})

// —— 验证 ——
await EditorAPI.gates({ turntable:true, penetration:true })   // 8 个门
EditorAPI.render({ pass:true, baseline:true })                // 评审图（正交、纯背景）
EditorAPI.admit() / refCrop({index})                          // 参考图可用性 + 切单视图

// —— 落盘 ——
await EditorAPI.saveModel({ name, note })          // → NewlyAddedModelTemporaryList
await EditorAPI.confirmModel(id)                   // → NewlyAddedModelList（正式）
await EditorAPI.cachePut({ name, data })           // → TemporaryCache
await EditorAPI.gateAndCache({ passId })           // 跑门 + 存报告 + 存截图
EditorAPI.gpu()                                    // 显卡
await EditorAPI.setAgent(name, note)               // 登记接管
```

### ★ 拿模型文件（只读，最常干的事）

```js
EditorAPI.modelFile()                              // 当前**没保存**的状态 → 标准模型文件形状
await EditorAPI.characters()                       // 原作角色索引（低模 14 + 高模变体）
await EditorAPI.aiIndex()                          // AI 入口总览
await Store.getModelBundle(id)                     // 磁盘上的模型：meta + spec + js + 直链
await Store.getModelFiles(id)                      // 模型目录里的文件清单
await Store.readModelFile(id, 'model.js')          // 直接读源码文本
```

**没有浏览器控制权**（纯 HTTP 的 Agent）也能拿到 —— 这三个 URL 就够：

```
GET /api/index                     这里有什么、从哪拿
GET /api/characters                有哪些原作角色
GET /api/models/:id/bundle         ★ 模型文件一次拿全
GET /api/models/:id/file/model.js  只要源码
```

细节、示例、拿不到的东西：**[`model-files.md`](model-files.md)**。

---

## 5. 流水线长什么样（细节见 ai-pipeline.md）

```
准备 5 步 → 五遍 × 每遍 4 步 → 收尾 2 步 = 27 步
                blockout → structure → hair → detail → color
                每遍：实现 → 渲染 → 跑门 → 评审

评审只有 5 个合法动作：
  continue / refine-spec / refine-code / request-input / stop
同一遍最多修正 3 次、总计 6 次 → 到顶 status='stopped'（**硬停**）
```

**硬停后的规矩**：`pipeline()` 返回 `hardStop:true` 且 `nextCommand:null`。
Agent 必须停下来向用户报告 `stopReason`，**不许继续、不许自己 reset**。

---

## 6. 8 个质量门（Agent 的自检清单）

| 门 | 判什么 | 什么时候测不了 |
|---|---|---|
| `silhouette` | 正面剪影 vs 参考图（224² 网格 IoU，分遍 0.60→0.85） | 没载参考图 / 参考图是多视图拼版 |
| `turntable` | 8 方位面积塌缩、轮廓内部空洞、必需方位覆盖 | 不需要参考图，总能测 |
| `interior` | 轮廓**内部**的色差（只报数） | 没有基线图（第一次跑会自动存） |
| `chirality` | L/R 是不是矢状面镜像 | 没有 L/R 配对 |
| `seam` | 部件与挂靠组原作几何的重叠 ≥0.02 | 纯手搓角色（没有原作几何） |
| `clearance` | 身份件整件是否埋在宿主里（>85% 才判死） | 没有身份件 / 没有宿主 |
| `scalp` | **头发专用硬门**：头皮露出的比例 ≤5% | 没有头发件 / 找不到头骨 |
| `penetration` | 部件互相穿插（单对 >10% 才判死） | 少于两个可测对象 |

**「没测」不等于「通过」**：任何门报 `unevaluated`，`summary.verdict` 就是 `unevaluated`。

---

## 7. 用户怎么和 Agent 说话（示例）

| 你说 | Agent 会做什么 |
|---|---|
| 「按参照图做一个通用体型，别太丑」 | `pipeline()` → 载参照图 → `boxify('lappland')` 取比例 → 逐遍构建 → 每遍跑门 → 存 `NewlyAddedModelList` |
| 「把马尾改长一点，别沉进头里」 | 读 `describe('tailL')` → 改 `updatePrimitives` → 跑 `clearance` + `scalp` 门 → 通过后 `saveModel` |
| 「它说硬停了」 | 读 `pipeline().stopReason`，向你报告「已经修正 3 次没达标，需要你决定方向」 |
| 「看看现在做到哪了」 | `pipeline()` → 汇报当前遍、进度、循环次数、下一句命令 |
| 「这个门什么意思」 | 查 [`troubleshooting.md`](troubleshooting.md) §3 门报错对照表 |
| 「换你自己来做这一遍」 | `setAgent('名字','备注')` 登记 → 按 `nextCommand` 干活 |

---

## 8. 接管登记（租约制）—— ★ 退出必须交还

**主界面（`pages/index.html`）→「系统状态」→「AI Agent 接管」** 面板会显示。数据存在
`TemporaryCache/agent.json`（清缓存**不会**清掉它）。

### 三条规矩

1. **进场先登记**（否则别人不知道谁在干活）
   ```js
   await EditorAPI.setAgent('claude-code', '按 ai-pipeline 跑「通用体型」的 hair 遍');
   // 也可指定租约：setAgent(name, note, 60)  // 60 分钟
   ```
2. **干活期间自动续约** —— `pipeline()` / `pipelineMark()` / `record()` 都会顺带 ping（1 分钟最多一次），
   不用手动管。要长时间不动（比如在思考）可以手动 `await EditorAPI.agentPing()`。
3. **★ 退出必须交还** —— 三种情况都会自动/手动释放：
   | 情况 | 行为 |
   |---|---|
   | 流水线跑到 `complete` | **自动交还**（`record()` 里触发） |
   | 流水线硬停 `stopped` | **自动交还**（并把 `stopReason` 写进备注） |
   | Agent 主动收工 | 调 `await EditorAPI.agentRelease('做完交还')` 或 `setAgent(null, '…')` |
   | Agent 崩了 / 忘了交还 | **租约到期自动释放**：超过 `ttlMinutes`（默认 30）没有 ping，服务端把 `occupying` 置 false，接管位空出来 |

### 怎么查

```js
const a = await EditorAPI.agent();
// { agent, note, since, heartbeat, ttlMinutes, ageMinutes, stale, occupying,
//   releasedAt, releasedBy, history:[最近3次] }
a.occupying   // true 才有 Agent 真正占着位
a.stale       // true = 登记还在但已超时，按「已退出」处理
```

主界面「系统状态」面板：占位时显示绿色的 Agent 徽章 + **「交还接管位」按钮**（用户可强制收回），
超时显示「已退出」并说明原因，空闲时显示上一次是谁、什么时候交还的。

---

## 9. 参照图怎么交给 Agent（★ 别直接拖图）

**症状**：把图**直接拖进对话框**，报
`发送提示失败 · The requested file could not be read…after a reference to a file was acquired`。

**原因**：聊天窗口 / 截图工具给出的是**临时文件路径**，松手后临时文件就被删了 →
客户端拿着刚拿到的路径去读，文件已经没了。**跟权限无关，是引用过期。**

**正确姿势**：

1. 另存为到 **`refs/inbox/`**（文件名用英文/拼音，**只支持 8bit 非隔行 PNG**）
2. 告诉 Agent 文件名
3. Agent 走**服务端**收（不走聊天附件）：

```bash
GET  /api/ref/inbox                          看收件箱里有什么
POST /api/ref  {"path":"refs/inbox/x.png"}   收进参照图服务（name 自动取文件名）
GET  /api/ref/x/profile?cols=80&rows=44      量区域轮廓
```

> 参照图落在 `TemporaryCache/refs/`：**清缓存即清**；Agent 交还带 `{cleanRefs:true}` 也清。

> **★ 先问一句「你到底需不需要给图」。** 默认流程是**让 Agent 自己去收集特征**：
> Agent 上网查该角色的公开资料 → 提炼一份**特征清单**（头发形状/分束、配色、道具、剪影要点、一个标志动作），
> 而不是等用户丢图。实测：自己提炼特征再建模，比丢一张图让它逐像素对，**明显更强** ——
> 参照图驱动会过拟合单个视角、和标准体型打架、常回来一堆扁平片。
> **体态一律用「原版模型」**：头身比 / 髋高 / 肩宽 / 四肢 / 站姿 / 透视，抄 `ai-pipeline.md` §11.1 常量
> 或 `EditorAPI.boxify('<原版 id>')` / `ModelReadout.dump()` 去量。
> **有图也只参考图上的特征**（头发 / 配色 / 道具 / 剪影要点），不取体态，不做逐像素对剪影。
> 详见 [`ai-pipeline.md`](ai-pipeline.md) **§十一**。参照图只留给「必须复刻某个已有剪影」的场合。

## 10. 目录结构已冻结（2026-09 起）

归类已完成（`pages/` `src/` `styles/` `tools/`），**以后不许再挪文件**。
挪一次要同步：页面里三类引用 + `_serve.js` 的 `LEGACY` 表 + `selfcheck.js` 扫描路径 +
文档上百处路径 + **用户端已打开的编辑器引用**（会报「引用过期」）。
已经因为挪文件出过三次事故。新增文件请直接放对目录。