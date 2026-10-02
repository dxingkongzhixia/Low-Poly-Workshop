# 程序化角色运行时（我们的模式）

> 一句话：这是**另一条建模 / 动画路线** —— 直接用**代码**写完整可动角色（标准骨架 + 图元 + 状态机 + 武器池），
> 和原作的 `XT(id)` + 原作动画**并行**、互不污染。
>
> 文件：`src/lowpoly/*`（入口 barrel `src/characters.lowpoly.js`）· 页面：**角色实验室**「新增模型」
> （初音未来 / 黑岩射手）+「运行时 · 移动 / 活动 / 武器池」面板 · 调试：`window.__lab.LP`
>
> ★ **建新角色时优先走这条路线**（程序化）。有参照图时**只提取特征，不采纳体态** —— 见 §0。

---

## 0.5 模块划分（一个角色 = 三大块）

工程上拆成**抽象类 + 若干层**，各管一摊、可以套用：

```
Character（抽象类，lowpoly/character.js）
├─ 人物模型  Model        lowpoly/model.js     骨架常量 + Builder 图元 + 脸 + buildMiku/buildBRS
├─ 武器池绑定 WeaponPool  lowpoly/rig.js       mountWeapons()：两池互斥 / 2 手位 / 绑定 / 动作序列
│    ├─ 武器本体  weapons.js   WEAPONS（几何）+ 挂载数（单手·双手）+ 种类（刀/锤/枪/炮/盾…）
│    └─ 武器动作  moves.js     ATTACKS（按类型/种类的标准招）+ COMBOS
└─ 动作绑定  Actions      lowpoly/actions.js   移动（状态机）+ 活动（12 项）

导出  lowpoly/export.js    exportSpec / factorySource / partBoxes
入口  lowpoly/index.js     → src/characters.lowpoly.js（barrel，老 import 不用改）
```

**抽象类**（`lowpoly/character.js`）把三块拼起来：

```js
class Character {
  build()            { /* 抽象：人物模型，子类实现 */ }
  defaultLoadout()   { return []; }        // 武器池绑定：自带武器（→ 角色武器池）
  actions()          { return ACTIVITIES; } // 动作绑定：移动 + 活动
  assemble(opts)     { /* 模型 + 武器池 一键装配 */ }
}
class Miku extends Character { build(){ return buildMiku(this); } }
class Brs  extends Character { build(){ return buildBRS(this); } defaultLoadout(){ return LOADOUT; } }
```

**武器分类**（`lowpoly/weapons.js`）：

| 维度 | 取值 | 取法 |
|---|---|---|
| **挂载数** | 单手 / 双手 | `def.hands`（默认 1）· `weaponHands(type)` |
| **种类** | 刀 `blade` / 锤 `hammer` / 枪 `gun` / 炮 `cannon` / 盾 `shield` / 杖 `staff` / 链 `chain` / 箱 `case` | `weaponCategory(x)` · `describeWeapon(x)` |
| **来源** | `orig`（原作）/ `ours`（我们的） | `def.origin` |

---

## 0. ★ 生成策略：程序化优先 · 体态抄原版模型 · 特征自己上网收集

- **优先程序化**：把角色当一段**特征清单**（头发形状/分束 / 配色 / 道具 / 剪影要点 / 一个标志动作），
  用 `Builder.box` / `Builder.shape` / `addCyl` 在**标准骨架**上建**完整可动角色** —— 结构清楚、能拆能动、换视角不塌。
- **体态抄原版模型**：头身比 / 髋高 / 肩宽 / 四肢 / 站姿 / 透视，一律量自或抄自**原版模型**
  （`ai-pipeline.md` §11.1 常量；要更细就 `boxify('<原版 id>')` / `ModelReadout.dump()` 去量）。**绝不采用参考图的体态**。
