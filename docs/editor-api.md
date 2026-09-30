# 低模部件编辑器 · 大模型操作手册

> 文件：`pages/character-editor.html` · 启动：双击 `启动-低模工坊.bat` → 打开启动页 `pages/index.html` 再进各分支
> 默认模型：**原作低模「拉普兰德」**（可作为一切新角色的参照基准）

## 项目结构（低模工坊）

```
启动-低模工坊.bat        双击 → 起 node tools/_serve.js + 打开 http://localhost:8765/
pages/index.html               ★ 启动页（4 个工具 + AI 工作流 / 系统状态 / 文档）
pages/ai-workflow.html           AI 工作流页（接管方式 / 谁在接管 / 接口红线）
pages/system.html                系统状态页（显卡 / Agent 租约 / 缓存 / 新增模型）
pages/docs.html                  文档页（按症状查 + 全部文档 + 文件地图）
  ├─ pages/character-editor.html   部件编辑器（本手册主角，含 window.EditorAPI）
  ├─ pages/character-lab.html      角色实验室（14 低模 + 6 高模 + ★新增模型独立分区）
  ├─ pages/character-mixer.html    换装室（槽位混搭跨角色部件）
  └─ pages/model-import.html       模型导入（.vox/.glb/.gltf/.obj → 可编辑方块，含 window.ImportAPI）

服务端（必须先跑）
  tools/_serve.js              本地静态服务器 + 存储 REST API（/api/models /api/cache /api/agent）

共享代码
  styles/shell.css / src/shell.js   统一导航条 + 主题 + 页面底色字色（所有页都引入）
  src/characters.orig.js     原作低模：XT(id) / Q / KT 调色板 / RoundedBoxGeometry
  src/characters.face.js     原作头脸管线：jT 96×80 贴图 / MT / attachFace
  src/characters.hires2.js   原作高模 + 动画（ek/NE 骨架）
  src/characters.store.js    ★浏览器侧：模型保存 / 临时缓存 / Agent 租约 / 显卡检测
  src/vox-import.js          体素/外部模型导入器（.vox 解析 + 贪心合并 + 网格拆盒）
  src/pipeline.js            ★生成流水线：步骤表 / 状态机 / 循环上限 / 质量契约
  src/quality-gates.js       ★质量门：8 个门（遮罩/轮廓 IoU/转盘/内外差/左右/接缝/净空/头皮/穿插）
  models/*.json          烘焙高模数据
  data/reference-models.json  原作 14 个低模的测量数据（rig/调色板/包围盒）

产物目录（★别混用，见 storage.md）
  NewlyAddedModelList/          确认的新增模型（正式）
  NewlyAddedModelTemporaryList/ 待确认的新增模型（临时）
  TemporaryCache/               AI 测试产物 + agent.json（随时可清）

素材
  images/previews/       启动页缩略图      images/ai/    AI 卡片图
  images/refs/           参考图            refs/         外部参考素材

文档（全在 docs/）
  docs/README.md         ★文档索引（先看这个）
  docs/ai-workflow.md    ★AI 工作流 / 接管方式
  docs/ai-pipeline.md    AI 操作手册（27 步 + 8 门 + 反模式）
  docs/editor-api.md     本手册（命令速查 · 人读版）
  docs/storage.md        存储与目录
  docs/gpu.md            显卡与故障排查
  docs/troubleshooting.md 故障排查
```

> 五个页面都要走 http 服务器（ES module 在 `file://` 下打不开），保存/缓存/Agent 也依赖它。

> **第一次用先读 [`README.md`](README.md)（文档索引）和 [`ai-workflow.md`](ai-workflow.md)（AI 工作流）**。
> 本文件是命令速查。核心入口只有一句：**每个回合先调 `EditorAPI.pipeline()`**。

---

## 〇、30 秒上手（大模型最小闭环）

```js
EditorAPI.pipeline()                    // ★ 每个回合的第一件事：现在该干什么、命令是什么、要交什么证据
                                        //   status:'stopped' = 硬停，不要继续（向用户报告 stopReason）
EditorAPI.state()                       // 现状：mode / 部件 / 图元类型 / 面数 / 包围盒
EditorAPI.schema()                      // 规格说明（含 workflows，写给大模型的流程建议）
EditorAPI.reference('lappland')         // 原作参照：比例 rig / 调色板 / 每个部件包围盒

// ② 选一条路：
EditorAPI.boxify('lappland')            //    A. 改造原作角色 → 精确拆成 kind:'op' 图元
//  或
const p = EditorAPI.addPart({name:'外套', category:'服装装饰', parent:'body'})
EditorAPI.addPrimitive(p.id, {kind:'box', x:0,y:1,z:0.3, w:.4,h:.5,d:.2, color:'coat'})   //    B. 从零捏新角色（box/panel）
//  或
EditorAPI.addPrimitive(p.id, {kind:'geo', shape:'torus', x:0,y:1,z:0.3, w:.3,h:.3,d:.3})  //    C. 通用几何体

// ②' 要"参照图改造 + 精细拼接"就再走这三步（详见第五节）
await EditorAPI.setRefImage(图, {opacity:0.4})        // 参考图贴进视口
EditorAPI.admit()                                     // ★ 可用性判定（三视图拼版会让你 refCrop 切一屏）
EditorAPI.refPalette(6, {x:.25,y:.05,w:.5,h:.9})      // 从图里提主色
EditorAPI.buildPart({recipe:'twinTail', mirror:true}) // 一句话生成几十个小图元

// ③ 编辑：直接改规格
EditorAPI.updatePrimitive(partId, 0, {x:0.1, rotY:0.4})      // op 也能改 x/y/z/rot*/scl*/color
EditorAPI.updatePart(partId, {mirror:true})                  // 一键镜像到对侧
EditorAPI.mirrorPair(partId)                                 // ★ 更稳的镜像孪生（旋转也正确取反）
EditorAPI.upsertPart({id, name, category, parent, primitives:[...]})   // ★ 幂等，重跑不重复
EditorAPI.tree() / describe(partId) / recipeSchema()          // 看结构 / 看单件 / 看配方参数

// ④ 自检 → 看图 → 跑门 → 导出
const v = EditorAPI.validate()          // {ok, errors, warnings, stats}
const g = await EditorAPI.gates({turntable:true})   // ★ 7 个质量门；summary.verdict 三态
const d = EditorAPI.detailReport()      // 检查"精细度"：哪些部件还是一个方块
const shot = EditorAPI.render({pass:true})   // 评审图（纯背景 + 正交相机，可和参考图比剪影）
const js  = EditorAPI.exportJS()        // js.code —— 依赖 src/characters.orig.js 的 Q / XT
```

