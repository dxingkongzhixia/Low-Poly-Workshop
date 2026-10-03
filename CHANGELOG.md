# 变更记录

> 每次会话的重大改动按时间倒序记在这里。**只记「为什么改 / 改了哪些文件 / 怎么验证」**，
> 细节和踩坑过程在 [`低模工坊-制作流程笔记.md`](低模工坊-制作流程笔记.md)。

---

## 2026-10-02 · 整合「自定义运行时」：初音未来 / 黑岩射手（状态机动画 + 武器池）

把外部项目（`hatsune-miku/`）的两个角色**连运行时一起**并进工坊 —— 不只是模型，还有它那套
**状态机动画 + 武器池**。方向是「**改成我们的模式**」：工坊原有的 14 人继续走原作动画，
我们的角色走我们自己的运行时（状态机 + 武器池；现在并入**角色实验室**的「新增模型 + 运行时面板」）。

| 文件 | 说明 |
|---|---|
| `src/characters.lowpoly.js` | 新增。运行时模块：`Builder`（= 原作 `Q` 的同源实现）+ 角色表 + `poseCharacter()` + `mountWeapons()` + **`exportSpec()` / `factorySource()` / `partBoxes()`** |
| `pages/character-studio.html` | 新增。**人物工作室**：我们的运行时（角色切换 / 移动状态机 / 12 活动 / 武器池），可导出并保存为「新增模型」、可跑质量门 |
| `src/shell.js` | 导航条加一页「人物工作室」 |
| `pages/character-lab.html` | ★ **改造**：原版 14 人接上我们的运行时 —— 渲染循环改用 `LP.poseCharacter()`（移动状态机 + 活动），低模构建时挂 `LP.mountWeapons()`（武器池）。**原生武器由池子接管**（`rig.nativeObjects`：装我们的武器就隐藏、`原生装备`还原）；面板「运行时 · 移动 / 活动 / 武器池」放在**干员下面**，武器池第一项是**持械**。`window.__lab` 暴露 `LP / RT / mountRuntimePanel`。importmap 从 jsdelivr 切到 unpkg |
| `NewlyAddedModelList/lp-miku`、`lp-brs` | 导出的模型（spec + model.js），实验室「新增模型」区可直接载入 |
| `src/characters.lowpoly.js`（补） | ★ **改用项目2（工坊）自己的武器**：`extractNativeWeapons()` 从 `XT(id)` 模型里**按名字分割**出武器（`croissant-hammer`/`hoshi-shield`/`swire-right-chain-weapon`/`mostima-staff`/`exusiai-vector`/`classic-chen-side-scabbard`/`emperor-silver-pistol`/`lappland.weapons[]`…）并关联到角色；**项目1（character-dsl）的 11 把几何不再并入**（改名 `PORTED_PROJECT1_WEAPONS` 留档）。攻击沿用**按类型的标准招**（`ORIG_ATTACKS`），原生武器直接借用 |
| `pages/character-lab.html`（补） | 武器池列出**全部** 13 把；`原生装备` = 装上**独立建模**的原生武器（`LOADOUTS[id]`）+ 隐藏烘在模型里的那把；`清空` = 回退到烘的那把；**持械默认原生**（`setArmed` 时原生武器 = 持械且手上没装独立武器） |
| 武器系统（补） | ① **硬上限 2 个手位**：`activeCount()` 按池各算 —— 角色池算开着的原生武器、共享池算装着的我们武器；**同一只手不重复计**，原生**开第 3 把 → 挤掉最早开的**；`equip` 去重 + 成对武器整对装卸；② **两个池、互斥**：`poolMode: 'native' \| 'shared'`，`setPool()` 切池；**用角色武器池 → 共享武器自动让位，反之亦然**（UI 上非当前池的武器按钮变灰；原生武器按钮用**下标**当 key，同名武器也能各自高亮）；③ **单手 / 双手**大类：`WEAPON_HANDS`（`twinBlades: 2`，默认单手），按钮标注「· 双手 / · 单手」；④ **每种类型一条标准招**（`ORIG_ATTACKS`），原生武器**每把各按自己的类型**跑标准招 —— **双手武器两手都有动作**（修了拉普兰德「只有一只手动」）；⑤ 武器按钮**只显示武器名**，动作名归「攻击」按钮；⑥ **背袋** `makeWeaponBag()`；⑦ 武器池**按角色重建**（换人=换该角色的原生武器，来自 `extractNativeWeapons()`） |
| `pages/character-lab.html`（补2） | ★ **初音未来 / 黑岩射手搬进「新增模型」**：`NEW_BUILTIN` 把两人注册为**内置新增模型**（列表最前，`where:'内置'`）；`loadNewFactory()` 对内置角色**不走服务器**，直接 `LP.buildCharacter(id).proto`；载入后挂 `LP.mountWeapons()` + 标 `runtime`，因此走**我们的状态机 + 武器池**。同时修：① **运行时面板点标题无法收起**（自定义 `#rtSec` 的 `<h2>` 没接 `collapsed` 开关）；② 选新增模型时**干员高亮没清**（`markOps()` 加 `P.model!=='new'`）；③ 从新增模型**切不回原作角色**（干员按钮没把 `P.model` 从 `'new'` 复位成 `'low'`，会一直重载同一个新模型）；④ **分区改名 / 重排**：`干员 → 原始模型`，`新增模型` 紧贴原始模型下面，`运行时` 再下面（`mountRuntimePanel` 的锚点从「干员」改成「新增模型」） |
| `src/characters.lowpoly.js`（补3） | ★ **`mountWeapons(model, [], { bind })`：带 `def` 的武器能绑进角色自带的**原生武器**（`nativeList`）** —— 和模型烘出来的原生武器同一套（开关 / 手位计数 / 动作），**不进共享池**。`holdTransform()` 抽出来给 entries 和绑定原生共用。**黑岩**：`LOADOUT = [黑岩巨炮·arm0, 黑刃·arm1]`（**炮在左手**，用回它自己的 `hand:0`）通过 `bind` 绑进她的**角色武器池**（之前误放进共享池默认装备 → 用户看到「角色武器池：本角色没有原生武器」）。★ **初音的葱 → 武器（锤类）**：`WEAPONS.leek`（`type:'hammer'`, `attacks:['hammer']`）进**共享池**；`extractNativeWeapons()` 新增**按名字精确覆盖**（`leek → hammer / 葱`）+ 改为**递归走查对象（组也算）**，于是初音模型里那根 `leek` 组被认成她**角色武器池**的原生武器。★ **光圈位置修正**：`addRing()` 挂到**场景**而非角色 root —— `poseCharacter()` 的**膝部接地钳制**会把 root 往上顶，黑岩（脚在原点下方 ~0.11）的光圈因此浮到脚踝；共享池也加上「葱」按钮。★ **招式数修正**：`moveCount()/attackLabel()/attackDuration()/attackPose()` 现在把**原生（含绑定）武器**也计入 —— 之前只看 `entries`（共享池），绑定后黑岩只剩 1 套招（少「竖斩」），现已恢复 2 套（连射+横斩 / 连射+竖斩）。★ **多武器按序**：新增 `attackSequence()` —— **同一个招式合并成一组**（双剑交叉斩两手同时），**不同招式按手序先后**（黑岩**先炮后刀**，不再一起执行）；时长各段相加，动作名用 `→` 连接 |
| 文档（补4） | ★ **把本轮整合写进对应文档**：`docs/lowpoly-runtime.md` 补 §6.1/§6.2（两池互斥 / 角色绑定 / 单手·双手 / 招式数 / 光圈 / 葱）；`docs/ai-pipeline.md` 新增 **§十一 程序化角色参考**（骨骼契约 + 生成步骤 + 武器挂载 + **特征驱动 > 参照图**）+ §6.1 第三条路线 + §九 反模式；`docs/ai-workflow.md` §9 补「先问需不需要参照图」；`docs/README.md` 文档索引 / 文件地图补 `lowpoly-runtime.md`、`characters.lowpoly.js`；`skills/ThreejS_Standard_modeling/SKILL.md` 加 **Feature-led beats image-led** 现场笔记 |
| 融合（补5） | ★ **两项目融合、去掉人物工作室**：删除 `pages/character-studio.html` + `src/shell.js` 导航项；运行时全部由**角色实验室**承载（内置「新增模型」+ 运行时面板）。★ **生成策略定为「程序化优先」**：写进 `ai-pipeline.md` §〇 规矩 5 / §八 系统提示词 9 / §十一（新增「只取特征、不取体态」对照表）、`lowpoly-runtime.md` §0、`ai-workflow.md` §9、`SKILL.md`。即：**有参照图也只取特征（头发/配色/道具/剪影要点），体态一律用标准骨架**；「参照图 → 逐像素对剪影」降级为「只在必须复刻已有剪影时用」。同时改 `character-lab.html` / `characters.lowpoly.js` 里对「人物工作室」的措辞 |
| 架构（补6） | ★ **运行时拆成模块 + 角色抽象类**：`src/characters.lowpoly.js`（1650 行）拆到 **`src/lowpoly/`** —— `model.js`（人物模型：骨架常量 + Builder 图元 + 脸 + buildMiku/BRS）· `weapons.js`（武器本体 + **挂载数 单手/双手** + **种类 刀/锤/枪/炮/盾/杖/链/箱**）· `moves.js`（武器动作）· `rig.js`（武器池绑定）· `actions.js`（动作绑定：移动/活动）· `character.js`（**`Character` 抽象类** + `Miku`/`Brs` + `CHARACTERS` 注册表）· `export.js`（导出）· `index.js`（出口）；原文件变 **barrel**，老 `import` 一行不改。新增 `Character.assemble()`（模型 + 武器池一键装配）、`weaponCategory()/describeWeapon()`。★ **性能**：`characters.hires2.js`（~840KB）从**静态 import 改成首屏后按需加载**，不再压启动（DCL 233ms 不变，但首屏不再解析 837KB；高模功能照常）。验证：0 报错，黑岩（炮→刀 序列）/初音（葱）/原作 14 人全无回归，`exportSpec`/`factorySource` 正常 |
| 修正（补7） | ★ **初音 / 黑岩 现在是真的文件**：之前为了免服务器依赖，两人是实验室里的**客户端内置**（`NEW_BUILTIN`）→ `NewlyAddedModelList/` 里什么都没有。现改为用 `exportSpec`+`factorySource` 存成**正式新增模型** `NewlyAddedModelList/miku/`、`brs/`（各含 `model.json` + `model.js`）；实验室**从磁盘读列表**，载入时按 id 命中 `LP.CHARACTERS[id]` 就用**运行时本体**构建（全质量，不是 model.js 小解释器）。删掉 `NEW_BUILTIN` 注入，新增 `runtimeChar()` 判定 |
| 武器库 + 武器页 + 去换装室（补8） | ★ **武器独立成一条线**：新增 `NewlyAddedWeaponList/` + `NewlyAddedWeaponTemporaryList/`（每把武器一个子目录，`weapon.json` + `weapon.js` + `thumb.png`），格式含**挂载数 mount（单手/双手）· 种类 kind（刀/锤/枪/炮/盾/杖/链/箱）· 绑定的动作 moves**。★ `tools/_serve.js` 把 `/api/models` **泛化成 `kind`**，新增 **`/api/weapons`**（list/get/bundle/files/file/save/confirm/unconfirm/delete，与模型一一对称）；`Store` 加 `listWeapons/getWeapon/saveWeapon/confirmWeapon/removeWeapon/…`。★ 新增 **`pages/weapon-editor.html`**（独立路线：无骨架，武器在自身坐标系建、握把=原点；挂载数/种类/**动作绑定**（从 `ATTACKS` 多选）/图元 JSON + 实时预览），暴露 **`window.WeaponAPI`** 给 AI（规则后续补充）。★ **删掉换装室** `pages/character-mixer.html`（项目1 路线）+ 导航项 + 首页卡片 + selfcheck/LEGACY 表 + 全库文档引用。★ 新增文档 [`docs/weapon-files.md`](docs/weapon-files.md)。验证：`/api/weapons` 200、武器页 0 报错、`WeaponAPI` 存/确认/列表通 |
| 原版武器库（补9） | ★ **武器库的武器 = 共享池**：新增 **`OriginalWeaponList/`**（原版武器库，正式一层）—— **黑刃 / 黑岩巨炮 / 葱** 已落盘（`weapon.json`，含 `runtime` 指针 + `mount`/`kind`/`moves`/`grip`/`hold`，几何以 `lp/weapons.js` 代码为准，`README` 说明）。服务端 `KINDS.original` + **`/api/original-weapons`**（复用同一套读写；修了「原版库 confirmed/temporary 同目录 → 写正式会把自己删掉」的坑）。`Store` 加 `listOriginalWeapons/getOriginalWeapon/saveOriginalWeapon`。武器编辑器拆成 **「原版武器库」（共享池，在上）** + **「新增武器库」（在下）**，点原版武器直接调运行时 `LP.Builder` **预览几何**；`WeaponAPI` 加 `listOriginal/original`。文档补 `weapon-files.md` §1（三目录） |
| 程序化移植·第一刀（补10） | ★ **德克萨斯改由我们的 `Builder` 构建**，不再走原作 `XT('texas')`。做法：钩 `Q.prototype.box/shape/build` 跑一遍 `XT` 抓下 **101 个作者级图元**（`Q.box` 与 `Builder.box` 签名一字不差）→ 子树签名认骨骼 → 生成 `src/lowpoly/orig/texas.js`；`src/lowpoly/orig/port.js` 的 `buildFromPort()` 重放 + `attachFace` 出脸。踩平 4 个坑：**骨骼命名**（变换签名 + 子树签名）、**图元原点被 RT/PT 重挂**（后发改用精确几何 `hairGeo`）、**可见性**（`hide:['prop']`）、**根缩放**（`rootScale`）。实测 **4832=4832 三角面、13 组 bbox 逐组一致、接地 0、0 报错**。新增 `src/lowpoly/orig/{texas.js,port.js,index.js}`（`PORTS`）；实验室 `const ported = LP.PORTS[P.id]` 已接通。文档 `lowpoly-runtime.md` §8 记录方法与验收 |
| 移植收口（补11） | ★ **调色板搬进移植数据**：`texas.js` 加 `palette:{AT,KT}`，`port.js` 用 `attachFace(head,{iris:palette.AT})` —— 移植版**不再依赖 `characters.orig.js` / `characters.face.js` 的 id 表**。★ 文档补 `lowpoly-runtime.md` **§8.5 移植一个角色的清单**（抓 → 变换规则/父级命名 → 生成 → 验收 → 进 PORTS）+ **§8.6 进度表**。★ **拉普兰德暂停**：捕获与槽位解析均正确（24 节点 / 88 图元 / roles 全对），但忠实树重建仍差 840 面、部分槽位取不到网格，连改三轮未收敛 → 数据留在 `TemporaryCache/port-lappland-nodes.json`，未上线（`PORTS={texas}`，浏览器 0 报错、自检 EXIT=0） |
| 低模全扫（补12） | ★ **14 个低模按移植模式全扫一遍**（钩 `Q` 抓图元 → 变换/父级命名 → `buildFromPort` → 逐骨骼 bbox + 三角面比）。结果：**texas / aak 两个零偏差已上线**（`PORTS = { texas, aak }`）；`chen / croissant / emperor / sora / swire` **三角面全等**、只差 `body/head/hair` 挂点；`exusiai / mostima` 差 192/312 面；`hoshiguma / hung / lee / waaifu / lappland` 差得多（嵌套 wrapper + 图元被 RT/PT 重挂）。新增通用代码生成器 + `src/lowpoly/orig/aak.js`(7KB)；`docs/lowpoly-runtime.md` §8.6 记全表 |
| 低模批量（补13） | ★ **再上两个**：`sora`（`exact={hair,coatTails}`，4868=4868，17KB）、`swire`（`exact={hair}`，4672=4672，29KB）→ **`PORTS = { texas, aak, sora, swire }`**（14 人里 4 个已程序化）。批量捕获里发现 **`exact` 只能给叶子组**（非叶子会把整棵子树重复收进 → 面数暴涨），并确认「**发/尾/道具这类挂件叶子用 `exact`、主体用图元重放**」是性价比最高的组合。`chen`（只差 body）、`croissant`（armR + armL 非叶子）、`emperor`（命名）留待下一批；通用生成器 + `port-<id>.json` 已就绪 |
| 移植突破（补14） | ★ **根因找到**：捕获时**误调了两次 `XT(id)`**（先拿 `m`、再挂钩子抓）→ 两份**不同的对象图**，身份永远对不上；`RT` 其实是恒等函数。改成「挂钩子 → **只调一次**」后，**14 人的骨骼名全部用身份对上**。★ 于是又上 3 个：**chen / croissant / hoshiguma**（`exact` 用**反向归属**：每个网格沿父链找最近的有名字 build 组；并排除脸网格，否则与 `attachFace` 重复）→ **`PORTS` 达 7 人**：texas · aak · sora · swire · chen · croissant · hoshiguma，逐骨骼 bbox 全对 + 三角面全等（实测）。剩 7 人（lappland/exusiai/mostima/emperor/lee/hung/waaifu）骨骼名已全对，只差**直接 `Q.add()` 的图元**没抓到 → 下一步钩 `Q.prototype.add` |
| 钩 add · emperor 上线（补15） | ★ **钩 `Q.prototype.add`**（`box`/`shape` 内部用它时用标志跳过）→ 抓下「直接 add 的几何」（hung/lee/waaifu 的 box 走 `UT` 子类、绕过了 `Q.prototype.box`，正是从 `add` 抓到的）。★ 两个修复：① `geoRaw` 必须 `g.toNonIndexed()`（否则丢 index，三角面少一半）；② **emperor 的头不是 `attachFace` 那套** → `noFace:true`（否则多 972 面）。★ **emperor 上线**（2556=2556，body 残差 0.03）→ **`PORTS` 达 8 人**：texas · aak · sora · swire · chen · croissant · hoshiguma · emperor。剩 6 人（lappland/exusiai/mostima/lee/hung/waaifu）几何仍偏少，还需再找漏掉的钩子 |
| 分段 flush（补16） | ★ **关键 bug**：`Builder` **不能混** `box/shape` 与「直接 `add` 的裸几何」—— 实测 `b.box(...) + b.add(rawGeo)` 会让 `build()` 返回 **null（两者都丢）**。`port.js` 的 `replay` 改成**按种类分段 flush**（box/shape 归一个 Builder，裸几何各自 build 一次）→ **lappland 4980 · lee 3570 · hung 2228 · waaifu 2656 三角面立刻全等**。★ **lee 上线**（→ `PORTS` 达 **9** 人：texas · aak · sora · swire · chen · croissant · hoshiguma · emperor · lee）。剩 5：lappland/hung/waaifu 三角面已全等、只差 `hair`；exusiai/mostima 各少 192 |
| ★ 移植完成 14/14（补17） | ★ **14 个低模全部程序化移植完成**（`PORTS` 14/14，实验室 `ported=true`，三角面逐人全等、逐骨骼 bbox 基本全对）。本轮修掉最后两处：① `exact` 的**反向归属**（每个网格沿父链找最近的有名骨骼，跳过脸）→ lappland/hung/waaifu 上线；② **`Object3D.add` 直接挂的网格**（exusiai/mostima 的**光环 Torus 192 面**）也钩上 + `port.js` 新增 `meshRaw`（位置 + 顶点色 + 相对骨骼矩阵）→ exusiai/mostima 上线。13 个 `*_DATA` 文件（6KB~692KB）。文档 `lowpoly-runtime.md` §8.6 汇总了**移植路上踩平的 7 个坑** |
| 原版武器找回（补18） | ★ **修「移植后原版角色武器缺失」**：原作武器是**有名字的独立网格**（`croissant-hammer` / `croissant-shield` / `hoshi-shield` / `classic-chen-side-scabbard` / `swire-right-chain-weapon` / `emperor-suitcase`…），`extractNativeWeapons()` **按名字**分池；移植后网格丢了名字 → **可颂 / 星熊 / 陈 / 诗怀雅 4 人角色武器池空**。修法：① 捕获时（仍**只调一次 `XT`**）把每个 build 组的**返回网格名**记进 `parts[].nm` / `exact[].name`（⚠ 名字是**调用方在 `build()` 返回后**才设的，要在 `XT` 结束后读 `mesh.name`）；② `port.js` 的 `replay()` 用 `part.nm` 回填、`exactMesh()` 补 `m.name = it.name`、`buildFromPort()` 返回 **`spec:{id}`**（否则按角色兜底的 `WEAPON_TYPE_BY_CHAR` 失效）；③ `weapons.js` 的 `add()` 认不出类型时**往下找有名字的网格**，并给 `exusiai/emperor` 加兜底类型。**补名只在已发布的几何上打补丁（读 `orig/<id>.js`），不重跑几何**（多 id 同 evaluate 连调 `XT` 会撞「两次 XT 不同图」的坑，实测重跑会让能天使 +200 / 拉普兰德 −12 面）。验证：14 人三角面仍逐人全等、0 报错、自检 EXIT=0；`nativeList` 恢复 德州 `刀×2` · 拉普兰德 `双剑×2` · 能天使 `冲锋枪` · **可颂 `巨锤+盾`** · **星熊 `盾`** · **陈 `剑鞘`** · **诗怀雅 `链锤`** · 大帝 `手枪+提箱` · 莫斯提马 `法杖×2`；实验室 UI 与「原生装备 / 收起」开关正常。文档 `lowpoly-runtime.md` §8.6 补坑 8/9 |
| 部件编辑器走程序化（补19） | ★ **部件编辑器（`character-editor.html`）的基础模型 / 拆分源改用程序化移植**（不再吃烘焙的 `XT`）：新增 `getBase(id)` —— `LP.PORTS` 命中就 `buildFromPort`（按 `rootScale` 摆好），否则回退 `XT`；`build()` 与 `sourceParts()` 都走它，导出的 `op` 运行时代码也改成 `LP.PORTS[SRCID]?buildFromPort:XT`（并在头部注释声明 `LP` 依赖）。★ **让「转成可编辑部件」对移植角色也精确**：`src/lowpoly/model.js` 的 `Builder.build()` 现在写 `geometry.userData.primitiveVertexCounts`（与原作 `Q.build` 对齐）；`port.js` 的 `exactMesh()` / `meshRaw` / `hairGeo` 也补上（⚠ 写在 **`geometry.userData`** 上，不是 mesh —— `sourceParts` 读的是 geometry）；`exact` 网格每件补一份**原作的 per-图元顶点数表**（14 人里 8 个带 exact 的重新生成）。验证：**14/14 全部 `boxify` 成功**（19~26 部件 / 112~233 图元，0 报错）；实验室 14 人三角面仍逐人全等；自检 EXIT=0。文档 `development.md` §5.2、`editor-api.md` 拆分原理 更新 |
| 编辑器标记 + 新增模型编辑（补20） | ★ **`id` 旁加「程序化 / 烘焙」小标记**：新增 `sourceKind(id)`（`ported` 程序化移植 / `runtime` 运行时角色 / `baked` 原作烘焙）+ `SOURCE_KIND` 配色 + `updateSourceBadge()`（在 `renderAll()` 里刷新）；蓝色「程序化」/ 绿色「程序化·新增」/ 橙色「烘焙」，`title` 说明来源。★ **部件编辑器支持新增模型编辑**：`getBase()` 增加 `LP.CHARACTERS[id] → buildCharacter(id).proto` 分支（运行时本体，全质量）；模型面板加「**新增模型**」下拉（从 `Store.listModels()` 读正式 + 临时区）—— 运行时角色（初音 / 黑岩）**当基础模型**编辑、可 `boxify`，规格型模型走 `loadStoredModel` 载入规格；`EditorAPI.loadBase/boxify` 的校验改用 `isKnownBase()`（原作 14 人 **或** 运行时角色），`baseName()` 统一中文名。验证：`loadBase('miku')` → 16 网格 / 4232 面（运行时本体）、`boxify('miku')` → 23 部件 / 138 图元、`loadBase('brs')` → 19 网格 / 4684 面，徽章分别显示「程序化·新增」，下拉列出 `黑岩射手 / 初音未来 · 程序化 · 已确认`；0 报错、自检 EXIT=0 |
| 修「拆分后眼睛消失」（补21） | ★ **根因**：运行时角色（初音 / 黑岩）的脸是**贴图脸**（`buildFace` → 带 `map` 的 6 材质头网格），而 `boxify` 的 `op` 只保留 position/normal/color → **贴图丢、眼睛没**；同时「转成可编辑」默认走 `useOrigFace:true` → `attachFace(id)` 只认**原作 14 人的手绘脸表**，对 `brs/miku` 画不出脸。**修法**：① `src/lowpoly/model.js` 的 `buildFace()` 给头网格命名 `base-head` → 部件编辑器按名字把它归为「基础头型」**从拆分中排除**（避免留一个没贴图的皮肤盒盖住脸）；② `boxifySpec()` 按来源分脸：原作 14 人 `useOrigFace:true`（`attachFace`）、新增模型 `runtimeFace:true`；③ `build()` 对 `runtimeFace` 调 `LP.buildFace(G.head, LP.CHARACTERS[spec.id])` **重建运行时贴图脸**。验证：`boxify('brs'/'miku')` 后场景里恰好 **1 个 `base-head`（6 材质、带贴图）**、无 `基础头型` 部件、三角面与基础一致（4684 / 4232）；原作 14 人仍走 `attachFace`（`rounded-cheeks-and-chin`）不受影响；0 报错、自检 EXIT=0 |
| 人物生成策略 · 程序优化归档（补22） | ★ **人物生成正式定为「程序化优先」四条**（落进对应文档）：① **优先程序化**（代码 + 图元 + 特征清单）；② **体态抄原版模型**（`ai-pipeline.md` §11.1 骨架常量 / `boxify('<原版 id>')` / `ModelReadout.dump()` 去量），**不取参考图的体态**；③ **特征让 AI 自己上网收集**（公开资料 → 特征清单），**不要求用户给图**；④ **有参考图只参考图上的特征**，别做逐像素对剪影。落地位置：`ai-pipeline.md` **§〇 规矩5** / **§八 系统提示词9** / **§11.0 新增「特征从哪来 · 体态从哪来」表** / §11.4 结论；`ai-workflow.md` §9；`lowpoly-runtime.md` §0；`ai-pipeline-overview.md` + `.mmd`（输入分支）；`skills/ThreejS_Standard_modeling/SKILL.md` 现场笔记。★ **同时把本轮所有程序优化归档进对应文档**：程序化移植 `lowpoly-runtime.md` §8（坑 8/9）；武器名 `weapon-files.md`；部件编辑器「程序化基础 / 新增模型编辑 / 贴图脸」`editor-api.md` + `development.md` §5.2；流水线总图 `ai-pipeline-overview.md`；`ai-pipeline.md` **§十 文件表补 `src/lowpoly/orig/*`** |
| 系统提示词一键取（补23） | ★ **把 `ai-pipeline.md` §八 的系统提示词抽成运行时接口**：`EditorAPI.systemPrompt()` 直接返回最新版（`{ ok, version, docs, prompt }`，~1.3KB）；编辑器「生成流水线」面板加**「复制系统提示词」按钮**（剪贴板不可用则打印到控制台）。常量 `SYSTEM_PROMPT` 在 `pages/character-editor.html`，与文档同源；`ai-pipeline.md` §八 加「**最新版从 `systemPrompt()` 取 / 改了要同步常量**」，`editor-api.md` 自省表补 `systemPrompt()`。验证：`systemPrompt().prompt` 含新策略四条、`help()` 列出、按钮存在、0 报错、自检 EXIT=0 |
| 武器编辑器三改（补24） | ★ ① **「原版武器库」显示名改「共享武器库」**（`weapon-editor.html` 区块 + 提示/注释、`weapon-files.md` §1/§3、`docs/README.md`、`OriginalWeaponList/README.md`、`characters.store.js` / `_serve.js` 注释）—— ★ **目录名 `OriginalWeaponList` 与 `/api/original-weapons` 路径不变**（历史名，避免挪目录事故）。② **修「武器无法显示」**：服务端列表接口 `modelMeta` 只给了布尔 `runtime: !!j.runtime` → 补 **`runtimeId`**（真 id）；`showOriginal()` 改用 `w.runtimeId || w.id`（之前 `previewRuntime(true,…)` → `LP.WEAPONS[true]` 取不到 → **0 网格**）；预览加**自动取景 `frameTo()`**（加载即把相机框到武器上）。③ **新增「武器建模流水线」**：`WeaponAPI.pipeline()/mark()/reset()/systemPrompt()` + `features()/templateFor()/applyKindTemplate()`；武器编辑器加「**武器建模流水线**」面板（6 步：特征→名称/挂载/种类→**套同类型动作模板**→图元建本体→预览→存库）+「复制系统提示词「按钮；`lowpoly/weapons.js` 新增 **`KIND_MOVES` / `weaponKindMoves()`**（种类→动作模板）；`weapon-files.md` §4/§6 更新。**武器无体态要求**，特征自己上网收集 / 图只取特征。验证：点共享武器 1 网格且入镜、`templateFor('blade')`/`('hammer')` 正确、流水线 6 步、`systemPrompt()` 含「没有体态要求/复用同类型」、0 报错 |
| 武器编辑器 · 视口编辑 + 拆解（补25） | ★ ① **不再贴地面**：去掉地面/网格，武器**悬空**显示 + 自动取景。② **像部件编辑器那样编辑**：加 `TransformControls` gizmo —— 视口**点选图元 → 拖动/旋转/缩放**（<kbd>W</kbd>/<kbd>E</kbd>/<kbd>R</kbd>）、<kbd>Delete</kbd> 删除、<kbd>Esc</kbd> 取消；「武器本体 · 图元 / 代码」面板加**图元列表** + 新增/复制/删除/上移下移 + **模型代码**（图元 JSON，实时同步）。③ **共享武器可拆解**：新增 `captureWeaponPrimitives()` —— 钩 `Builder.box/shape/add`，把运行时几何还原成 `box/panel/geo`；⚠ **只钩 `BufferGeometry.applyMatrix4`**（three 的 `translate/rotateX/Y/Z/scale` 内部都走它，同时钩会把同一变换**记两遍** → 位移/旋转翻倍，黑岩巨炮 bbox 一度翻倍）。点共享武器即拆成可编辑图元：**黑刃 14 / 黑岩巨炮 33 / 葱 4，包围盒与原武器完全一致（maxErr 0）**。④ 顺带修 `addCyl`：去掉多余的 `toNonIndexed()`（保留 index 才能认出 `CylinderGeometry`；`Builder.add` 本来就会转，几何不变 —— 初音/黑岩仍 4232/4684 面）。⑤ `WeaponAPI` 加 `select / removePrimitive / duplicatePrimitive / mode / frame / captureOriginal`。文档 `weapon-files.md` §4/§6 更新。验证：拆解 bbox 完全一致、拖动同步（改 mesh.x → `primitive.x`）、0 报错、自检 EXIT=0 |
| 整体体检 + 修 3 个 bug（补26） | ★ **全项目 QA**：8 个页面 0 报错；6 个接口全 OK；角色实验室 14 人三角面全等 + 原生武器池正确（刀×2 / 双剑×2 / 巨锤+盾 / 剑鞘 / 盾 / 链锤 / 冲锋枪 / 手枪+提箱 / 法杖×2）+ 初音/黑岩 4232/4684 + **高模**（拉普兰德 1,795 面 / 45 网格）可切；部件编辑器 **16/16**（14 原作 + miku/brs）`boxify` 成功、基础与新增模型载入、存取往返干净；武器编辑器 3 把共享武器拆解（14/33/4，bbox 完全一致）、UI 增删复制、存取往返干净；边界用例（错 id / 错父级 / 越界 / 空图元）不崩。★ **修 3 处**：① **部件编辑器「基础模式」导出**对新增模型（miku/brs）会生成 `XT('miku')`（`XT` 里没有这个 id，导出代码跑不起来）→ 改为 `LP.buildCharacter(id).proto`；程序化移植 → `LP.buildFromPort(LP.PORTS[id])`。② **角色实验室状态栏**把程序化移植的低模误标成「低模 **XT**」→ 改「低模（程序化）」（看 `parts.ported`）。③ **`addPart` / `updatePart` / `addPartJSON`** 传错父级会抛 JS `TypeError` → 改返回干净错误「未知父级: x（可用: body, head, armL, armR, legL, legR, coatTails, tail）」。验证：导出代码可编译、miku 导出走 `LP`、实验室标签正确、错父级报干净错误；自检 **EXIT=0**、无残留文件 |
| 武器编辑器默认显示葱（补27） | ★ **启动时默认加载共享武器库里的「葱」**（拆解成 4 个可编辑图元：1 个圆柱 + 3 个片），而不是空白方块 —— `loadDefaultWeapon()` 在启动时取 `listOriginalWeapons()` 里的 `leek` 并 `showOriginal(leek,{asCopy:false})`；`showOriginal(w,{asCopy})` 新增参数，**启动那次不加「-副本」后缀**（点共享武器仍然加）。服务没起来时静默退回默认方块。验证：打开武器编辑器 → 名称「葱」· 种类锤类 · 动作上劈 · **4 个图元**，0 报错、自检 EXIT=0 |
| README 重写 + 文档对齐（补28） | ★ **根 `README.md` 重写**（对齐当前功能）：修掉过时/错误内容 —— 武器编辑器描述（旧文案还是已删除的**换装室**）、换新截图 `preview-weapon.png`（删旧 `preview-mixer.png`）、「原作低模没有网格文件」已过期（14 人**已程序化重建**）、免责声明补 **`src/lowpoly/orig/*`**、致谢「al」→**AI**；新增「**程序化角色 / 武器（`src/lowpoly/`）**」一节 + `systemPrompt()` + **程序化优先四条策略**；目录树补 `lowpoly/`·`orig/`·`OriginalWeaponList/`·`NewlyAddedWeaponList/`；文档表补 `lowpoly-runtime`/`weapon-files`/`ai-pipeline-overview`；已知限制更新（**忠实树未启用** / 武器拆解略过未知几何）+ push 代理排查提示。★ **`docs/README.md` 对齐**：命令数统一 **108**（旧文写 109/116，实际数出来是 108）、武器编辑器描述更新、`lowpoly/` 文件地图补 `orig/`、「按症状查」补两行、新增第 **6** 条铁律「人物生成程序化优先」。验证：README 引用文件全部存在、两份 README 功能/数字一致、自检 EXIT=0 |
| 部署加固（补29） | ★ 为「部署到 Linux 服务器 / 宝塔面板」做的一整套：① **three.js 本地化** —— three 本体 + 8 个 addon（+2 个传递依赖 `ConvexHull` / `TextureUtils`）下到 **`vendor/three/`**，4 个页面的 importmap 全改指本地 → **零外网 / CDN 依赖**（实测 4 页都从 `/vendor/` 加载、0 报错）。② **`_serve.js` 加 `HOST`**（默认 `127.0.0.1`，只给反代）+ **可选 Basic Auth**（`AUTH_USER`/`AUTH_PASS`，全站保护、`OPTIONS` 预检放行）。③ 新增 **`start.sh`**（Linux 一键起，含 Node 版本检查）、**`ecosystem.config.js`**（PM2）、**`Dockerfile` + `docker-compose.yml` + `.dockerignore`**（产物挂卷，容器重建不丢）。④ 新增 **[`docs/deploy.md`](docs/deploy.md)**：宝塔 / PM2 / systemd / Docker 四种方式 + 环境变量表 + 反向代理（★ `client_max_body_size 64m`，否则存模型 413）+ 安全清单 + 升级备份 + 排错。`docs/README.md` / 根 `README.md` 挂上链接。验证：默认（无鉴权）本机 200、**局域网 IP 被拒**（只绑 `127.0.0.1`）；带鉴权实例 无凭据 401 / 错密码 401 / 对凭据 200 / 静态页也 401 / `OPTIONS` 204；`/vendor/three/three.module.js` 200；自检 **EXIT=0** |
| 只读/读写 token + `.env.example` + README 部署扩写（补30） | ★ ① **`/api/*` 加两把钥匙**（以前全站一把）：`API_READ_TOKEN`（只放 `GET`/`HEAD`）+ `API_WRITE_TOKEN`（全放）；三种传法 `Authorization: Bearer <t>` / `X-API-Token: <t>` / GET 时 `?token=<t>`；比较用**恒定时间** `crypto.timingSafeEqual`；401 时**读干请求体**（不污染 keep-alive，避免随机 502）；与整站 Basic Auth **叠加**（人 / 浏览器走 Basic，AI / 脚本走 token；只发只读 token 最安全）。② 新增 **`.env.example`**（全部环境变量模板 + 三种加载方式 + Agent curl 示例）；`.gitignore` 加 `.env*`（模板除外）。③ 根 `README.md` 加**徽章**（dependencies 0 / build none / CDN none / node 16+ / docker / non-commercial）+ 新增 **「部署」小节**（一条命令 + 环境变量表 + 反代 `client_max_body_size` + 只读 token 建议）。④ `docs/deploy.md` 补 token 说明（§1b 两种钥匙）/ 校验 / 安全清单 / 排错。验证（带 token 实例）：GET 无凭据 **401** · read token **200** · write token **200** · `?token=` **200** · **POST read token 401** · POST write token **200** · POST 无凭据 **401** · Basic **200** · 静态页无凭据 **401**；主实例（无鉴权）仍 200；自检 **EXIT=0** |
| 去掉鉴权 · 回归开源（补31） | ★ **按用户要求撤掉补29/补30 的鉴权**：`_serve.js` 删掉 Basic Auth（`AUTH_USER`/`AUTH_PASS`）与 API token（`API_READ_TOKEN`/`API_WRITE_TOKEN`）两套闸门 + 相关 helper，**服务端恢复无鉴权**（开源学习项目，`/api/*` 可读可写）。`HOST` **保留**为可选网络开关，**默认改回 `0.0.0.0`**（= 原行为，直连/局域网可用；`HOST=127.0.0.1` 则只给本机/反代）。同步清理：`.env.example`（只剩 `PORT`/`HOST`）、`ecosystem.config.js`、`docker-compose.yml`、`start.sh`、`README.md` 部署小节、`docs/deploy.md`（删 §1b「两种钥匙」、改环境变量表/校验/安全清单/排错）；`.gitignore` 仍忽略真 `.env`。验证：无鉴权实例本机 200、局域网 IP 也可访问（绑 `0.0.0.0`）、`/vendor/three/` 200、自检 **EXIT=0** |
| 仓库瘦身 + 历史重写（补32） | ★ **删掉不影响功能的 55MB**：`skills/ThreejS_Standard_modeling/source/`（16MB 构建产物快照）+ `reference/{iE,aE,yD,PE,dO}.json`（各 ~7MB；`yD/PE/dO` 是 `iE` 的重复副本）—— 这些在 `pages/` `src/` `tools/` 里 **0 引用**，工坊功能不受影响（`skills/` **55MB → 2MB**）；补 `reference/README.md` 说明；**`refs/` 未动**。★ **重写历史**：`git filter-branch` 把这 6 条路径从**全部 11 个提交**里抹掉 → 删 `refs/original` 与过期的 remote-tracking ref → `reflog expire` + `gc --prune=now`；校验 `git log --all -- <paths>` 命中 **0**、pack 里最大对象从 16MB/7MB 降到 **≤2.7MB**、`fsck` 无不可达对象；**强推**（`baad9ea → 24cb438`）。远端复核：被删文件 **404**、保留文件（`standard-landmarks.json` / `SKILL.md` / `refs/inbox/` / `vendor/three/` / `pages/`）**200**。★ 体积：工作区 **103MB → 49.7MB**、克隆要下的唯一对象 ~**24.6MB**（其中 ~23MB 是 `refs/` 的图，按用户要求保留）；`TemporaryCache` 等未提交内容不计。⚠ **所有提交哈希已变**，旧克隆需重新 clone；改前备份在 `lpw-backup-<时间戳>.bundle`（25.8MB）。 |
| 文档总检（补33） | ★ 全库文档核对，修掉过时/不一致：① **`pages/docs.html` 侧栏漏了 3 篇**（`ai-pipeline-overview` / `weapon-files` / `deploy`）→ 补齐，现 **13 篇**；`docs.html` 角标「7 篇」、`src/shell.js`「10 篇」→ **13**。② **`/api/index` 的文档描述一直是空的**（解析器只认 `- [x](y) — desc` 项目符号，而 `docs/README.md` 是**表格**）→ 正则改为**表格行也认**，13 篇现在都有 desc。③ 命令数统一：`development.md` 架构图「116 命令」→ **108**（`CHANGELOG` 旧记录里的 116 也改 108）。④ `docs/README.md` 仍写 `AUTH_*`（鉴权已删）→ 改 `PORT`/`HOST`；症状行「要不要鉴权」→「反代 413 / 机房只放行 Web 端口」。⑤ **`docs/deploy.md` 补 §5「共享 IP 机房 / 端口映射」**（真实踩坑：公网端口 ≠ 内网端口、机房只放行远程管理/FTP/Web 端口 → 内网换 80 或宝塔站点反代；给出排查顺序 + 3 种情况表）；systemd 示例改 `User=root` + **node 完整路径**（对齐 `deploy-linux.sh`）。⑥ 根 `README.md`：部署小节补 **`tools/deploy-linux.sh`** + 共享 IP 提示；目录树补 `start.sh` / `ecosystem.config.js` / `Dockerfile` / `.env.example` / `vendor/three`；`docs/ 12 篇` → **13**；`skills/` 注明大号数据已移除。⑦ 清掉遗留**绝对路径**（`D:\ROTK\three.js` 出现在 `editor-api.md` / `gpu.md` / `制作流程笔记.md` / `refs/inbox/README.md` → 改 `<仓库根目录>`）；`development.md` 里 `_serve.js` 的「450 行 / 26 KB」→ **788 行 / 50 KB**、`character-editor.html` 273 KB → **287 KB**、武器编辑器描述从旧的「跨角色槽位互换」改成现在的功能。验证：`/api/index` 13 篇**全带 desc**、docs 页侧栏 **13 条**、0 报错、自检 **EXIT=0** |

**为什么能整合**：这套工坊和我们的项目逆向的是**同一款游戏** —— 它的 `Q.box(x,y,z,w,h,d,color,rotZ)`
和我们的 `Builder.box(...)` 签名一致，骨架常量（`bodyY -0.1095 / headY 1.47 / headScale [1.672,1.54,1.518]`）
完全一致。所以我们的角色**本来就是用工坊的原生语言写的**。

**导出怎么做**：临时给 `Builder` 打补丁，记录每次 `box/shape`；`build()` 时按「网格挂在哪个骨骼组」
分部件，再把坐标换算到工坊的父级组空间（`keyWorld⁻¹ · groupWorld`）。`shape()` 带 `rotX/rotY`
的（靴翼 / 蓝火）落成 `kind:'geo'`，其余落成 `panel`。

**验证**：
- `exportSpec('miku')` → 15 部件 / 77 图元 / 骨架 9 组；实验室里能载入（79 网格 / 1,176 面）。
- **质量门**：`chiralityGate` **pass**、`seamGate` **pass**（喂 `partBoxes()` 算的世界包围盒）。
- 运行时：角色切换、走路/跑/下蹲/腾空、12 活动、持械/黑刃/黑岩巨炮/换招/攻击 全部可用。（当时放在独立「人物工作室」页；现已并入角色实验室，见「融合（补5）」。）

**已知差距**：实验室里的 `lp-*` 是**spec 解释器**建的（直角盒、无手绘脸、1,176 面）；
真正带圆角盒 + 96×80 手绘脸 + 武器的版本是**程序化运行时本体**（`src/characters.lowpoly.js`，4,232 / 5,436 面）。
工坊的 `useOrigFace` 与我们的 `paintFace` 是两套脸管线，暂不合并。

详见 [`docs/lowpoly-runtime.md`](docs/lowpoly-runtime.md)。

---

## 2026-09-30 · 目录归类 + AI 读数通道 + 参照图服务 + 建模规程

这一轮的主线：**让 AI 能「读到」模型和参照图，而不是靠猜像素**，并把这个能力固化成文档和自检规则。

### 1. 新增：`ModelReadout` —— AI 读数通道

| 文件 | 说明 |
|---|---|
| `src/model-readout.js` | 新增。页面里挂 `window.ModelReadout` |

```js
ModelReadout.dump()                       // 每个部件 / 图元的世界 AABB（含旋转，解析算出）
await ModelReadout.ascii({plane})         // 文本剪影：@ 重合 / # 只有模型 / o 只有参考图
await ModelReadout.refs()                 // 列服务端参照图
await ModelReadout.refProfile({name,...}) // ★ 走服务端的区域轮廓（文本 + 每行左右界）
await ModelReadout.save(name)             // 落 TemporaryCache/，纯 HTTP 也能取
```

解决了什么：以前只能靠 `render()` 看图判断，**全身远景里一个小部件只有十几像素**，
形状/朝向/接缝全看不出来 → 反复返工。

### 2. 新增：参照图服务（服务端一等资产）

| 文件 | 说明 |
|---|---|
| `tools/_serve.js` | 新增 `/api/ref*` + **纯 Node PNG 解码器**（只用内置 `zlib`，仍然零依赖） |

```
POST   /api/ref           {name, dataURL|base64|path}  上传 + 立即分析
GET    /api/ref           列表
GET    /api/ref/:name     分析（尺寸 / 背景 / 前景占比 / 包围盒 / 视野切分 / 主色板）
GET    /api/ref/:name/profile?x&y&w&h&cols&rows&dark   区域轮廓
GET    /api/ref/:name/mask?cols&rows&mode              归一化二值网格
DELETE /api/ref/:name | /api/ref
```

- 落在 `TemporaryCache/refs/` → **清缓存即清**；Agent 交还带 `{cleanRefs:true}` 也清
- 视野切分踩了三个坑才做对：背景抠图会被地面阴影连成一片 → 改用暗部；
  「列里有任意暗像素就算占用」太严 → 改成**列占比 >1%**；缝只有 1.7% → gapMin 从 2% 降到 1%。
  现在三视图拼版能稳定切出 3 个视图

### 3. 新增：建模顺序规程（正式）

```
① 腿部 → ② 躯干 → ③ 手（臂）部 → ④ 头部 → ⑤ 头发 → ⑥ 衣服
每步内部两层：先「基础」，后「复杂」。基础没验过不许动复杂层。
```

- 写在 [`docs/ai-pipeline.md`](docs/ai-pipeline.md) **§〇·B** 和
  [`低模工坊-制作流程笔记.md`](低模工坊-制作流程笔记.md) **§1**
- 每步固定四件套：**实现 → `dump()` 量坐标 → 特写 `render()` → `gates()` 查有没有弄坏前面的**

### 4. 重构：目录归类

根目录原来 8 个 html + 10 个 js + 2 个 css 全堆一起，现在：

```
pages/    8 个页面（入口 + 4 工具 + 3 信息页）
src/      10 个共享 JS
styles/   2 个 CSS
tools/    _serve.js / selfcheck.js
```

配套改动：

- 所有引用同步；**旧路径 302 跳转**（`_serve.js` 里的 `LEGACY` 表）→ 老书签不断
- `_serve.js` / `selfcheck.js` **从 `__dirname` 推根目录** → 任意目录下 `node tools/_serve.js` 都对
- `selfcheck.js` 改成扫 `pages/ src/ styles/`，相对引用按**所在文件目录**解析
- 命令变为 **`node tools/_serve.js`** / **`node tools/selfcheck.js`**（`.bat` 已同步）
- 文档里 165 处路径引用批量同步

### 5. 修复：迁移过程中的三类路径事故

| 事故 | 现象 | 根因 |
|---|---|---|
| 图片全挂 | 7 张预览图 404 | 批量替换只处理 `./x.js`/`./x.css`，漏了裸相对 `images/…` |
| `data/*.json` 指错 | `href="data/…"` 变成 `/pages/data/…` | 同上 |
| **页间导航 404** | `/pages/pages/docs.html` | 把本该保持**裸文件名**的页间导航也加了 `pages/` 前缀 |

**三类引用，三种正确写法**（已经写进规程）：

| 引用类型 | 正确写法 |
|---|---|
| 页间导航（`index.html` / `docs.html#xxx`） | **裸文件名** |
| 共享资源（`shell.css` / `characters.orig.js`） | `../styles/…` / `../src/…` |
| 数据素材（图片 / `data/*.json` / `docs/*.md`） | `/images/…` / `/data/…` / `/docs/…` |

**防复发**：`selfcheck.js` 新增两条规则 —— 资源引用必须是 `/` 或 `../` 开头；
页间导航不得带 `pages/` 前缀。这两条上线后**立刻又抓出 3 处漏网**。

### 6. 修复：接管状态三处说法不一致

**现象**：导航条和「AI 工作流」页显示 `DeepSeek V4.1 Flash（已退出）`，
首页 / 系统状态却显示 `还没有 Agent 接管` —— 同一个状态两种说法。

**根因**：两个接口返回的**对象形状不同**：

| 接口 | 用的函数 | 有 `stale`/`occupying` 吗 |
|---|---|---|
| `/api/agent`、`/api/index` | `agentView()`（算出来的） | ✅ |
| `/api/store` | `readAgent()`（原始记录） | ❌ |

首页读 `/api/store` → `a.stale === undefined` → 判定落到 `else` → 显示「没有接管」。

**修法**：`/api/store` 也改用 `agentView()`。
**教训**：同一个状态只能有一个「计算入口」，存储层的原始记录不能直接当展示层。

### 7. 质量闸门 / 自检

`node tools/selfcheck.js` 现在检查：

```
① 引用完整性（31 个引用）        ✔
① 资源引用必须是 / 或 ../ 开头    ✔
① 页间导航不得带 pages/ 前缀      ✔
① 没有孤儿文件                    ✔
② 8 个页面都引了 shell.css/js     ✔
③ editor-api.md 覆盖 108 个命令   ✔
③ 主题卫生（无写死颜色）          ✔
④ 服务端 8 个端点冒烟             ✔
```

### 8. 新增：`.gitignore` 隔离临时产物

`TemporaryCache/*`（保留 README.md）—— 参照图 / 门报告 / 截图 / 试跑产物
本来就被设计成「随时可清」，不该进版本库（实测 157 个文件 / 20.9 MB）。

### 9. 产出物

`NewlyAddedModelTemporaryList/` 下新增三个黑岩射手模型（原作 `boxify('lappland')` 改造）：

| id | 内容 |
|---|---|
| `brs-base` | 基础框架（无外套、无马尾；腿膝分两块、靴翼内外各一） |
| `brs-test` | 带服装细节版（比基尼 / 腰带 / 短裤 / 外套 / 星标） |
| `brs-v6-带外套马尾` | 备份：含外套下摆 + 连帽兜 + 双马尾 |

---

## 更早

见 git log（`git log --oneline`）。

---

## 2026-09-30 · 附录：参照图投递 & 目录冻结

### 参照图收件箱 `refs/inbox/`

**问题**：把图直接拖进对话框会报
`发送提示失败 · The requested file could not be read…after a reference to a file was acquired`。
原因是聊天/截图工具给的是**临时文件路径**，松手即失效 —— 不是权限问题。

**解法**：图片先**另存为到 `refs/inbox/`**，再由服务端接口收进来（不走聊天附件）。

新增：

| 东西 | 说明 |
|---|---|
| `refs/inbox/README.md` | 投递说明（含错误原因） |
| `GET /api/ref/inbox` | 列出收件箱里的图片（AI 不用猜文件名） |
| `POST /api/ref {path}` | **name 自动取文件名**（原来必须手给 name） |

### 目录结构冻结

`pages/` `src/` `styles/` `tools/` 的归类**到此为止，以后不再挪文件**。
挪一次要同步页面三类引用 + `LEGACY` 表 + selfcheck 扫描路径 + 文档上百处路径 +
用户端已打开的编辑器引用（会报「引用过期」）。为此已经出过三次事故。
规程写进 `低模工坊-制作流程笔记.md` 和 `docs/ai-workflow.md` §9-10。
---

## 2026-09-30 · 按建模规程重做角色（① 腿部 ~ ⑤ 头发）

这一轮**完全按 `docs/ai-pipeline.md` §〇·B 的规程**走：`腿部 → 躯干 → 手臂 → 头部 → 头发`，
每件都分「基础层 → 复杂层」，每一步都走**四件套**：

```
量参照图(ModelReadout.refProfile) → 建 → dump() 验数据 → 特写 render() 看 → gates() 查有没有弄坏前面的
```

参照图走**服务端收件箱**：`refs/inbox/` → `POST /api/ref`（不用聊天附件，避开「引用过期」）。
产物：`NewlyAddedModelTemporaryList/brs-base`（29 部件 / 5704 面，5/5 门通过）。

### 各步的结果（含参照图实测对照）

| 步 | 参照图实测 | 建成 | 验证 |
|---|---|---|---|
| **① 腿部** | 靴筒宽 204px=0.152、高 497px=0.371、两靴间距 0.102、靴翼外伸 0.026/高 0.048 | 腿心 **∓0.127**、大腿方块 0.151×0.564、靴筒 0.152×0.371、间距 0.102 | dump：大腿 y0.367~0.930、靴 y−0.007~0.367 |
| **② 躯干** | 下巴 0.62H、胸罩 0.426–0.532H、露腹、腰带 ~0.40H、短裤下沿 0.37H | 皮肤主干 **0.706~1.452 连续**（三段重叠 0.070/0.051）、胸罩 0.98~1.22、露腹 0.89~0.98、腰带 0.75~0.89、短裤 0.63~0.81 | dump：三段重叠 ≥0.02；衣服三轴包住主干 |
| **③ 手臂** | — | 大臂 0.18×0.28×0.19 / 小臂 0.165×0.28×0.175 / 手 0.17×0.22×0.17 | dump：肩点↔胸腔 x0.039 y0.26 z0.192；大臂↔小臂 y0.052；小臂↔手 y0.044 |
| **④ 头部** | — | 虹膜改**蓝色**（0x1e5fbf/0x4f9be8/0xd8ecff） | 特写 |
| **⑤ 头发** | 马尾最外伸 ∓0.88 world | 每侧 **7 块棱角长片**，发梢 **高出头顶 0.169**（2.473 vs 2.304），外伸 ∓0.984 | dump + 特写 |
| ⑥ 衣服 | — | **待做** | — |

### 这一轮踩的坑（都已写进 `低模工坊-制作流程笔记.md`）

| # | 坑 | 教训 |
|---|---|---|
| 1 | 躯干三段之间留 0.21 空洞 → **主体不见了** | **皮肤主干必须先连成一整根**（两两重叠 ≥0.02），衣服只负责"盖住哪/露出哪" |
| 2 | 胸罩 x±0.23 比胸腔 ±0.27 还窄 → **成了贴纸** | **衣服的包围盒要包住主干段**（宽 + 深都盖过） |
| 3 | 两个罩杯中间留 0.045 缝 → 看着是**两块黑方块** | **成对件中间必须交叠** |
| 4 | 重写时把 helper 的 `rotZ` 抄丢 → **交叉绑带变横条** | 重写部件前先对照原字段，别凭记忆重敲 helper |
| 5 | 手臂左右**不是镜像**（手/手套 x 偏移没乘符号）→ `chirality` 挂 | 镜像件里**任何 x 偏移都要 `*s`** |
| 6 | 缩小靴子后**脚与靴筒断开 0.03** → `turntable` 报「视图没被清晰分离」 | 那条告警 = **剪影不是一整块**；缩放后必须回查接缝重叠 |
| 7 | 马尾顶与头顶齐平 → 看着怪 | 参照图里马尾尖**冒在头顶之上**（实测高出 0.17） |

### 工具侧的补充

- **`turntable` 报「有视图没被清晰分离」的判据查清了**：`largestComponent` 的
  `discarded = (总前景 − 最大连通块)/总前景 > 0.02` → 告警。**它真的在说"模型某处断开了"**，
  不是门太严。数连通块的代码已进笔记。
- **`dump()` 对镜像件（`mirror:true`）会把原几何和镜像几何取并集** —— 所以 `tailL_m` 会报出
  跨越左右的 x 范围，看着像 4 束。**判断镜像件的实际范围要看 `render()`**。

### 接管

按租约制登记 → 干完**交还**（`{agent:null, note:"暂停：…"}`），当前 `occupying:false`。