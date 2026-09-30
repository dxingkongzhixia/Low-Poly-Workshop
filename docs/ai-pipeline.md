# AI 自动生成流程（低模工坊）

> 这份文档是给**大模型**看的操作手册。目标：让一个没有任何记忆的 AI，在任何一回合、任何一次会话，
> 都能把「参考图 → 可编辑的低模角色部件」这件事**可靠地跑完**，而不是一次性生成一坨东西然后自我感觉良好。
>
> 方法论提炼自 [img2threejs](https://github.com/) 技能的 `forge/` 流水线（Apache-2.0）。
> 它的自评是「轮廓 IoU 0.40~0.47（阈值 0.85）→ FAIL」—— **它做对了流程，做砸了结果**。
> 我们把它的流程纪律和度量算法搬了过来，换成我们这套「命名部件 + box/panel/op/geo 图元」的表达。

---

## 〇、30 秒心智模型

```
参考图 ──► 准备(5 步) ──► ┌ blockout ─┐
                         │ structure │   每一遍都走固定 4 步：
                         │ hair      │   实现 → 渲染 → 跑门 → 评审
                         │ detail    │   评审只有 5 个合法动作，
                         │ color     ┘   其中 refine-* 有次数上限（每遍 3 次、总计 6 次）
                         └──► 收尾(2 步) ──► 导出
```

**三条不可违背的规矩：**

1. **`pipeline()` 先行。** 每次开始、每次恢复、每次修正之前，第一件事是 `EditorAPI.pipeline()`。
   对话历史可以丢，`pipeline()` 的返回才是权威。它告诉你：现在在哪一步、下一步的确切命令、要交什么证据、循环剩几次。
2. **禁止一次性生成。** 必须逐遍（blockout → structure → hair → detail → color）。每一遍渲染、跑门、写评审。
3. **「没测到」不等于「通过」。** 任何门报 `unevaluated`，都不能当 `pass`。要补齐输入把它测出来，或者明说测不了。
4. **★ 按「部件顺序」建，不许跳步。** 见下面第〇·B 节。

---

## 〇·B、★ 建模顺序（正式规程，用户规定）

```
① 腿部 → ② 躯干 → ③ 手（臂）部 → ④ 头部 → ⑤ 头发 → ⑥ 衣服
```

**每一步内部两层：先「基础」，后「复杂」。** 基础没验过不许动复杂层；上一步没验过不许开下一步。

| 步 | 基础层（先） | 复杂层（后） | 验收 |
|---|---|---|---|
| ① 腿部 | 大腿/小腿/脚三段方块（定髋高、腿长、脚底落 0） | 靴筒、靴翼、V 线、白靴底 | 髋 ≈ 身高 40%；脚底 = 0 |
| ② 躯干 | 骨盆/腰腹/胸腔三段方块（定腰位、肩宽、胸深、下巴位） | 胸罩、腰带、短裤、颈圈 | 肩宽能接住手臂；`seam` 不悬空 |
| ③ 手（臂）部 | 大臂/小臂/手三段（定肩点、臂长） | 手套、袖口线 | 肩点与肩宽**三轴都重叠** |
| ④ 头部 | 头骨+脸（`useOrigFace`），定头身比 | 眼/嘴/脸细节 | 头占身高比例对上参照图 |
| ⑤ 头发 | 主帽+齐刘海+侧发（先把头皮盖住） | 后发板、鬓角、双马尾、发饰 | `scalp` 门 **0%**；身份件由**多个小模块**拼成 |
| ⑥ 衣服 | 大形（外套主体/裙摆/披风） | 描边、星标、扣子、缝线 | 大形不破剪影；描边只描该描的边 |

**★ 分段部件的「主干连续」铁律（踩过两次，门查不出来）：**

- **皮肤主干先连起来**（骨盆→腰→胸、大腿→小腿→脚，两两重叠 ≥0.02），**衣服盖在主干上**；
  衣服只决定「盖住哪里 / 露出哪里」，**不负责当主干**。
- 每建完一组分段件，**立刻 `dump()` 算相邻段重叠量**；门在正面会把断口接上，**它不会告诉你主体断了**。
- **衣服要比主干包得住**：胸罩/腰带/短裤的包围盒要略大于对应主干段（宽 + 深都盖过），
  否则就成了"贴在正面的贴纸"，侧面露皮肤。

```js
const d = ModelReadout.dump();
const W = id => { const p = d.parts.find(x=>x.id===id); return [p.world.min[1], p.world.max[1]]; };
const ov = (p,q) => Math.min(p[1],q[1]) - Math.max(p[0],q[0]);   // 必须 ≥ 0.02
```
**每一步固定四件套：**

```
实现 → ModelReadout.dump() 量坐标 → camera 怼到该部件拍特写 render() → gates() 确认没弄坏前面的
```

- **先读参照图再动手**：`ModelReadout.refProfile({name,...})`（服务端算，见 `/api/ref`）拿目标尺寸，
  和 `dump()` 的实测一减 → 改哪个图元、改多少。**别猜。**
- **特写 ≠ 全身远景**：全身图里一个小部件只有十几像素，等于没看。
- **一次只动一件**，动完就验。
- 反模式：跳步 / 在一步里混做基础层和复杂层 / 一次加五个部件再一起看 / 只看图不看数 / 只看数不看图。

> 更详细的踩坑记录与写法：仓库根目录 [`低模工坊-制作流程笔记.md`](../低模工坊-制作流程笔记.md)。

---

## 一、主循环（照抄 img2threejs 的循环语义）

### 1.1 每个回合的动作

```js
const st = EditorAPI.pipeline();     // ① 先问现在该干什么
if (st.status === 'stopped') {
  // ② 硬停：不要继续。向用户报告 stopReason，请求指示。
  return report(st.stopReason);
}
// ③ 执行 st.nextCommand（或按 st.nextLabel 做）
// ④ 标记完成，必须带证据
EditorAPI.pipelineMark(st.currentStep, { status:'done', evidence:'…' });
```

### 1.2 每一遍（pass）的 4 个固定步骤

| 步骤 id | 要交的证据 |
|---|---|
| `<pass>/build` | 这一遍改动的部件 id 列表 |
| `<pass>/render` | 一张基准视图 PNG（`EditorAPI.render({pass:true})`，纯背景 + 正交相机） |
| `<pass>/gate` | `EditorAPI.gates()` 的完整报告 |
| `<pass>/review` | `EditorAPI.record(action, {...})` 的返回值 |

### 1.3 评审动作（只有这 5 个合法）

| action | 什么时候用 | 后果 |
|---|---|---|
| `continue` | 这一遍达标 | 必须带 `evidence`，且 `score ≥ 0.7`；然后**换下一遍** |
| `refine-spec` | **规格错/浅**（部件分得不对、身份件只有一个大块） | 回去改规格，**不要去改代码掩盖**。计一次循环 |
| `refine-code` | 规格对、**实现不对** | 重置这一遍，重做。计一次循环 |
| `request-input` | 缺信息（参考图不可用、用户没说的设定） | 硬停，向用户提问 |
| `stop` | 结束 | 硬停 |

```js
// 这一遍过了
EditorAPI.record('continue', { evidence:'blockout 对比图 + gate 报告', score:0.82 });
// → { ok:true, nextPass:'structure', status:{…} }

// 规格浅：身份件只有 1 个图元
EditorAPI.record('refine-spec', { note:'双马尾只有 1 个图元，应该是 4~6 束' });
// → 计循环；这一遍的 4 步被重置为 pending，重来
```

**循环上限**（照抄 `maxPerPass=3` / `maxTotal=6`）：同一遍修正 3 次、总计 6 次 → `status='stopped'`，
之后**一切操作被拒**（`pipelineMark` / `record` 全部返回 error，`nextCommand = null`）。
这是一个**硬停**，不是建议 —— 到顶说明方向错了，要人来决策。

### 1.4 会话存档

对话上下文会丢，进程会重启。所以：

```js
EditorAPI.saveSession()          // 流水线状态 + 规格 → localStorage
EditorAPI.loadSession()          // 换个会话接着干
EditorAPI.exportSession()        // → JSON 字符串（可以贴给下一个 AI）
EditorAPI.importSession(json)
```

---

## 二、准备阶段（5 步）

### 2.1 `reference` —— 载入参照图

```js
await EditorAPI.setRefImage('/refs/img2threejs-work/reference.png', { plane:'front', opacity:0.45, height:2.4 });
```

### 2.2 `admit` —— 参照图可用性判定（**这一步最容易被跳过，也最容易毁掉后面所有门**）

```js
EditorAPI.admit();
```

判据（照抄 `check_reference_admission.py`）：

| 检查 | 阈值 |
|---|---|
| 短边 | ≥ 64 px |
| 前景占比 | 5% ~ 97% |
| 最大连通块占前景 | ≥ 60% |
| 长宽比 | 0.33 ~ 3.0 |
| **分离视图数** | 必须 = 1 |

**重点：三视图拼版必须切出一屏。** 拿 2000×1125 的三视图拼版去比单视图渲染，IoU 完全没有意义
（我们实测：拼版 aspectΔ=0.685，切出单屏后 aspectΔ 才降到 0.13 附近）。

```js
const a = EditorAPI.admit();
// a.metrics.detectedViews === 3
// a.suggestedCrops → [{ index:0, rect:{x:0.03,w:0.36}, label:'视图 1（x 3%–39%）' }, …]
EditorAPI.refCrop({ index:1 });          // 用第 1 屏（从 0 数）
EditorAPI.refCrop({ x:0.42, w:0.18 });   // 或者手工给归一化矩形
```

三视图的典型切法：`[正面/3-4] [侧面] [背面]`，宽度大约是 36% / 18% / 37%（侧面最窄）。

### 2.3 `palette` —— 取主色板

```js
const p = EditorAPI.refPalette(6);                       // → { colors:[{hex,rgb,share}…] }
EditorAPI.refPalette(4, { x:0.0, y:0.0, w:0.35, h:0.25 }); // 也可以只统计某个区域（归一化）
EditorAPI.setPalette({ hair:'#141414', skin:'#F2DED2', trim:'#E9E9E9' });
```

配色纪律：**先取色，再落色**。不要凭印象写 `#000000`。
取完色之后一定要在**最后一遍（color）**才把颜色落到调色板上 —— 前面几遍先管形状。

### 2.4 `complexity` + `contract` —— 复杂度与质量契约

```js
EditorAPI.setContract({ complexity:'moderate' });
```

| 档位 | 部件数 | 图元数 | 每个身份件最少图元 |
|---|---|---|---|
| `simple` | 3 | 8 | 2 |
| `moderate` | 6 | 24 | 3 |
| `complex` | 10 | 70 | 5 |
| `ultra-complex` | 16 | 150 | 8 |

**先写契约，再写代码。**（照抄 img2threejs 的 `qualityContract` 规则）
契约里含 5 个「身份特征组」，每一组都必须能被验证，不能是一句形容词：

```js
EditorAPI.contract({
  definitionOfDone:[ '正面剪影与参照图一致（成品遍 IoU ≥ 0.85）', … ],
  featureGroups:[
    { id:'overall-silhouette',     name:'整体轮廓与比例', verify:'gates.silhouette.iou' },
    { id:'primary-structure',      name:'主体结构完整',   verify:'contract.parts/primitives' },
    { id:'attachment-correctness', name:'挂接正确',       verify:'gates.seam + gates.penetration' },
    { id:'hair-and-identity',      name:'身份件',         verify:'contract.detailPerPart + gates.clearance' },
    { id:'color-palette',          name:'配色',           verify:'palette 覆盖' },
  ],
});
// 随时用 EditorAPI.contract() 读回，会附带 check（当前 spec 够不够深）
```

**反浅层规则**（`antiShallowSpecRules`，会自动带上）：
- 复杂对象只有一个根部件 → 不算完成
- 身份特征件只有一个图元 → 不算完成
- 可见细节只在描述里、没落到具体图元上 → 不算完成
- 相邻独立几何重叠 < 0.02 世界单位 → 判死（悬空）
- 任何门 `unevaluated` → 不算通过

---

## 三、五遍构建（每遍 4 步）

### 3.0 每一遍的通用动作

```js
// ① 实现（见下面各遍的说明）
// ② 渲染评审图（纯背景 + 正交相机 —— 没有透视变形，剪影才能和参考图比）
const shot = EditorAPI.render({ pass:true, size:512 });
// ③ 跑门
const g = await EditorAPI.gates({ passId:'blockout' });   // turntable:true 会拍 8 个方位（稍慢）
// ④ 按结果决定动作
if (g.summary.verdict === 'pass') EditorAPI.record('continue', { evidence:'…', score:0.85 });
else if (g.summary.verdict === 'fail') EditorAPI.record('refine-code', { note:g.summary.reasons.join(' / ') });
```

### 3.1 `blockout`：大形与比例（IoU 门槛 0.60）

**只做**躯干 / 头 / 手臂 / 腿的大块。**不要**碰头发细节和饰品。

```js
EditorAPI.loadBase('lappland');            // 或者从零：addPart + addPrimitive({kind:'box'})
// 参照原作比例：EditorAPI.reference('lappland') 拿包围盒与调色板
```

这一遍的目标只有一个：**剪影和比例对得上**。手、眼睛、饰品全部留空。

### 3.2 `structure`：结构（IoU 门槛 0.72）

四肢分段、附件、**左右镜像对**、挂接。

```js
// 用配方批量生成（一次几十个图元，比手填坐标可靠）
await EditorAPI.buildPart({ recipe:'ponytail', mirror:true, parent:'head', category:'头发' });
```

**左右必须是「矢状面镜像」，不是旋转**（照抄 img2threejs 的硬规矩）：
`(x, y, z) → (-x, y, z)`，绕 y/z 的旋转取反，绕 x 的不变。用 `mirrorPair` 而不是复制粘贴手工填负号：

```js
await EditorAPI.mirrorPair('tailL');     // → tailL_m，名字自动换成 -L/-R，镜像正确
```

### 3.3 `hair`：头发 / 兽耳 / 马尾（IoU 门槛 0.78）★ 单独一遍

**这是身份特征，单独占一遍。** 硬规矩（照抄 img2threejs 的 `HAIR_PIPELINE.md`）：

- **必须由多个小模块拼成**，不许一个大方块（`plane-card` / 圆柱管 / 大方块都是错的）
- **必须站在宿主外面**（`standProud`）—— 「头发陷进头骨 = 那里渲染出来是秃的」
- 近邻测试会放过它：顶点还在附近，只是沉到表面下面去了 → 必须判**在内/在外**，不能判**近/远**
- 发束锥度：宽度 `1.00 → 0.80 → 0.40 → 0.03`，厚度 `1.00 → 0.75 → 0.35 → 0.08`（归一化，不是世界单位）
- 第一段要**嵌进头皮**

```js
const rs = EditorAPI.recipeSchema();                    // 先看有哪些配方、参数默认值是什么
await EditorAPI.buildPart({ recipe:'twinTail',
  params:{ side:-1, x:-0.33, y:0.22, z:-0.06, length:0.55, strands:5, thick:0.075 },
  id:'tailL', name:'双马尾 L', parent:'head', category:'头发' });
await EditorAPI.mirrorPair('tailL');
```

跑门后会拿到净空门的判决：

```
clearance: fail · 双马尾 L 45/165 = 27% 采样点在宿主内部（沉进去了 → 那里会渲染成秃的/穿模）
```

→ 调 `x/y/z` 让它站在外面，或者调 `thick`/`strands`，然后重跑这一遍。

### 3.4 `detail`：小模块与饰品（IoU 门槛 0.80）

饰品 / 缝线 / 绑带 / 饰边。这一遍的目标是**小模块的数量**，不是大形。

### 3.5 `color`：配色（IoU 门槛 0.85，成品标准）

把颜色落到调色板上，取参考图对应部位的**真实颜色**（`sampleRefColor(u,v)` / `refPalette`）。

```js
await EditorAPI.updatePrimitives([
  { partId:'tailL',   index:0, patch:{ color:'hair' } },
  { partId:'tailL_m', index:0, patch:{ color:'hair' } },
]);   // 批量改，比 N 次 updatePrimitive 少 N-1 次重建
```

---

## 四、收尾（2 步）

### 4.1 `turntable` —— 转盘全覆盖

「**单个视角不是关于模型的证据。**」必须拍 0/90/180/270（允许 ±5° 误差）：

```js
const g = await EditorAPI.gates({ turntable:true, allowHoles:false });
// g.report.turntable.views       每个方位的面积占比
// g.report.turntable.collapseRatio  最小面积/最大面积（< 0.15 → 那个角度几乎是纸片）
// g.report.turntable.holes       轮廓内部有洞的方位（破面/部件缺失）
// g.report.turntable.missingAzimuths 缺哪个方位
```

### 4.2 `export`

```js
const js  = EditorAPI.exportJS();          // → { code }  依赖 src/characters.orig.js 的 Q / XT
const spec= EditorAPI.exportSpecJSON();
// 导出前必须自检：语法能过 + 门能过
```

导出代码**必须真的能跑**。检查方式（我们踩过的坑）：规格 id 里带 `-` 会拼出非法标识符
`function build_chibi-twin-tail-character()`，导出器已修，但自己产出的东西自己验一遍。

---

## 五、质量门（`EditorAPI.gates()`）

### 5.1 门一览

| 门 | 度量 | 死线 | 它抓什么 |
|---|---|---|---|
| `silhouette` | 224² 网格上的交并比（**归一到各自包围盒**） | 分遍 0.60 / 0.72 / 0.78 / 0.80 / 0.85 | 轮廓不对 |
| | 包围盒长宽比偏差 | ≤ 0.05 | 太胖/太瘦 |
| | 画面占比偏差 | ≤ 0.08（软） | 取景/大小 |
| `turntable` | 8 方位面积塌缩比 | < 0.15 → 判死 | 侧面是纸片 |
| | 轮廓内部空洞 | 最大洞 >4px 且占比 >1% → 判死 | 破面/部件缺失 |
| | 必需方位覆盖 | 0/90/180/270 ±5° | 没拍就等于没证据 |
| `interior` | 轮廓**内部**的逐格色差（192²，按高度分带） | 只报数 | 内部做没做（脸删了 IoU 也看不出来） |
| `chirality` | L/R 配对的 x 之和 | ≈ 0（相对容差 2%） | 「两边错得一样」 |
| `seam` | 部件 vs 挂靠组原作几何的包围盒重叠厚度 | ≥ 0.02 | 悬空部件 |
| `clearance` | 身份件整件埋进宿主的比例 | ≤ 85%（部分埋入只 warning） | 整件沉进去看不见了 |
| `scalp` | 头皮露出比例（**头发专用硬门**） | ≤ 5% | 秃斑（发根埋入是正常的，不算） |
| `penetration` | 3 条固定方向射线奇偶投票（至少 2 票） | 单对 >10% 采样点在内部 → 判死 | 部件互相穿过去 |

### 5.2 三条纪律

1. **脚本只度量、不评判视觉。** 门给的是确定性数字；「像不像」由人/AI 给分（`record` 的 `score`）。
2. **「没测」不等于「通过」。** `summary.verdict` 有三态：`pass` / `fail` / `unevaluated`。
   有任何一个门是 `unevaluated`，`summary` 就是 `unevaluated`，**不是 pass**。
3. **门是问题，不是障碍。** 不许为了通过而放宽阈值（`iouMin` 可以传，但那是给"我知道这一遍只做 blockout"用的）。

### 5.3 内外差门为什么要单独存在

「轮廓 IoU 只读到约 **11%** 的格子：一个把脸整个删掉的模型，正面 IoU 和做完脸的一模一样。」

用法：改之前存基线，改完再跑一次。

```js
EditorAPI.baseline('set');                 // 或者 render({ pass:true, baseline:true })
// …改模型…
const g = await EditorAPI.gates({});
g.report.interior.interiorDifference;      // 0~1，越大说明改得越多
g.report.interior.bands;                   // 头 / 躯干 / 腿 分带
```

---

## 六、加 / 改部件的接口（给 AI 的便捷件）

```js
// 看结构（便宜）
EditorAPI.tree();                          // 层级 + 每个部件的图元数/面数 + 哪些身份件"太薄"
EditorAPI.tree({ full:true });             // 连图元明细一起
EditorAPI.describe('tailL');               // 单件全信息：图元明细 + 世界包围盒
EditorAPI.findParts('尾');                  // 模糊查

// 加（幂等 —— 重跑同样调用不会产生重复部件）
EditorAPI.upsertPart({ id:'tailL', name:'双马尾 L', category:'头发', parent:'head', primitives:[…] });
EditorAPI.addParts([…], { upsert:true });  // 批量，一次 undo
EditorAPI.addPartJSON({ id, name, category, parent, primitives:[…] });   // 严格新增

// 用配方（一句话生成几十个图元）
EditorAPI.recipeSchema();                  // 参数默认值/说明，机器可读
EditorAPI.recipes();                       // 人读版
EditorAPI.recipe('twinTail', { length:0.5 });   // 只展开成算子表，先看再决定要不要落地
await EditorAPI.buildPart({ recipe:'twinTail', params:{…}, mirror:true, id, name, parent, category });

// 改
EditorAPI.updatePrimitives([{ partId, index, patch }]);   // 批量改
EditorAPI.updatePrimitive(partId, index, patch);          // 单个
EditorAPI.updatePart(partId, patch);
EditorAPI.mirrorPair('tailL');                            // 正确的镜像孪生
EditorAPI.removePart(id) / duplicatePart(id) / selectPart(id)

// 图元四种 kind
{ kind:'box',   x,y,z, w,h,d, color, rotX,rotY,rotZ }
{ kind:'panel', points:[[x,y]…], depth, z, color }
{ kind:'op',    src,mesh,prim,tris, x,y,z, rot*, scl*, color }        // 原作图元（boxify 拆出）
{ kind:'geo',   shape, w,h,d, x,y,z, rot*, scl*, color, params }      // 通用几何体
//   shape: box|sphere|ellipsoid|cylinder|cone|capsule|torus|lathe|extrude
//   params: { seg, seg2, tube, open, points:[[x,y]…], depth }
```

### 6.1 两条创建路线

| 路线 | 什么时候用 | 起手式 |
|---|---|---|
| **改造原作角色** | 角色是游戏里已有的（lappland / texas / exusiai…） | `EditorAPI.boxify('lappland')` → 精确拆成 `kind:'op'` 图元 |
| **从零做新角色** | 参照图是新角色 | `addPart` + `addPrimitive({kind:'box'})`，或 `buildPart({recipe})` |

`boxify` 用几何自带的 `geometry.userData.primitiveVertexCounts` 精确切分，切出来是 **100% 原始图元**
（实测逐像素差异 0.000%），不是 AABB 近似。

---

## 七、完整跑一遍（可以直接照抄的命令序列）

```js
// ── 0. 先问现状（每一次会话、每一回合都从这句开始）──
EditorAPI.pipeline();

// ── 1. 准备 ──
await EditorAPI.setRefImage('/ref.png', { plane:'front', opacity:0.45 });
const a = EditorAPI.admit();
if (a.metrics.detectedViews > 1) EditorAPI.refCrop({ index:a.suggestedCrops[0].index });
EditorAPI.pipelineMark('reference', { status:'done', evidence:'参考图已进视口' });
EditorAPI.pipelineMark('admit', { status:'done', evidence:JSON.stringify(a.metrics) });

EditorAPI.refPalette(6);
EditorAPI.pipelineMark('palette', { status:'done', evidence:'主色板 6 色' });
EditorAPI.setContract({ complexity:'moderate' });
EditorAPI.pipelineMark('complexity', { status:'done', evidence:'moderate：头身比约 3 头' });
EditorAPI.pipelineMark('contract',   { status:'done', evidence:'5 个特征组 + 最小配额' });

// ── 2. blockout ──
await EditorAPI.boxify('lappland');
EditorAPI.pipelineMark('blockout/build', { status:'done', evidence:'24 个部件' });
EditorAPI.render({ pass:true, baseline:true });
EditorAPI.pipelineMark('blockout/render', { status:'done', evidence:'blockout.png' });
const g1 = await EditorAPI.gates({ passId:'blockout' });
EditorAPI.pipelineMark('blockout/gate', { status:'done', evidence:JSON.stringify(g1.summary) });
EditorAPI.record(g1.summary.verdict==='pass' ? 'continue' : 'refine-code',
                 { evidence:'blockout 对比图', score: g1.report.silhouette.iou, note:g1.summary.reasons.join(' / ') });

// ── 3. structure（四肢 / 附件 / 镜像对）──
await EditorAPI.buildPart({ recipe:'ponytail', mirror:true, parent:'head', category:'头发' });
// … render / gate / review 同上，passId:'structure' …

// ── 4. hair（身份件，单独一遍）──
await EditorAPI.buildPart({ recipe:'twinTail', params:{ side:-1, x:-0.33 }, id:'tailL', name:'双马尾 L', parent:'head', category:'头发' });
await EditorAPI.mirrorPair('tailL');
// … render / gate / review，passId:'hair' …   ← clearance 门会告诉你有没有沉进头骨

// ── 5. detail ──
await EditorAPI.buildPart({ recipe:'hairAccessory', mirror:true, id:'accL', name:'发饰 L', parent:'head', category:'发饰' });
// … passId:'detail' …

// ── 6. color ──
await EditorAPI.updatePrimitives([{ partId:'tailL', index:0, patch:{ color:'hair' } }]);
// … passId:'color' …

// ── 7. 收尾 ──
const gt = await EditorAPI.gates({ turntable:true });
EditorAPI.pipelineMark('turntable', { status:'done', evidence:JSON.stringify(gt.report.turntable.coverage) });
const js = EditorAPI.exportJS();
EditorAPI.pipelineMark('export', { status:'done', evidence:'exportJS 语法通过' });
EditorAPI.saveSession();
```

---

## 八、给大模型的系统提示词（可直接粘贴）

```
你在用一个浏览器里的「低模部件编辑器」，通过 window.EditorAPI 操作它。

铁律：
1. 每个回合的第一件事必须是 EditorAPI.pipeline()。对话历史可以丢，pipeline() 才是权威。
   返回 status:'stopped' 就是硬停 —— 立刻停下，向用户报告 stopReason，不要继续做任何事。
2. 禁止一次性生成整个模型。必须逐遍：blockout → structure → hair → detail → color，每遍四步（实现/渲染/跑门/评审）。
3. 每一步 pipelineMark 都必须带 evidence；skip 必须带 reason。不许静默跳过。
4. 「没测到」不等于「通过」。gates() 的 summary.verdict 是三态：pass / fail / unevaluated。
   有 unevaluated 就是 unevaluated。
5. 不许为了让门通过而放宽阈值。门是问题，不是障碍。
6. 身份特征件（头发/兽耳/马尾/饰品）必须由多个小模块拼成，不许一个大方块；
   并且必须站在宿主外面（跑 clearance 门确认）。
7. 左右配对用 mirrorPair，不要手工填负号 —— 左右是矢状面镜像，不是旋转。
8. 参考图如果是三视图拼版，先 admit() 看 detectedViews，再 refCrop 切出单屏。
   不切的话 silhouette 门的数字没有意义。

工作顺序：
  EditorAPI.pipeline() → 执行 nextCommand → 带证据 pipelineMark → 下一轮
  每一遍结束时：render({pass:true}) → gates() → record(action, {evidence, score})
  record 的 5 个合法动作：continue / refine-spec / refine-code / request-input / stop
    · continue 必须 evidence + score ≥ 0.7
    · refine-spec = 规格错或浅（回去改规格，不要改代码掩盖）
    · refine-code = 规格对但实现不对
  同一遍最多修正 3 次、总计 6 次，到顶会硬停。

随时可用的查询：pipeline() / tree() / describe(id) / findParts(q) / recipeSchema() / contract() / validate() / state()
```

---

## 九、反模式（都是踩过的坑，照抄 img2threejs 的失败记录）

| 反模式 | 后果 |
|---|---|
| 从对话历史里"推断"进度 | 状态漂移。`pipeline()` 才是权威 |
| 一次性生成整模型 | 没有一遍能被验证，错误会复合 |
| 只看正面 | 「头骨破个洞、帽子挂在胯高、吊坠飘着 —— 都熬过了八轮只看正面的评审」 |
| 只看轮廓 IoU | 它只读到 ~11% 的格子；内部做没做看不出来 |
| 用近邻判「头发在头外」 | 顶点还在附近，只是沉下去了 → 渲染出来是秃的 |
| 加宽头发去补覆盖率 | 实测：加宽后六个视角的覆盖率**全都变差**（脊柱是直的、头骨是凸的，加厚是往侧面推不是往外推） |
| 手工填 -x 做左右 | 绕 y/z 的旋转没取反 → 两边朝向不同；用 `mirrorPair` |
| 拿三视图拼版比单视图 | aspectΔ 0.685，IoU 是纯噪声 |
| 门测不了就当通过 | 整套门变成装饰品。`unevaluated` 必须显式处理 |
| 改代码去掩盖规格错误 | 用 `refine-spec` 回去改规格 |
| 门没过就接着往下做 | 后面的遍会建在错的形状上 |

---

## 十、文件与实现位置

| 文件 | 内容 |
|---|---|
| `src/pipeline.js` | 步骤表、状态机、循环上限、质量契约、复杂度配额 |
| `src/quality-gates.js` | 七个门的度量算法（遮罩/轮廓 IoU/转盘/内外差/左右/接缝/净空/穿插） |
| `pages/character-editor.html` | `EditorAPI` 全部命令 + 流水线面板 UI |
| `editor-api.md` | 命令速查（人读版） |
| 本文档 | AI 操作手册（模型读版） |

**阈值来源**（照抄 img2threejs `forge/stage4_review/`）：
`MASK_GRID=224`、`SILHOUETTE_IOU_THRESHOLD=0.85`、`INTERIOR_GRID=192`、`ASPECT_SOFT_MAX=0.05`、
`SCALE_HARD_MAX=0.08`、`DEFAULT_COLLAPSE_RATIO=0.15`、`INTERIOR_HOLE_PIXEL_FLOOR=4`、
`INTERIOR_HOLE_FRACTION_THRESHOLD=0.01`、`REQUIRED_AZIMUTHS=(0,90,180,270)`、`AZIMUTH_TOLERANCE=5.0`、
`SEAM_OVERLAP_MIN=0.02`、`maxPerPass=3`、`maxTotal=6`。

**我们对它做的三处改动**（并说明理由）：
1. **IoU 分遍设门槛**（0.60→0.85）。它只有一个全局 0.85 —— 那是它做不到分遍；我们做得到，分遍才有可操作性。
2. **轮廓 IoU 归一到各自包围盒**。它的渲染相机是固定解出来的，我们的视口是自由的；归一化之后
   IoU 只度量形状，取景偏差单独由 `aspectDelta` / `scaleDelta` 报出来。
3. **接缝门的对照物改成「挂靠组的原作几何」**。它比的是「部件 vs 部件」，我们的部件大多挂在 8 个固定组上，
   直接照抄会一个都比不了。