> ★ 完整流程、门的阈值、反模式、给模型的系统提示词 → **[`ai-pipeline.md`](ai-pipeline.md)**

**铁律**
1. 所有命令**永不抛异常**，失败返回 `{ok:false, error:"人话原因"}` —— 照 `error` 改参数即可。
2. 改完一定要 `validate()`；`ok:false` 时看 `errors`，`warnings` 是可疑但不致命（含"精细度不足"）。
3. `render()` 返回 PNG dataURL，是唯一的"视觉自检"手段，改完看一眼再交付。
4. **精细优先**：头发/马尾/兽耳/兽尾/饰品绝不用一两个大方块糊过去，用配方或算子拼（见第五节）。
5. 拿不准结构就 `schema()` / `help()` / `state()` / `recipes()`，不要猜字段名。

---

## 一、给大模型的总入口：`window.EditorAPI`

所有命令**只接受 / 返回 JSON 可序列化数据**，并且**永不抛异常**（失败返回 `{ok:false, error:"..."}`）。
在页面控制台或自动化里这样用：

```js
EditorAPI.help()          // 全部命令说明（纯文本）
EditorAPI.schema()        // 规格结构 / 分类 / 父级 / 调色板键 / 预算 / 角色表 / workflows / boxifyOptions
EditorAPI.state()         // 当前状态：stats、bbox、primitiveKinds、opSources、skippedHiddenMeshes、rigFormat、parts
EditorAPI.reference('lappland')   // ★ 原作低模的测量数据（做新角色的参照）
EditorAPI.sourceMeshes('lappland')// ★ 可拆分网格清单（索引/角色/分类/三角面/是否默认隐藏）
```

### 命令速查

| 分类 | 命令 |
|---|---|
| 自省 | `help()` `schema()` `state()` `reference(source?)` `sourceMeshes(source?)` |
| 规格 | `getSpec()` `setSpec(spec)` `loadPreset(name)` `loadBase(source)` `boxify(source,opts?)` |
| 部件 | `addPart({id?,name,category,parent,metalness?})` `addPartJSON(part)` `updatePart(id,patch)` `removePart(id)` `duplicatePart(id,newId?)` `listParts()` |
| 图元 | `addPrimitive(partId,prim)` `updatePrimitive(partId,index,patch)` `removePrimitive(partId,index)` `listPrimitives(partId)` · 四种 `kind`：`box` `panel` `op` `geo` |
| **精细构造** | `buildPart({recipe,params,ops,mirror,color,id,name,category,parent})` `build(partId,ops,opts)` `recipes()` `recipe(name,params)` `detailReport()` |
| **参照图** | `setRefImage(src,opts)`（异步，要 `await`） `refImage()` `updateRefImage(patch)` `clearRefImage()` `sampleRefColor(u,v)` `refPalette(n,region?)` |
| **导入体素/模型** | `importVox(src,opts)`（异步）`importMesh(src,opts)`（异步）`inspectVox(src)`（异步）· 吃 VoxelAI Studio / MagicaVoxel 的 `.vox` 和任意 `.glb/.gltf/.obj` |
| **导入雕塑规格** | `importSculptSpec(src,opts)`（异步）· 吃 **img2threejs** 技能产出的 `object-sculpt-spec.json`（`componentTree`）→ 直接变成可编辑的命名部件 |
| **★ 生成流水线** | `pipeline()` `pipelineMark(stepId,{status,evidence,reason})` `record(action,{evidence,score})` `pipelineSetPass(id)` `pipelineReset(opts?)` `contract(patch?)` `setContract(patch?)` `saveSession()` `loadSession()` `exportSession()` `importSession()` · **手册见 [`ai-pipeline.md`](ai-pipeline.md)** |
| **★ 质量门** | `gates(opts)`（异步）`gateFailDetail(gate)` `admit()` `refCrop(rect)` `baseline(action)` · 8 个门：轮廓 IoU / 转盘 / 内外差 / 左右镜像 / 接缝 / 净空 / 头皮覆盖 / 穿插 |
| **★ AI 便捷件** | `tree({full?})` `describe(partId)` `findParts(q)` `recipeSchema()` `upsertPart(part)` `addParts([...])` `mirrorPair(partId)` `updatePrimitives([...])` `variantSpec(base,v,name?)` `snapshotPrimPositions()` `selectByPositions(list)` |
| **★ 保存 / 新增模型** | `saveModel({name,note,confirmed})`（异步）`listStoredModels()` `loadStoredModel(id)` `confirmModel(id)` `unconfirmModel(id)` `removeStoredModel(id)` · 目录分工见 [`storage.md`](storage.md) |
| **★ 模型文件 / 角色索引** | `modelFile({withJs?})`（当前**没保存**的状态 → 标准模型文件形状）`characters()`（原作角色索引）`exportCharacterIndex()`（写回 `data/characters.json`）`aiIndex()`（AI 入口总览）· **见 [`model-files.md`](model-files.md)** |
| **★ 缓存 / 显卡 / Agent** | `cachePut({name,data})` `gateAndCache({passId})` `cacheList()` `cacheClear()` `gpu()` · **接管租约**：`agent()` `setAgent(name,note,ttl)` `agentRelease(note)` `agentPing()`（★ 退出必须交还，超 30 分钟自动释放）· 都在 `TemporaryCache/` 里，随时可清 |
| 基础网格 | `listBaseMeshes()` `setBaseTransform(key,{p?,r?,s?})` `hideBaseMesh(key,bool)` `showAllBase()` |
| 分区规则 | `listZones()` `setZones([...])` `addZone(z,i?)` `updateZone(i,patch)` `removeZone(i)` `moveZone(i,delta)` `rezone()` `zonesFromSelection(name)` |
| 切割面 | `addZonePlane(i,{n,d,side})` `setZonePlanes(i,[...])` `zonePlaneFromSelection(i)` `showPlane(i,pi)` `hidePlane()` |
| 外观/骨架 | `setPalette(key,color)` `setPaletteAll(obj)` `setIris([c1,c2,c3])` `setRig(patch)` · `setRig` 会把 `groups` 和旧扁平字段**一起写**（只写扁平字段对已 build 过的规格是无效的） |
| 选择/视口 | `select(keys[])` `selectPart(id)` `selectBaseGroup('head'|'左臂'|…)` `clearSelection()` `setMode('translate'|'rotate'|'scale'|'select')` `setSpace('local'|'world')` `camera({target?,position?,fit?})` |
| 输出 | `render()`（返回 `dataURL`，可用来"看"当前模型） `exportJS()` `exportSpecJSON()` `validate()` `undo()` `redo()` `batch(cmds[])` |