- **特征让 AI 自己去收集**：自己上网查该角色的公开资料，提炼特征清单；**不要求用户提供图**。
- **有参照图时只取图上的特征**（头发 / 配色 / 道具 / 剪影要点），不取体态。
- **别做「参照图 → 逐像素对剪影」**：那条路会过拟合单个视角、和标准体型打架、常回来一堆扁平片
  （这是踩过的坑）。参照图留给「**必须复刻某个已有剪影**」的场合。

> 依据：两个用**纯代码 + 特征**做出来的角色（初音未来 / 黑岩射手）明显好于早期的参照图建模。
> 服务文档里对应 **[`ai-pipeline.md`](ai-pipeline.md) §十一**。

---

## 1. 为什么能并进工坊

这套工坊和这个运行时**逆向的是同一款游戏**《企鹅物流·未登记访客》。

| | 工坊（原作层） | 本运行时 |
|---|---|---|
| 建模 API | `Q.box(x,y,z,w,h,d,color,rotZ)` · `Q.build(parent)` | `Builder.box(...)` · `Builder.build(parent)` —— **签名一致** |
| 骨架常量 | `bodyY -0.1095 / headY 1.47 / headScale [1.672,1.54,1.518] / armX .36 / legX .16 / legY .73 / rootScale 1.008` | **完全一致** |
| 脸 | `attachFace()` + `jT` 96×80 贴图 | 自绘 96×80 贴图（含普通 / 严肃两版） |
| 动画 | 原作的姿态函数 | **状态机**：`motion / crouch / gait` |
| 武器 | — | **武器池**：`equip / unequip / clear / native` + 招式 + 连携 |

所以我们的角色**本来就是用它的原生语言写的**，并进工坊不需要翻译。

---

## 2. 两条角色路线（同一页里，不互相污染）

| | 原作层 | 自定义运行时 |
|---|---|---|
| 角色 | `XT('lappland')` … 14 人 | `CHARACTERS.miku / brs` |
| 在哪 | 角色实验室「**原始模型**」 | 角色实验室「**新增模型**」（内置）|
| 动画 | 原作姿态 | **状态机**（我们的模式） |
| 武器 | 模型自带（按名字分割） | **武器池**（角色绑定 + 共享） |

原作 14 人**完全没有改动**；我们的角色也**不进** `data/characters.json` 的原作索引。

---

## 3. 运行时 API

```js
import * as LP from '../src/characters.lowpoly.js';

LP.CHARACTERS                      // { miku, brs } —— 调色板 + build(t)
LP.buildCharacter('miku')          // → { proto, spec }（只有骨骼接口，没有全局状态）
LP.poseCharacter(proto, t, dt, state)   // 状态机：跑一帧
LP.mountWeapons(proto, loadout, { bind, startNative })   // 建武器池
LP.exportSpec('miku')              // → 工坊 spec（model.json 的形状）
LP.factorySource('miku')           // → 工坊 model.js 工厂源码（自包含）
LP.partBoxes(spec)                 // → Map<partId, Box3>（世界空间，喂 seamGate）
```

实验室把 `LP` 暴露在 `window.__lab.LP`，方便在控制台调试。

### 骨骼接口（和原作一致）

```js
proto.root / body / head / arms / legs / knees / hair / tails / cape / flame / face
proto.weaponRig                    // 武器池
proto.detach                       // 测高时要摘下来的、高过头顶的配件（马尾）
```

---

## 4. 导出（可选）

内置角色不需要导出就能在实验室里跑。要把它们**落成工坊的 spec / model.js**（给部件编辑器、武器编辑器用）时：

```js
const sp = LP.exportSpec('miku');
const js = LP.factorySource('miku');
await fetch('/api/models', { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ id:'lp-miku', name:'初音未来（低模运行时）', spec:sp, js, dir:'confirmed' }) });
```

- **spec** → 部件编辑器 / 武器编辑器可以继续编辑、跨角色混搭。
- **model.js** → 「新增模型」区可构建。
  ⚠ 它被塞进 `new Function('THREE','Q','XT','attachFace', src)` 求值，所以工厂**不能声明 `THREE` 参数**
  （要用闭包里的 `THREE`）—— 这是踩过的坑。