颜色可以写 `0xRRGGBB`、`'#RRGGBB'` 或调色板键名（如 `'hair'`、`'trim'`）。

### 预设（`loadPreset(name)`）

| 名字 | 说明 |
|---|---|
| `拉普兰德（低模·基础）` | base 模式，直接吃原作 `XT('lappland')`（含脸） |
| `通用体型` | ★ **从零捏人的起点**。比例全部按实测拉普兰德：`armX 0.410 / armY 1.11 / headY 1.40 / legX 0.185 / legY 0.72`，`head.scale=[1.672,1.54,1.518]`。10 个部件 / 3744 面；头发是 **5 个部件、21 个小模块**（主帽 / 刘海 / 侧发 / 后发板 / 长发），不自带兽耳。**6 个可测的质量门全过**，`clearance` 全 0%（没有一缕头发沉进头骨） |
| `高个` `矮胖` `大头` `瘦长` | `variantSpec()` 生成：**按比例缩放几何**（不是只挪骨架），并解出两个约束。现在它挂在 API 上了：`EditorAPI.variantSpec(baseSpec, {…}, name)` 返回新 spec（纯函数，不动当前规格） |

**变体是怎么做的**（老做法只改 `rig` 数字 → 躯干还是原尺寸、腿悬空、脖子裂开）：

```js
// variantSpec(base, {height, width, head, armLen, armThick, legThick}, name)
//   ① 三组几何分别缩放：body 组按 (width, height, width)
//                        arm 组按 (armThick, armLen, armThick)
//                        leg 组按 (legThick, 一致, legThick)
//   ② 解约束一：腿长 = 胯高 / 脚底到 leg 组原点的距离  → **脚正好落在地面**
//   ③ 解约束二：头高 = 颈顶 + |头骨下沿| × headScaleY → **头底落在颈上**
//   头部局部坐标**不动**，整体靠 headScale 放大（原作就是这么做的）
```

实测 5 个预设全部 `validate` 通过、脚底 y = 0.0000、6 个门全过：
总高 `2.076 / 2.482 / 2.344 / 2.527 / 2.501`（基准 / 高个 / 矮胖 / 大头 / 瘦长）。

| 变体 | height | width | head |
|---|---|---|---|
| `高个` | 1.10 | 0.95 | 0.90 |
| `矮胖` | 0.90 | 1.14 | 1.06 |
| `大头` | 0.88 | 1.02 | 1.28 |
| `瘦长` | 1.08 | 0.86 | 0.95 |

> ⚠ **写挂在 `head` 下的部件坐标时注意**：`head` 组被缩放了 `1.672 / 1.540 / 1.518`（原作的大头技巧），
> 所以那里的坐标是「**头局部**」单位，乘 1.67 才是世界尺寸。
> 老模板就是踩了这个坑（按未缩放写了 0.70 宽的头发盒 → 实际渲染 1.17 宽，糊成一个头盔），
> 另外它把 `armX` 写成了 0.51（实测 0.36）→ 手臂往外支出去 0.15。
> `armL/armR/legL/legR` 组不缩放，`body` 组在原点。
>
> ⚠ **写刘海时注意三条**（少一条就变成「贴在脸上的黑条」）：
> ① 片宽 > 片间距 → 相邻片在根部交叠，锯齿只出现在发梢，才不会露额头；
> ② 深度够大 + z 往后收 → 大部分嵌进额头，只露正面；
> ③ 外侧片收 z / 变短 / 向内倾 → 头的正面是圆弧，外侧没有面可贴，不收就会飘在轮廓外面。
>
> ⚠ **写相连部件时注意**：相邻件必须**在三个轴上都真的重叠**，只看包围盒会漏。
> 老模板的手臂 bbox 和躯干相交，但**上臂的 y 范围（0.86~1.11）和肩杠的 y 范围（1.30~1.43）完全不相交**
> → 剪影里手臂是飘着的两块；大腿顶（0.652）和胯底（0.668）差 0.015 → 双腿也是断开的两块。
> 这种问题 `turntable` 门会报「有视图没被清晰分离」。

---

## 二、规格（spec）长什么样

```js
{
  id:'myguy', name:'我的角色',
  mode:'parts',                     // 'base' = 用原作低模当基础；'parts' = 拆分/手工图元模型
  base:null,                        // mode='base' 时: {source:'lappland', transforms:{}, hidden:[]}
  useOrigFace:true,                 // 用原作 jT/MT 生成「头+脸」（含眼睛贴图）
  iris:[0xf2a63c,0xffd27a,0xffffff],
  palette:{ hair:0x..., hairShade:0x..., coat:0x..., coatShade:0x..., trim:0x..., eye:0x..., skin:0x..., metal:0x... },
  rig:{ // ★ 骨架 = 每个组的完整 TRS。新格式（推荐，能表达原作小腿那种缩放）：
        groups:{ body:{p:[0,-0.1095,0],r:[0,0,0],s:[1,1,1]}, head:{p:[0,1.47,0],r:[0,0,0],s:[1.672,1.54,1.518]},
                 armL:{…}, armR:{…}, legL:{p:[-0.16,0.73,0],r:[0,0,0],s:[1,0.85,1]}, legR:{…},
                 coatTails:{…}, tail:{…}, root:{p:[0,0,0],r:[0,0,0],s:[1.008,1.008,1.008]} },
        // 旧格式（仍兼容）：
        bodyY:0, headY:1.47, armX:0.36, armY:1.2183, legX:0.16, legY:0.73,
        headScale:[1.672,1.54,1.518], rootScale:1.008, coatTails:[0,1.05,-0.1], tail:[0,0.77,-0.23] },
        // ⚠ 两种格式**同时存在**，而 `applyRig()` 只看 `groups`（一见 groups 就用它、直接 return）。
        //   第一次 build() 之后 groups 一定会有。所以**读骨架看 groups，写骨架用 setRig()**
        //   —— 自己去改 `spec.rig.headY` 这种扁平字段，对已 build 过的规格是「改了没用」。
  zones:[ /* 分区规则，见第四节 */ ],
  parts:[ { id, name, category, parent, metalness, mirror, primitives:[...] } ]
}
```
> `state().rigFormat` 会告诉你当前用的是 `'groups'` 还是 `'legacy'`。

**图元**
```js
{ kind:'box',   x,y,z, w,h,d, color, rotX, rotY, rotZ }     // 圆角盒（最小边>0.12）或方盒
{ kind:'panel', points:[[x,y],...], depth, z, color }        // 2D 多边形沿 Z 挤出
{ kind:'op',    src, mesh, prim, tris, x,y,z, rotX,rotY,rotZ, sclX,sclY,sclZ,
                color:null|0xRRGGBB, metalness, roughness }  // ★ 原作图元（boxify 产生）
{ kind:'geo',   shape, w,h,d, x,y,z, rotX,rotY,rotZ, sclX,sclY,sclZ, color, params }
                // ★ 通用几何体：shape = box|sphere|ellipsoid|cylinder|cone|capsule|torus|lathe|extrude
                //   params = { seg, seg2, tube, open, points:[[x,y],...], depth }
                //   w/h/d 烘进几何；sclX/Y/Z 留给你继续缩放。lathe/extrude 用 points 给轮廓/截面。
```
`kind:'op'` 是 `boxify()` 拆出来的**原作图元引用**：
- `src/mesh/prim` —— 指向 `sourceMeshes(src)`（公开接口）里第 `mesh` 个网格的第 `prim` 个原始图元；
  （内部还有个 `sourceParts(src)` 能拿到真实顶点数组，但它不挂在 `window.EditorAPI` 上——别在 Agent 脚本里调它）
- `tris` —— 可选的三角形子集下标数组（按分区规则切出来的那一部分），`null` = 整块；
- `x/y/z` —— 该（子）图元的形心，也就是这个网格在父级组里的位置；
- `rotX/rotY/rotZ`、`sclX/sclY/sclZ` —— 编辑器里的变换（默认 0 / 1）；
- `color` —— `null` = 用原始顶点色；给了值则整块覆盖（含原作那种 `0.92+0.08*ny` 的明暗）；
- `metalness/roughness` —— 从原网格材质带过来，保证外观一致。

几何本身是**只读**的（来自原作），能改的是变换与颜色。想从零搭几何用 `box`/`panel`。

**父级**：`body`(身体) `head`(头) `armL` `armR`(左右臂) `legL` `legR`(左右腿) `coatTails`(后摆) `tail`(兽尾)

**分类**（原作 studyCategory）：`基础头型 基础手臂（含手） 基础身体 基础腿部 头发 身体装饰 手臂装饰 腿部装饰 鞋子 兽耳 尾巴 额外装饰 武器／手持道具 服装装饰 隐藏杯子 隐藏纸箱 脖子`

---

## 三、★ 做新角色的推荐流程

```js
// 1) 拿参照：原作拉普兰德的精确比例 / 调色板 / 虹膜 / 每个部件的包围盒
const ref = EditorAPI.reference('lappland');
//   ref.rig        -> { headY:1.47, armX:0.36, armY:1.2183, legX:0.16, legY:0.73, headScale:[...] }
//   ref.palette    -> { hair:14542308, shade:10333105, coat:2502714, trim:14804449, eye:12238784 }
//   ref.iris       -> [5663079, 9415331, 12767944]
//   ref.groups     -> 各部件在世界空间的 center/size（照着摆）
//   ref.meshes     -> 每个网格的分类 / 角色 / 尺寸 / 中心 / 平均色

// 2) 从拉普兰德的骨架与配色起手
EditorAPI.setRig(ref.rig);
EditorAPI.setPaletteAll({ hair:0x9a4de3, coat:0x1b1d24, trim:0xf0f4f8 });

// 3) 加部件 / 图元（parent 用父级键，颜色可用调色板键名）
const p = EditorAPI.addPart({ name:'双马尾', category:'头发', parent:'head' });
EditorAPI.addPrimitive(p.id, { kind:'box', x:-0.42,y:0.1,z:-0.16, w:0.16,h:0.6,d:0.18, color:'hair', rotZ:0.22 });
EditorAPI.addPrimitive(p.id, { kind:'box', x: 0.42,y:0.1,z:-0.16, w:0.16,h:0.6,d:0.18, color:'hair', rotZ:-0.22 });
EditorAPI.updatePart(p.id, { mirror:true });          // 一键镜像到对侧

// 4) 批量（一次提交多条）
EditorAPI.batch([
  { cmd:'addPart',      args:{ id:'coat', name:'外套', category:'服装装饰', parent:'body' } },
  { cmd:'addPrimitive', args:['coat', { kind:'panel', points:[[-0.3,1.3],[0.3,1.3],[0.2,0.4],[-0.2,0.4]], depth:0.06, z:-0.15, color:'coat' }] },
  { cmd:'setPalette',   args:['trim', '#9fe0b0'] }
]);

// 5) 校验 + 看一眼 + 导出
EditorAPI.validate();                 // {ok, errors, warnings, stats, budget}
const shot = EditorAPI.render();      // shot.dataURL 是当前画面（PNG dataURL）
const js   = EditorAPI.exportJS();    // js.code 可直接贴进 src/characters.orig.js
```