---

## 5. 质量门（可选）

```js
const sp = LP.exportSpec('miku');
chiralityGate(sp)                      // 需要部件名以 L/R（或 左/右）结尾 —— 导出时已命名「手臂 L/R」「腿 L/R」
seamGate(sp, LP.partBoxes(sp))         // 需要世界空间包围盒 —— partBoxes() 现算
```

实测：初音 / 黑岩 **chirality pass + seam pass**。
另外几个门（轮廓 IoU / 转盘 / 内外差 / 净空 / 头皮 / 穿插）需要对照图或三角面汤，按需接。

---

## 6. ★ 动画互通

**原作低模 `XT(id)` 的骨骼接口和我们完全一致** —— 实测 `XT('texas')`：

```
{ root, body, head, arms[±0.36,1.30], legs[±0.16,0.73], knees[-0.30],
  hair, coatTails, tail, halo, prop, eyes, staffs, weapons, snacks, cup, face }
```

位置、命名、左右顺序都和我们一样。所以 **`poseCharacter()` 一套就能驱动两头**，
差异点按「有则动、无则跳过」处理：

| 只属于原作的 | 只属于我们的 | 两套都有 |
|---|---|---|
| `coatTails`（风衣，负号后摆）、`tail`（兽尾，正弦摆）、`halo`（光环）、`emperor` 体量特例 | `tails`（双马尾）、`cape`（斗篷，正号后摆）、`flame`（蓝火） | `body / head / arms / legs / knees / hair` |

**武器池对原作也生效**：`mountWeapons(rig, LOADOUT)` 只认 `rig.body` / `rig.arms`，
所以把 ★黑岩巨炮装到**拉普兰德**手上、用我们的招式系统挥 —— 直接可用。

### 6.1 两个武器池（互斥）+ 单手 / 双手

- **角色武器池（native）**：`extractNativeWeapons(model)` 从模型里**按名字分割**出该角色**自带**的武器
  （`croissant-hammer` / `hoshi-shield` / `swire-right-chain-weapon` / `mostima-staff` /
  `exusiai-vector` / `classic-chen-side-scabbard` / `emperor-silver-pistol` / `lappland.weapons[]` …），
  关联到**本人**；只能就地开 / 关，不能搬给别人。
- **共享池（shared）**：`WEAPONS` 里的 ★黑刃 / ★黑岩巨炮 / 葱，**任何角色**都能装。
- **两池互斥**：`rig.poolMode: 'native' | 'shared'`，`setPool()` 切池。装共享武器 → 原生自动让位；
  点原生武器 → 共享自动卸下。UI 上非当前池的武器按钮变灰。
- **手位上限 2**：`activeCount()` 按当前池计数；原生开第 3 把会挤掉最早开的。
- **单手 / 双手**：`WEAPON_HANDS`（`twinBlades: 2`，其余默认单手）。原生武器攻击时
  **每把各按自己的类型**跑标准招，**双手武器两手都有动作**。
- **角色绑定**：`mountWeapons(model, [], { bind })` 把 `LOADOUT` 里的武器绑进**角色武器池**（如黑岩的黑刃 / 巨炮）。
- **多武器按序**：`attackSequence()` 把「手 → 招式」整理成**动作序列** —— **同一个招式合并成一组**
  （如双剑「交叉斩」两手同时），**不同招式按手序先后播放**（黑岩：**先炮后刀**）。
  攻击时长 = 各段**相加**；动作名用 `→` 连接（`连射 → 横斩`）。

### 6.2 初音未来 / 黑岩射手 → 角色实验室「新增模型」（**磁盘上的正式模型**）

两人作为**正式新增模型**落盘在 `NewlyAddedModelList/miku/`、`NewlyAddedModelList/brs/`
（`model.json` + `model.js`），所以「角色实验室 → 新增模型」是**从磁盘读**的、不在代码里写死。