**另一种起手式：把原作角色精确拆成可单独编辑的图元**

```js
EditorAPI.sourceMeshes('lappland');        // 先看有哪些网格（含「默认隐藏件」）
EditorAPI.boxify('texas');                 // 默认：精确拆分，保留原始形状
EditorAPI.boxify('texas', { includeHidden:true });   // 连原作默认隐藏的件一起拆
EditorAPI.boxify('texas', { splitByZone:false });    // 不按分区切三角形（整块图元为一件）
```

拆分原理（**不是包围盒近似**）：
```
原作 Q.build() 把「一个网格 = 若干净图元」合并成一个 BufferGeometry，
同时在 geometry.userData.primitiveVertexCounts 里留下每个图元占多少顶点。
→ 照这张表切，切出来就是 100% 原始图元：
   圆弧倒角、斜切面、任意多边形挤出的锯齿边，全部原样保留；
   顶点色 / 法线逐顶点复制 → 外观与原作逐像素一致。
→ 再按分区规则，把「每个三角形的形心」分到语义子部件（仍是原始三角形，形状零损失）。
→ 祖先 visible=false 的网格是原作里的「默认隐藏件」，默认跳过，不再被翻出来。
```
拉普兰德实测：**146~157 个图元 / 24 个语义部件 / 4704 面**，与原作逐像素一致（正/侧/背对比差异 0.000%）。

### 用 `op` 图元做精细编辑

拆分后每个部件由若干 `kind:'op'` 图元组成。大模型可以直接读写它们的字段：

```js
const parts = EditorAPI.listParts();                    // 含 triangles
const ps    = EditorAPI.listPrimitives('head__长发');    // [{index,kind,src,mesh,prim,tris,x,y,z,...,triangles}]

// 改变换 / 颜色（几何只读，改的是摆放与配色）
EditorAPI.updatePrimitive('head__长发', 0, { x:0.1, rotY:0.35, sclX:1.2, color:'#c0ffee' });  // color:null = 还原原始顶点色
EditorAPI.updatePrimitive('head__长发', 1, { color:null });

// 把「另一个原作图元」加进某个部件（先查有哪些）
const m = EditorAPI.sourceMeshes('lappland');            // [{index,name,role,category,triangles,primitives,hidden}]
EditorAPI.addPrimitive('head__长发', { kind:'op', src:'lappland', mesh:m.meshes[0].index, prim:3 });
// 只要这个图元的某几个三角形也可以：{ kind:'op', src, mesh, prim, tris:[0,1,2,3,4] }

// 换源图元 / 换三角形子集（不给 x/y/z 就自动落到新子集的形心）
EditorAPI.updatePrimitive('head__长发', 0, { mesh:0, prim:7 });
```

失败时会返回可照做的错误，例如：
`{ok:false, error:"三角形下标越界: 99999（该图元共 108 个三角形）"}` /
`{ok:false, error:"源图元不存在: lappland mesh=99 prim=0（用 sourceMeshes('lappland') 查）"}`。
`validate()` 的 `warnings` 也会提示「同一源图元被多个图元引用（rezone 归属有歧义）」。

---

## 四、自定义分区（subLabel / 分区规则）

`boxify()` 把每个图元归到哪个子部件，由**可编辑的分区规则表**决定（默认 29 条）。

```js
zone = {
  enabled: true,
  label : '双马尾 L',
  role  : 'any|body|head|armL|armR|legL|legR|coatTails|tail',
  cat   : 'any|基础头型|头发|服装装饰|…',
  box   : { x:[min,max], y:[min,max], z:[min,max] },        // 父级组局部坐标，±1e9=不限
  planes: [ { enabled:true, n:[nx,ny,nz], d:number, side:'>='|'<=' } ]
}
```
**自上而下匹配，第一条命中生效。** `box` 内是 AND；`planes` 里每个面都要满足（也是 AND）。

> 匹配的粒度是**三角形**：`boxify()` 与 `rezone()` 都是拿「每个三角形的形心」去查规则，
> 所以一条规则能把一个图元切开（比如把一条斜的马尾从整块头发里切出来），切完仍是原始三角形、形状零损失。

### 命令

```js
EditorAPI.listZones()                        // 读取
EditorAPI.addZone(zone, index?)              // 新增（index 省略则插到最前＝最高优先级）
EditorAPI.updateZone(i, patch)               // 改 label/role/cat/enabled/box/planes
EditorAPI.removeZone(i) / moveZone(i, delta) // 删除 / 上移下移
EditorAPI.setZones([...])                    // 整体替换
EditorAPI.rezone()                           // ★ 回到「原始三角形」按每三角形形心重新分组
                                             //   → 规则/切割面改完调它，能真正把图元切开；
                                             //   同时保留你已做的位移/旋转/缩放
EditorAPI.zonesFromSelection('双马尾 L')      // ★ 用视口选中的图元自动生成区域规则并重新分区
```

### 典型流程：给头发加「双马尾 L / R」

```js
EditorAPI.boxify('lappland');                 // 1) 先精确拆成可编辑图元
EditorAPI.selectPart('head__长发');            // 2) 选中左后侧那批图元（也可视口里 Ctrl+点 / Shift+框选）
EditorAPI.zonesFromSelection('双马尾 L');      // 3) 用它们的包围盒建规则 + 立即重新分区
// → 部件树里出现 head__双马尾 L，可以整组拖走或继续细分
```
实测：选中 2 个左后侧图元 → 规则升到 30 条 → 部件表出现 `head__双马尾 L`，`长发` 相应减少。

### 切割面（刀切平面）

轴对齐包围盒对付斜向的部件（比如一条向后下方甩的马尾）不够用，所以规则还能叠加**任意半空间** `n·p ≥ d`（或 `≤`）。
多个面之间、以及与 `box` 之间都是 AND，于是可以斜着切。

```js
EditorAPI.addZonePlane(i, {n:[nx,ny,nz], d, side:'>='|'<='})   // 给第 i 条规则加一个切割面
EditorAPI.setZonePlanes(i, [...])                              // 整体替换
EditorAPI.zonePlaneFromSelection(i)                            // ★ 用当前选区自动定面
EditorAPI.showPlane(i, planeIndex) / hidePlane()               // 视口显示 / 收起
```

`zonePlaneFromSelection` 的自动策略：
- **法向** = 父级组原点到选区中心的方向（对"长在身上的附属物"通常就是好的分离方向）
- **d** = 选区在法向上的**最小投影**（保证整块落在保留侧），往里拖滑块就开始切
- **side** = `>=`

面板里每条规则展开后：`法向[预设▾][x][y][z]` + `保留[+法向/-法向] [偏移滑块] 数值 [看面][删]`，
按钮 `＋切割面` / `从选中定面`。**拖动偏移滑块会实时重新分区**（90ms 节流），配合 3D 里绿色的半透明切割面，所见即所得。
法向预设：`X轴 / Y轴 / Z轴 / 斜·左后 / 斜·右后 / 斜·上后`。

实测（拉普兰德）：选中 2 个左后侧头发盒子 → `zonesFromSelection('马尾 L')` → `zonePlaneFromSelection(0)`
自动得到 `n=[-0.505,-0.46,-0.73], d=0.384`；拖动 d：

| d | 该分区盒数 |
|---|---|
| 0.284 ~ 0.384 | 2 |
| 0.434 | 1 |
| ≥ 0.484 | 0（分区被切没） |

---

## 五、★ 用参照图 / 提示词改造角色（精细优先）

### 5.1 为什么要「精细优先」

**一个部件只放一个大方块 = 失败。** 头发 / 马尾 / 兽耳 / 兽尾 / 饰品必须**用多个小模块拼出参考图的轮廓与走向**。
这套工具为此给了两层能力：

- **配方**（`recipes()`）—— 常见部件一句话生成，一次产出几十个小图元；
- **算子 DSL**（`build(partId, ops)` / `buildPart({ops})`）—— 自己写 `sweep / row / cluster / plate` 组合，精确复刻参考图。

`validate()` 会检查「手工图元太少」并给出警告，`detailReport()` 会列出哪些部件偏粗糙。

### 5.2 完整工作流

```js
// ① 把参考图贴进视口当「描图底」（唯一的异步命令，要 await）
await EditorAPI.setRefImage(参考图的 dataURL 或同源 URL, { opacity:0.4, plane:'front', height:2.6 });

// ② 从参考图取色 / 提主色板（用 region 只统计人物区域，避开背景）
EditorAPI.sampleRefColor(0.5, 0.30);                          // → { hex:'#bfa785', rgb:[...], x,y }
EditorAPI.refPalette(6, { x:0.25, y:0.05, w:0.5, h:0.9 });    // → [{ hex, rgb, share }]

// ③ 拆原模型（要改原角色）或 loadBase（只想加新东西、先挡掉原角色）
EditorAPI.boxify('lappland');

// ④ 加精细部件：先看配方产出的算子表，想调再调，然后生成
const r = EditorAPI.recipe('twinTail', { side:-1, length:0.62 });   // r.ops 可改
EditorAPI.buildPart({ recipe:'twinTail', params:{ side:-1, length:0.62 }, color:'#77848b' });
EditorAPI.buildPart({ recipe:'animalEar', params:{ side:1 }, mirror:true });  // 一次做两只

// ⑤ 自己写算子表拼复杂形状（披风：一片扫掠 + 一排扣子）
EditorAPI.buildPart({ name:'披风', category:'服装装饰', parent:'body', ops:[
  { op:'sweep', path:[[-0.30,1.30,-0.15],[0,0.85,-0.30],[0.02,0.35,-0.28]], count:14,
    profile:[[0.50,0.12,0.10],[0.62,0.10,0.08]], color:'coat' },
  { op:'row', from:[-0.28,1.28,-0.18], to:[0.28,1.28,-0.18], count:6, size:[0.06,0.10,0.06], color:'trim' }
]});

// ⑥ 叠图自检 → 迭代（render() 会带上参照图）
const shot = EditorAPI.render();                 // 看得见模型 + 描图底
EditorAPI.updateRefImage({ opacity:0.15 });      // 调淡一点看清模型

// ⑦ 收尾
EditorAPI.detailReport();                        // 哪些部件还不够细
EditorAPI.validate();
EditorAPI.exportJS();
```

> 参照图的四个位置：`plane:'front'|'back'|'left'|'right'`；`updateRefImage({opacity,height,plane,position,rot,visible})` 随时调。
> `sampleRefColor(u,v)` 的 `(0,0)` 是**左上角**，`refPalette(n, region)` 的 region 也是归一化矩形。

### 5.3 四个算子

| 算子 | 用途 | 关键字段 |
|---|---|---|
| `sweep` | 沿折线扫掠一串**渐变小盒**（发束 / 马尾 / 尾巴 / 绳子 / 绑带） | `path:[[x,y,z],…]` 控制点、`count` 段数、`profile:[[w,h,d],[w,h,d]]` 起止截面、`color`、`align:false` 关闭沿切线朝向、`overlap` |
| `row` | 沿直线**等距排列**（刘海锯齿 / 链条 / 铆钉 / 齿） | `from` `to` `count` `size` `sizeTo` `rot` `rotStep` |
| `cluster` | 在盒范围内**撒小盒**（蓬松头发 / 毛簇 / 碎发） | `box:{c:[x,y,z],s:[w,h,d]}` `count` `size:[min,max]` `rotRand` `seed` |
| `plate` | 多边形**挤出薄片**（衣襟 / 饰片 / 缎带） | `points:[[x,y],…]` `z` `depth` `color` |