- 落盘用的就是我们自己的导出：`exportSpec(id)` + `factorySource(id)` → `POST /api/models { dir:'confirmed' }`；
- 载入时，实验室按 **id 匹配到 `LP.CHARACTERS[id]`** 就用**运行时本体**构建（圆角盒 + 手绘脸 + 武器，全质量），
  而不是用 `model.js` 那个小解释器；随后挂 `LP.mountWeapons()`（自带武器绑进「角色武器池」）；
- 切回原作角色时，按钮会把 `P.model` 从 `'new'` 复位成 `'low'`，高亮也一并清掉。

> 换句话说：文件在磁盘上（别的工具也能拿），但**渲染走运行时本体**。

**各自的武器**：
- **黑岩**：`LOADOUT = [黑岩巨炮·arm0, 黑刃·arm1]`（**炮在左手**，用回它自己的 `hand:0`），
  `bind` 进她的**角色武器池**。
- **初音的葱 → 武器（锤类）**：`WEAPONS.leek`（`type:'hammer'`）进**共享池**；
  同时 `extractNativeWeapons()` 把模型里的 `leek` 组认成她**角色武器池**的原生武器
  （`WEAPON_NAME_TYPE/LABEL` 精确覆盖 + **递归走查对象**，组也能命中）。
- **换招数**：`moveCount()` / `attackLabel()` / `attackDuration()` / `attackPose()` 把**原生（含绑定）武器**也计入。
- **光圈**：`addRing()` 挂到**场景** —— `poseCharacter()` 的**膝部接地钳制**会把 root 往上顶，
  挂 root 的光圈会浮到脚踝（黑岩脚在原点下方 ~0.11，最明显）。

---

## 7. 已知差距与下一步
- **脸是两套管线**：工坊的 `useOrigFace`（原作脸）vs 我们的 `paintFace`（自绘，含持械严肃版）。
  想彻底统一，要么把 `paintFace` 作为贴图接到工坊的头部（需要 spec 支持贴图），要么反过来。
- **`factorySource` 是简化的**：小解释器建的 spec 是直角盒、无手绘脸、~1,176 面；
  真正带**圆角盒 + 96×80 手绘脸 + 武器**的是运行时本体（4,232 / 5,436 面），实验室直接跑本体。
- **`partBoxes()` 是近似**：非 `box` 图元按轮廓 + 深度取包围盒。够跑 `seamGate`，不是精确 AABB。

---

## 8. 原作角色 → 程序化移植（进行中 · 第一刀：德克萨斯）

目标：14 个原作角色**逐个**改由**我们的 `Builder`** 构建，最终删掉 `characters.orig.js` 的 id 注册表。

### 8.1 方法（已验证）

1. **抓图元**：挂 `Q.prototype.box / shape / build` 钩子，跑一遍 `XT(id)`，逐条留下**作者级图元**。
   —— 原作 `Q.box(x,y,z,w,h,d,color,rotZ)` 和我们的 `Builder.box` **签名一字不差**
   （texas：83 `box` + 18 `shape` = **101 个图元**；`add` 是它们的内部实现，重复，忽略）。
2. **骨骼命名**：按**变换签名**认（`body y=-0.1095` / `head y=1.47 + scale` / `arms ±0.36,1.3` /
   `legs ±0.16,0.73` / `knees 0,-0.3`）；分不出的再用**子树签名**（meshes + tris）对回 rig
   → 认出 `tail` / `prop` / `weapons[0..1]` / 手臂上的小挂件。
3. **重建**：`src/lowpoly/orig/<id>.js` 存 `*_DATA`（bones + parts）；
   `src/lowpoly/orig/port.js` 的 `buildFromPort(data)` 用 `Builder` 重放，并用原作的**脸管线**
   `attachFace(head,{id})` 现场生成**头 + 脸**（头基座不在图元数据里）。
   实测 texas：**三角面 4832 = 4832（完全一致）**，骨骼命名全部对上。

### 8.2 踩过的四个坑（都解决了）