坐标都是**该部件父级组的局部空间**。参考实测范围（拉普兰德）：
`head` x±0.46 / y[-0.58,0.70] / z[-0.443,0.353]　`body` y[0.71,1.52]　`tail` z[-0.83,-0.03]　`armL` z[-0.13,1.51]。

### 5.4 配方（`recipes()` / `recipe(name, params)` / `buildPart({recipe,params})`）

| 名字 | 标签 | 父级 | 主要参数 |
|---|---|---|---|
| `hairStrand` | 一束头发 | head | `from` `to` `thick` `count` `curl` |
| `bangs` | 刘海 | head | `width` `y` `z` `length` `count` `depth` |
| `twinTail` | 双马尾（单侧） | head | `side` `x` `y` `z` `length` `strands` `thick` `count` `swing` |
| `ponytail` | 单马尾 | head | `x` `y` `z` `length` `strands` `spread` `thick` `count` |
| `backHair` | 后发（长发） | head | `y` `z` `length` `width` `strands` `thick` `count` |
| `animalEar` | 兽耳（单只） | head | `side` `x` `y` `z` `height` `width` `depth` `count` |
| `animalTail` | 兽尾 | tail | `from` `to` `thick` `count` |
| `hairAccessory` | 发饰 | head | `x` `y` `z` `size` `beads` |
| `scarf` | 围巾 | body | `y` `z` `radius` `seg` `thick` `drop` |
| `pouch` | 挎包 | body | `x` `y` `z` `w` `h` `d` `strap` |

`side` 只做单侧，`buildPart({..., mirror:true})` 才是两侧。

### 5.5 改 / 增 / 删 一览

| 目的 | 命令 |
|---|---|
| **改** | `updatePart(id,{name,category,parent,metalness,mirror})`、`updatePrimitive(id,i,{x,y,z,rot*,scl*,color,…})` |
| **增（整体）** | `addPart({…})` → `addPrimitive(partId,{kind:'box'\|'panel'\|'op'})` |
| **增（精细，推荐）** | `buildPart({recipe,params,mirror,color})`、`buildPart({ops:[…]})`、`build(partId, ops)` |
| **删** | `removePrimitive(partId,i)`、`removePart(id)`；原作图元可用 `updatePrimitive(id,i,{tris:[…]})` 只留一部分三角形；`hideBaseMesh(key,true)` 隐藏基础网格 |
| **复位** | `loadBase(id)` 回到干净基础；面板里「清空新增部件」 |

### 5.6 给大模型的系统提示词（可直接粘贴）

```text
你是一个低模角色编辑助手，通过 window.EditorAPI（JSON 接口，永不抛异常）操作
pages/character-editor.html 里的低模模型。用户会给你参考图或提示词，要求改造角色。

硬性要求：
1) 精细优先。加头发/马尾/兽耳/兽尾/饰品时，绝不允许只用 1~2 个大方块。
   优先用 buildPart({recipe}) 生成几十个小图元；配方不够贴合就用 buildPart({ops})
   自己组合 sweep / row / cluster / plate，让轮廓跟着参考图的走向。
2) 配色要来自参考图：先说 setRefImage(图) → refPalette(6,{x,y,w,h}) 提主色，
   再把这些 hex 用到 color 上；不要凭想象配色。
3) 位置要"量"出来：先 boxify(id) → state()/listParts() 看父级与范围，
   再用 reference(id) 的比例，必要时 sampleRefColor 核对颜色。
4) 每次改完必须 validate()；有 warnings 就按提示改（比如"手工图元太少"）。
5) 用 render() 叠着参照图自检，和参考图不一致就继续迭代（调 params / ops 里的数值）。
6) 不确定结构就 schema() / help() / recipes() / state()，不要猜字段。

推荐顺序：
  await setRefImage(图) → refPalette/sampleRefColor → boxify(id)（或 loadBase）
  → recipes() 找配方 → buildPart(...) → detailReport()/validate()
  → render() 对比 → 调参迭代 → exportJS() 或 exportGLB()

失败处理：返回 {ok:false,error:"…"}，error 里已经写了怎么改（例如"三角形下标越界：
99999（该图元共 108 个三角形）"），照着改参数重试即可。
```

---

## 六、导入外部体素 / 模型（VoxelAI Studio、MagicaVoxel、任意 GLB）

用别的体素建模器做好一块，**直接导进来当可编辑的 `box` 图元** —— 不用手抄坐标。

```js
await EditorAPI.inspectVox('/tail.vox');        // 先看统计：体素数 / 合并后块数 / 尺寸
await EditorAPI.importVox('/tail.vox', {        // .vox → 逐体素解析 → 贪心合并 → box 图元
  parent:'head', position:[0.32,0.44,-0.03],    // 模型「底部中心」对齐到这里（父级局部坐标）
  fitHeight:0.62,                               // 自动缩放到这个高度（不给就用 scale，默认 1）
  name:'双马尾 R', category:'头发'
});
await EditorAPI.importMesh('/tail.glb', { parent:'head', position:[0,0,0], scale:0.01 });
```

- **`.vox`**：逐体素读出来 → 沿三轴贪心合并成大盒（150 体素 → 27 块）→ 每块一个 `box`，**颜色逐块保留**
- **`.glb/.gltf/.obj`**：载入后按**连通分量**拆成轴对齐盒（体素/DCC 导出的都是轴对齐块，正好）
- `up:'z'`（默认）：源是 Z-up（MagicaVoxel / VoxelAI）自动转成 three 的 Y-up
- `color:0xRRGGBB`：强制单色（比如想让整条马尾统一成 `'hair'` 调色板色）
- `mirror:true`：镜像到对侧
- 导进来就是普通 `box` 图元，之后照常用 `updatePrimitive` 改位置/尺寸/颜色

推荐流程（用别的工具建模）：