1. **骨骼命名**：`build(parent)` 的对象和 `XT` 返回的 `body/head/…` 不是同一批 → 按**变换签名**认
   （`body y=-0.1095` / `head y=1.47+scale` / `arms ±0.36,1.3` / `legs ±0.16,0.73` / `knees 0,-0.3`），
   分不出的再用**子树签名**（meshes + tris）对回 rig → `tail` / `prop` / `weapons[0..1]`。
2. **图元原点**：个别组的图元原点被 `RT/PT` 重挂过 → 重放会偏（texas 的**后发**）。**对策**：这类部位存
   **精确几何**（`hairGeo.positions/normals/colors`，见 `orig/port.js` ③b），别重放。
3. **可见性**：原作藏起来的组（texas 的 `prop.visible=false`）也要抓 → `hide:[…]`，否则移植版会多出一块。
4. **根缩放**：把原 `It(id)` 的值存进数据（`rootScale`），移植版就不再依赖 id 注册表。

> 结论：**变换本身不用改**（build 时读到的和后处理一致）；真正要处理的是**原点被重挂的图元**和**可见性**。

### 8.3 第一刀：德克萨斯 ✅

```
三角面 4832 = 4832；body/head/hair/arms×2/legs×2/knees×2/tail/prop/weapons×2 共 13 组 bbox 逐组完全一致
脸部 attachFace 正常；走路整周期接地 minY = 0；实验室 0 报错
```
实验室现在走 `PORTS`（`character-lab.html` 的 `const ported = LP.PORTS && LP.PORTS[P.id]`），
**几何由我们的 `Builder` 构建**，不再经过 `XT('texas')`。

### 8.4 每个角色的验收（缺一不可）

```
三视图 + 脸部出图 vs 原作 → metrics（面数 / 网格数）±5% → __lab soleY() 走路整周期 = 0
→ 通过后：几何改走 PORTS（id 注册表只剩 KT/AT/It 这类**数据**，不再提供几何）
```

### 8.5 ★ 移植一个角色的清单（照这个走）

```
① 抓：挂 Q.prototype.box/shape/build 钩子跑一遍 XT(id) → groups[]（每个 build 调用一条）+ 图元
② 命名：core 用**变换规则**（body y=-0.1095 / head y=1.47+scale / 臂 |x|≈0.36 & y>0.9 /
        腿 |x|≈0.16 & 0.5<y<0.9 / 膝 父=腿 & y=-0.3 / 发 父=head）；余下用**子树签名**认
        tail / prop / coatTails / weapons[i]（L/R 用**父级**区分，别只用签名 —— 左右签名常常一样）
③ 生成 orig/<id>.js：
     - 扁平数据：{ id, rootScale, hide[], palette{AT,KT}, bones[], parts[] }（无嵌套时够用）
     - 有**嵌套 wrapper**：{ id, rootScale, roles{}, nodes[], parts[] }（忠实树，保留每个 build 组）
④ port.js 重建 + attachFace(head,{id, iris:palette.AT}) 出脸
⑤ 验收：逐槽位 bbox 与原作**逐组一致** + 三角面相等 + 走路 soleY=0 + 出图
⑥ 进 PORTS → 实验室自动走程序化
```

**踩过的坑（都已解决）**：骨骼命名 → 变换/子树签名；**图元原点被 RT/PT 重挂** → 该组存精确几何
或忠实树；**可见性** `hide[]`；**根缩放** `rootScale`；**调色板** 搬进 `palette{AT,KT}`（不再依赖 id 表）。

### 8.6 进度：**14 / 14 全部移植完成** ✅

实验室里 14 个低模**全部走程序化**（`ported=true`），三角面**逐人全等**、逐骨骼 bbox 基本全对（仅 3 处可忽略残差）。

| 结果 | 角色 | 备注 |
|---|---|---|
| ✅ 完全一致 | texas · aak · sora · swire · chen · croissant · hoshiguma · lee · lappland · hung · waaifu | 三角面 + 逐骨骼 bbox 全对 |
| ✅ 三角面全等 | emperor（body 残差 0.025）· exusiai（`hair` 对象为空，姿态里「有则动」跳过）· mostima（head 0.107 / hair 0.246） | 三处极小残差，肉眼不可见 |

**★ 移植路上踩平的坑（按发现顺序）**
1. **必须只调一次 `XT(id)`** —— 两次会拿到**不同的对象图**，身份永远对不上（`RT` 其实是恒等函数）。
2. **`exact` 只能给叶子组** —— 非叶子会把整棵子树重复收进来。
3. **脸网格要排除** —— 否则和 `attachFace` 重复（+972）。
4. **`geoRaw` 捕获要 `g.toNonIndexed()`** —— 否则丢 index，三角面少一半。
5. **emperor 没有 `attachFace` 那套头** → `noFace: true`。
6. **`Builder` 不能混** `box/shape` 与「直接 `add` 的裸几何」→ `build()` 返回 null；`replay` 要**按种类分段 flush**。
7. **有些网格是 `Object3D.add` 直接挂的**（能天使/莫斯提马的**光环 Torus 192 面**）→ 也钩上，按最近骨骼归属。
8. **武器名要回填到移植数据的网格上** —— 原作武器是**有名字的独立网格**（`croissant-hammer` /
   `croissant-shield` / `hoshi-shield` / `classic-chen-side-scabbard` / `swire-right-chain-weapon` /
   `emperor-suitcase` …），`extractNativeWeapons()` **按名字**把它们分进「角色武器池」。移植后网格无名
   → **可颂 / 星熊 / 陈 / 诗怀雅 4 人武器池空**（拉普兰德 / 能天使靠骨骼名 `weapon0` 蒙对、但显示名是 `weapon0`）。
   修法：捕获时（仍是**只调一次 `XT`**）把每个 build 组的**返回网格名**记进 `parts[].nm` / `exact[].name`
   —— ⚠ 名字是**调用方在 `build()` 返回之后**才设的，所以要在 `XT` **结束后**读 `mesh.name`（在 `build` 钩子里读只会拿到空）。
   `port.js` 的 `replay()` 用 `part.nm` 回填、`exactMesh()` 也要 `m.name = it.name`。
   > 补名要**在已发布的几何上打补丁，别重跑几何**：多 id 同一 evaluate 里连调 `XT` 会命中坑 1（拿到不同的图），
   > 重跑会让能天使 +200 / 拉普兰德 −12 面。
9. **移植模型要带 `spec.id`** —— `extractNativeWeapons()` 的**按角色兜底**（`WEAPON_TYPE_BY_CHAR`）读
   `model.spec.id`；`buildFromPort()` 必须返回 `spec:{ id }`，否则骨骼名叫 `weapon0` / `weaponL` 的武器
   **类型 / 显示名认不出**（按钮显示 `weapon0 · 单手`）。另外 `add()` 认不出类型时会**往下找一个有名字的网格**再定类型。

> 数据体积：6KB ~ 692KB/人（用 `exact` 精确几何的几位偏大）。
> **「忠实树」模式（`nodes`，`port.js` 模式 A）**：保留原作嵌套 wrapper、可省掉 `exact` 裸顶点数组 → 能把大文件压小；
> `port.js` 已支持，**但目前 14 人仍全走扁平模式（本轮暂缓，未启用）**。启用时务必逐人重验（面数 + 逐节点 bbox + `soleY=0`），
> 并带上 `nm`（否则武器池回退）。

**验收（含武器名）**：14 人三角面仍逐人全等；`mountWeapons(port, [], {startNative:true}).nativeList` 恢复为
德州 `刀×2` · 拉普兰德 `双剑×2` · 能天使 `冲锋枪` · **可颂 `巨锤+盾`** · **星熊 `盾`** · **陈 `剑鞘`** · **诗怀雅 `链锤`** ·
大帝 `手枪+提箱` · 莫斯提马 `法杖×2`；且 `toggleNative()` 只隐藏武器那一个网格（可颂锤 76 面 / 盾 60 面）。