```
1. 在 VoxelAI / MagicaVoxel 里生成或手搓一个体素块
2. 导出 File → Export as… → 选 VOX(.vox) 或 glTF(.glb)
3. 文件放到 D:\ROTK\three.js\ 下
4. await EditorAPI.inspectVox('/xxx.vox')  看体素数、合并块数、原始尺寸
5. await EditorAPI.importVox('/xxx.vox', { parent, position, fitHeight })
6. render() 看一眼 → 不对就调 position/fitHeight，或 importVox 再来一份
```

---

## 六·B、导入 img2threejs 的「雕塑规格」（`object-sculpt-spec.json`）

[img2threejs](https://github.com/) 这个技能的产出（`componentTree`）**和本编辑器的规格同构**：

| img2threejs | 本编辑器 |
|---|---|
| `componentTree[].id / name / role` | 部件 `id / name / category` |
| `component.parent` | 沿父链累积世界矩阵（**位置是世界尺度，`scale` 只决定图元自身大小**） |
| `primitive` + `dimensions` | 图元 `kind:'geo'` 的 `shape` + `w/h/d` |
| `transform.position / rotation` | `x/y/z` / `rotX/rotY/rotZ` |
| `material` → `materials[].baseColor` | 图元 `color`（`#rrggbb` 直接写进 `color`） |

```js
const r = await EditorAPI.importSculptSpec('/refs/img2threejs-work/object-sculpt-spec.json');
// → { ok, parts, envelopes, triangles, source:{ target, version, components, suitability, scores, tier1 } }
await EditorAPI.importSculptSpec(jsonObjectOrDataUrl, { envelope:'render' });  // 保留 blockout 外框
```

**关键：规格是「逐遍构建」的，必须丢掉 blockout 外框。**
macro 级、`role` 是 `shell`/`garment`、且**有更细（meso）子级**的盒，是 blockout 外框，
真正的细节在它下面。两层都渲染 = 外框把细节吞掉（实测：`tail-l` 外框盒会把 5 段 `tail-slab` 盖住）。
默认跳过这种外框，`opts.envelope:'render'` 可保留。`body` 链（`pelvis→abdomen→chest→neck→head`）一律保留。

导入后：骨架 `rig` **归零**（那是它自己的比例，不套我们的角色网格）、`useOrigFace:false`、
部件全部挂在 `body` 下、坐标即规格里的世界坐标。所以配合 **`geo` 图元**用（见 §二）。

> 实测（`refs/img2threejs-work/object-sculpt-spec.json`，69 个组件）：导入 → 65 个命名部件 / 5232 面 →
> `validate()` 通过 → `exportJS()` 语法通过 → **执行导出代码得到 65 网格 / 5232 面，与编辑器内完全一致**（往返无损）。
> 该规格自评 Tier1 轮廓 IoU 0.40~0.47（阈值 0.85）= **FAIL**，所以导进来的样子本身是丑的 —— 那是规格的问题，不是导入的问题。

编辑器 UI：**显示 / 导出** 区块 → `导入雕塑规格`（填 URL 或选文件）；
原来的 `导入规格` 文件选择器也会自动识别带 `componentTree` 的 JSON 并走这条通路。

---

## 七、视口操作（人也能用）

| 操作 | 效果 |
|---|---|
| 左键点网格 | 选中（出现 gizmo） |
| Ctrl/Cmd + 点击 | 加选 / 减选 |
| Shift + 拖 | 框选 |
| W / E / R | 移动 / 旋转(自由 3D) / 缩放 |
| Delete | 删除（基础网格则是"隐藏"） |
| Esc | 取消选择 |
| 左栏「基础网格」组 | 点一下选中整组（如整条左臂） |
| 左栏「部件」 | 点一下选中整个部件（成组拖拽） |
| 右栏图元卡片 | 精确数值；面板类图元有 2D 多边形可视化编辑 |

---

## 八、参照数据文件

- `reference-models.json` —— **14 个原作低模的完整测量数据**（rig / 调色板 / 虹膜 / 分组包围盒 / 每个网格的分类·尺寸·中心·平均色）。
  大模型做新角色时直接读它，照着 `groups` 的比例摆件、照 `palette` 配色即可高度还原原作风格。

---

## 九、边界与注意

- `mode:'base'` 时基础模型是**原作烘焙几何**，只能整体移动/旋转/缩放/隐藏，不能逐个图元改；要逐个编辑请先 `boxify()`。
- `boxify()` 是**精确拆分**，不是近似：按 `primitiveVertexCounts` 切出原始图元，顶点/法线/顶点色逐顶点保留，
  渲染与原作**逐像素一致**（实测正/侧/背对比差异 0.000%）。每个图元的几何是**只读**的，
  能改的是它的位置/旋转/缩放/颜色覆盖。
- 原作里有**默认隐藏件**（祖先 `visible=false`，例如废弃的备用部件）。`boxify()` 默认跳过它们
  （否则它们会被翻出来，看起来像"位置不对"）。用 `sourceMeshes(id).hidden` 查看；
  需要时 `boxify(id,{includeHidden:true})`。
- 骨架 `rig` 记录每个组的**位置+旋转+缩放**（例如原作小腿组带 `scale [1,0.85,1]`）。
  只改 `mode:'base'` 的 base transform 不会动到 `rig`。
- 旋转是**自由 3D**（rotX/rotY/rotZ）；但 `panel` 是 2D 挤出体，只支持平面内旋转。
- 多选拖拽：**移动**跨父级可用；**旋转/缩放**要求同一父级且非镜像。
- 镜像规则：位置 x 取反，绕 y/z 的旋转取反，绕 x 的旋转不变（几何按 YZ 平面镜像）。
- `rezone()` 会改变部件 id 与图元索引，所以旧的 selection key 会失效；API 内部用「图元位置」还原选择
  （`snapshotPrimPositions()` → `selectByPositions()`，这两个现在都挂在 `window.EditorAPI` 上了），
  手工改 `spec` 后如选择错乱，重新点一次即可。
- 三角面预算 `schema().budget` 出自原作 **study(立绘)** 模型，游戏内低模不受此限制，仅供参照。
- 所有改动可用 `undo()/redo()` 回退（保留最近 60 步）。
