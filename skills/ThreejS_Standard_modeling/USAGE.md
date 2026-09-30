# ThreejS_Standard_modeling · 使用文档

## 0. 这个技能到底怎么用（最重要的一条）

**标准模型是基准。参考图只是细节来源。**

```
❌ 错误做法
   照参考图重建人体比例 → 和标准模型完全不像

✅ 正确做法
   以 reference/iE.json 标准模型为骨架和比例
   → 把参考图里的服装 / 发型 / 配色 / 配件当作"细节"
   → 叠加到标准模型上
```

所有参考图都要**先被转换成标准模型的样子**（Q 版约 2.4 头身），而不是把标准模型拉成参考图的样子。

标准模型长什么样，直接打开标准项目看：

```
http://localhost:4174/viewer/
```

---

## 1. 目录结构

```
ThreejS_Standard_modeling/
├── SKILL.md                     技能索引
├── USAGE.md                     本文档
├── ANALYSIS.md                  对目标项目的逆向分析
├── manifest.json                来源与资产清单
├── viewer/                      ★ 标准项目（模型查看器）
│   ├── index.html
│   ├── style.css
│   └── viewer.js
├── reference/                   ★ 标准模型数据
│   ├── iE.json                  Classic 标准模型（推荐基准）
│   ├── aE.json                  Desolate 变体
│   ├── PE.json / yD.json / dO.json   iE 的运行时副本
│   └── standard-landmarks.json  ★ 实测骨架数据（不用再自己量）
├── kit/                         可复用几何与装配工具
│   ├── standard-modeling-kit.js
│   ├── example-character.js
│   └── test.html
├── tools/
│   └── measure-standard.js      标准模型测量脚本
└── projects/
    ├── girl-character/          示例项目 A：标准骨架 + 程序化方块服装
    └── voxel-character/         示例项目 B：MagicaVoxel .vox 体素角色 + 查看器
```

`tools/` 下有两个脚本：

| 脚本 | 用途 |
|---|---|
| `measure-standard.js` | 测量标准模型的骨架、头型剖面、发际线、眼睛位置 |
| `build-voxel-character.js` | 生成 MagicaVoxel `.vox` + 浏览器用 JSON，支持 ASCII 三视图自检 |

---

## 2. 标准模型是什么

| 项目 | 值 |
|---|---|
| 格式 | Three.js `Object3D.toJSON` |
| 总高 | **2.298** |
| 头身比 | **约 2.4 头身（Q 版）** |
| 朝向 | **+Z**（脸在 z ≈ +0.36） |
| 几何体 | 45 |
| 材质 | 40 |
| 纹理 | 3 |
| 三角面 | 1787 |
| 骨骼/枢轴 | 耳朵、肘、脚踝等为独立 `Group` |

### 实测骨架（世界坐标）

| 部位 | 范围 (y) | 说明 |
|---|---|---|
| 脚底 | 0.000 | 对齐 Y=0 |
| 靴子/脚 | 0.000 – 0.167 | |
| 小腿 | 0.124 – 0.356 | |
| 膝 | 0.313 – 0.424 | 膝枢轴 ≈ 0.368 |
| 大腿 | 0.386 – 0.643 | |
| 躯干 | 0.656 – 1.250 | 半宽 ±0.247，半深 ±0.171 |
| 手臂 | 0.709 – 1.102 | x = ±0.292 |
| 手 | 0.585 – 0.709 | x = ±0.292 |
| 头 | 1.065 – 1.814 | 最宽处 ±0.514（y 1.66–1.78） |
| **眼睛** | **y 1.342 – 1.433**（z ≈ 0.342） | 由 96×80 脸部贴图 + UV 反推，`measure-standard.js` 自动报告 |
| 耳朵 | 1.750 – 2.298 | |
| 原始发际线 | y ≈ 1.32 | 原角色刘海下沿；**新刘海必须在眼睛上方（> 1.44）** |

### 关键形态结论（踩过坑）

标准模型的头**不是椭球，是上宽下窄的圆角方块**：

```
y 1.065–1.14  |x| ≈ 0.33   ← 下巴
y 1.14 –1.22  |x| ≈ 0.39   ← 脸颊
y 1.66 –1.78  |x| ≈ 0.51   ← 颅顶最宽
y 1.74 –1.81  |x| ≈ 0.47   ← 顶部接近平的
```

所以头发必须**在 y 1.66–1.78 处最宽（rx ≥ 0.55）**。如果按椭球在 y 1.44 处最宽来做，颅顶会露出来。

---

## 3. 快速开始

### 打开标准项目

```bash
cd <skill 目录>
npx --yes http-server . -p 4174
# 打开 http://localhost:4174/viewer/
```

### 打开示例角色项目

```bash
npx --yes http-server . -p 4178
# 打开 http://localhost:4178/projects/girl-character/
```

### 重新测量标准模型

```bash
node tools/measure-standard.js reference/iE.json          # 可读报告
node tools/measure-standard.js reference/iE.json --json    # JSON
```

---

## 4. 使用流程（7 步）

### 第 1 步 · 读标准骨架

```bash
node tools/measure-standard.js reference/iE.json
```

或直接读 `reference/standard-landmarks.json`。**不要凭感觉猜人体比例。**

### 第 2 步 · 加载标准模型，只保留中性人体

只保留这四个分类，其余全部隐藏（发型、服装、武器、耳朵、尾巴、杯子、纸箱等）：

```js
const KEEP = new Set(['基础头型', '基础身体', '基础手臂（含手）', '基础腿部']);
```

```js
const obj = new THREE.ObjectLoader().parse(data);
// 先收集，再修改。绝对不要在 traverse 回调里 add/remove 节点
const meshes = [];
obj.traverse(o => { if (o.isMesh) meshes.push(o); });
for (const o of meshes) {
  const keep = KEEP.has((o.userData.studyCategory) || '');
  o.visible = keep;
  if (keep) register(o, category);   // 只登记，不要 reparent
}
```

> ⚠️ **两个必须避免的错误**
> 1. 在 `traverse` 里 `add()` / `remove()` —— 会改动正在遍历的 `children` 数组，导致 `undefined` 报错。
> 2. 把模板网格 `root.add()` 出来 —— 会脱离父级、丢失父级变换，模型散架。

### 第 3 步 · 把参考图翻译成细节清单

参考图只提供：发型、服装、配色、配件、武器。

| 参考图元素 | 转成什么 |
|---|---|
| 黑色超长双马尾 | 头侧枢轴 + 放样锥形 |
| 敞开长外套 + 白边 | 轮廓挤出衣片 + `ribbon` 包边 |
| 露腰内搭 | 环形放样带 |
| 短裤 / 宽腰带 | 环形放样带 |
| 长手套 / 袖口 | 手臂环形放样 |
| 长筒靴 + 白色尖角 | 靴筒放样 + 轮廓挤出装饰 |
| 颈圈 / 徽章 | 环形放样 / `shapeExtrude` |

### 第 4 步 · 用标准坐标写几何

所有坐标直接使用标准模型的世界坐标（见第 2 节表格）。

```js
// 头发
A(hair, stack('hair-cap', [
  [1.360, .470, .400, 0, -.010],
  [1.500, .520, .420, 0, -.010],
  [1.660, .565, .430, 0, -.010],   // ← 颅顶最宽处，必须够宽
  [1.780, .545, .410, 0, -.010],
  [1.860, .330, .260, 0, -.010],
  [1.885, .100, .080, 0, -.010]
], 8, M.hair, 'hair'), 'hair');
```

### 第 5 步 · 组织层级与枢轴

```text
character
├── 标准模型（保留中性人体，保留原有父子层级）
└── details
    ├── head-pivot → hair
    ├── ponytail-root-L / R
    ├── arm-pivot-L / R → elbow → hand → hand-weapon-mount
    ├── leg-pivot-L / R → knee → ankle
    ├── clothing
    ├── shoes
    └── accessories
```

### 第 6 步 · 控制三角面

目标 **1800–2400 tris**（标准模型本身 1787，加的细节要控制在预算内）。

主要手段：

```js
const OPEN = { capStart: false, capEnd: false };   // 端面被遮住就不生成
stack(name, rows, 6, mat, cat, OPEN);
```

- 环数：躯干/头 8 边，四肢/马尾 6 边
- 隐藏端面一律 `OPEN`
- 装饰层数能省则省

### 第 7 步 · 验收

见第 8 节。

---

## 5. 几何 API

从 `kit/standard-modeling-kit.js` 导入：

```js
import { M, stack, loft, ring, shapeExtrude, profileExtrude, ribbon, panel, starPoints }
  from '../../kit/standard-modeling-kit.js';
```

| 函数 | 用途 | 说明 |
|---|---|---|
| `blockStack(name, rows, mat, cat, opts)` | **方块风格主力** | `rows = [[y, 半宽, 半深, cx?, cz?], ...]`，4 边轴对齐截面 → 硬边方块 |
| `block(name, w, h, d, mat, cat, cx, cy, cz)` | 单个硬边方块 | `blockStack` 的便捷封装 |
| `stack(name, rows, sides, mat, cat, opts)` | 圆润/管状放样 | `rows = [[y, rx, rz, cx?, cz?], ...]` |
| `loft(name, rings, ...)` | 任意环堆叠 | 底层实现；自动修正法线朝向 |
| `squareRing(cx, y, cz, hw, hd)` | 轴对齐方形环 | |
| `ring(cx, y, cz, rx, rz, sides)` | 椭圆环 | |
| `shapeExtrude(name, pts, depth, mat, cat)` | 硬边轮廓挤出 | **支持凹多边形**（星形、刘海、尖角、衣片） |
| `profileExtrude(...)` | 带倒角轮廓挤出 | 只适合凸多边形 |
| `ribbon(name, path, widths, thickness, mat, cat)` | 沿路径扫掠 | 截面垂直于路径；用于包边、绑带 |
| `panel(name, pts, depth, mat, cat)` | 服装片 | `shapeExtrude` 的语义别名 |
| `starPoints(outer, inner, cx, cy)` | 五角星轮廓点 | |
| `circlePoints(r, cx, cy, sides)` | 正多边形轮廓点 | 圆眼、圆形徽章 |
| `orientOutward(geometry)` | 自动修正法线朝向 | 已在 `loft`/`ribbon` 内置 |
| `M` | 共享材质 | `skin / hair / black / blackSoft / white / eye / outline / metal` |

### 必须避免

```js
// ❌ 不允许作为可见主体
new THREE.BoxGeometry()
new THREE.SphereGeometry()
new THREE.CylinderGeometry()
```

它们只能用于：草模、碰撞体、隐藏支撑体。

---

## 6. 层级与枢轴规范

- 关节用**真实 `Group`**，旋转即可带动子级
- 枢轴放在关节位置，几何写在**枢轴局部坐标**
  - 若几何已在世界坐标写好了，把它放进一个 `position = -jointWorldPos` 的中间组（见示例里的 `head-rig`）
- 命名规范（沿用标准模型语义）：
  - `head-pivot`、`arm-pivot-L/R`、`elbow-pivot-*`、`hand-pivot-*`
  - `leg-pivot-*`、`knee-pivot-*`、`ankle-pivot-*`
  - `ponytail-root-L/R`
  - `hand-weapon-mount-L/R`（空 `Group`，`userData.weaponMount = true`）

---

## 7. 三角面预算参考

| 部位 | 建议 |
|---|---:|
| 头（来自标准模型） | ~300 |
| 躯干（来自标准模型） | ~32 |
| 四肢（来自标准模型） | ~190 |
| 头发 | ≤ 400 |
| 服装 | ≤ 600 |
| 鞋子 | ≤ 200 |
| 配件 | ≤ 200 |
| **合计** | **1800–2400** |

---

## 8. 验收清单

- [ ] 人体比例来自标准模型，没有被参考图拉变形
- [ ] 参考图只贡献了服装 / 发型 / 配色 / 配件
- [ ] 可见主体没有 Box / Sphere / Cylinder
- [ ] 三角面在 1800–2400
- [ ] 有真实关节 `Group`，旋转枢轴能带动子级
- [ ] 左右手有武器挂点
- [ ] 有 Classic / Alternate 两套变体
- [ ] 查看器有：分类开关、线框、自动旋转、实时三角面统计
- [ ] 控制台无报错
- [ ] README 写明面数、层级、材质、变体、运行方式

---

## 8.5 防穿模规则（Q 版头部极大，必须遵守）

标准模型的头从 y 1.065 起就已经是 ±0.33 的宽块，和躯干顶部（1.250）**重叠**。所以：

| 规则 | 原因 | 做法 |
|---|---|---|
| **服装不得高于 y 1.060** | 高过下颌就会插进头里 | 外套前片/后片、内搭、颈圈全部控制在 1.06 以下 |
| **兜帽必须在头侧之外且在脸后** | 否则插进头 | 例如 `y 1.12 时 rx .405（> 头 ±.374）、cz -.170`，前面只到 z .10（脸在 .34） |
| **发帽下沿 > 1.44** | 眼睛上沿 1.433 | 发帽从 y 1.465 起 |
| **刘海中间要短、两侧可长** | 眼睛在 |x| < 0.2 | 中间到 y ≈ 1.44，外侧可垂到 1.34 |
| **手臂要外摆** | 手在 x .22–.36，外套裙摆 rx 到 .45 → 手插进裙摆 | 找到 `reference-elbow-0/1` 的父组，`rotation.z ±= 0.40`；自己的袖子/手套挂在同角度的 rig 上 |
| **马尾不得低于 y 0** | 会穿地板 | 马尾总长控制在 ~1.25（从根 y 1.48 到尖端 ≈ 0.35） |

验证方法（浏览器控制台）：

```js
const V = window.__girlViewer;            // 项目暴露的调试接口
V.root.updateMatrixWorld(true);
const T = V.THREE;
const b = n => { let o; V.root.traverse(x => { if (x.name === n) o = x; });
                 return new T.Box3().setFromObject(o); };
b('base-hand').max.x;   // 与 b('coat-skirt').max.x 比较，手必须在外侧
b('ponytail-L-0').min.y; // 必须 > 0
b('hair-cap').min.y;     // 必须 > 1.433
```

---

## 8.8 体素路线（MagicaVoxel）

当目标是**方块/体素风格**，或者手工排顶点太慢时，走体素路线更快、更可控。

### 为什么是"生成 .vox"而不是"操作 MagicaVoxel"

MagicaVoxel 是纯 GUI 程序，**没有可用的命令行建模接口**。但 `.vox` 是公开格式：

```
代码生成 .vox  →  MagicaVoxel 打开 / 手改 / 渲染  →  导出 OBJ/PLY  →  Three.js
```

### 工具

```bash
node tools/build-voxel-character.js <outDir>     # 生成 .vox + .json
node tools/build-voxel-character.js --preview    # 终端 ASCII 三视图自检
```

**重要**：`--preview` 会打印 ASCII 正视图/侧视图。没有截图工具时，这是最直接的造型自检手段。

### .vox 写入要点（踩过的坑）

| 项 | 正确做法 |
|---|---|
| 版本 | `VOX ` + int32 **150**（最小兼容集） |
| 结构 | `MAIN { SIZE, XYZI, RGBA }`，MAIN 的 `contentSize = 0` |
| **childrenSize** | 必须等于 `SIZE + XYZI + RGBA` **三个块的总字节数**（含各自的 12 字节头）。少算会导致尾部多出垃圾，MagicaVoxel 打不开 |
| XYZI | `int32 数量` + 每个体素 4 字节 `x, y, z, 颜色索引` |
| RGBA | 固定 1024 字节，`palette[i]` 对应颜色索引 `i+1` |
| 坐标 | `.vox` 是 **Z 轴向上**，正面在 **-Y** |
| 颜色索引 | 1..255，0 表示空 |

自检：写完 `Buffer` 后断言 `写入偏移 === 分配长度`。

浏览器里的坐标映射：`(x, y, z)_vox → (x, z, -y)_three`。

### 体素查看器

`projects/voxel-character/` 用 `InstancedMesh` 渲染，并做**内部体素剔除**（六面都被包住的体素不可见）：

| 指标 | 数值 |
|---|---|
| 体素总数 | 57,620 |
| 可见（表面）体素 | 15,740 |
| 三角面 | 188,880（1 次 draw call） |

体素网格是 `InstancedMesh`，色板走 `instanceColor`。体素渲染里立方体是数据单元，因此顶点是手写的立方体，不使用 `BoxGeometry`。

### 当前体素角色

`projects/voxel-character/`（`qgirl-classic.vox` / `qgirl-alternate.vox`），已复制到
`C:\Users\31273\Desktop\MagicaVoxel-0.99.7.2-win64\vox\`，可直接在 MagicaVoxel 打开继续手改。

---

## 9. 常见坑

| 现象 | 原因 | 解决 |
|---|---|---|
| 身体像纸片、侧面消失 | 截面建在 XY 平面、沿 Y 推进 | 用 `stack`/`loft`/`blockStack`，截面必须是 XZ 环 |
| **某个部件"没生成"、正面能看穿** | `loft` 绕序取决于环是向上还是向下叠；朝内时正面被背面剔除 | 已内置 `orientOutward()` 自动修正。若自定义几何，务必调用它 |
| 部件内外翻转但看着"还行" | 看到的是远侧内壁 | 同上；用射线检测确认首个命中体正确 |
| `Cannot read properties of undefined (reading 'traverse')` | 在 `traverse` 回调里 `add`/`remove` 了节点 | 先收集到数组，遍历结束后再修改 |
| 模型散架、部件乱飞 | 把模板网格 reparent 出原父级，丢失变换 | 只登记引用，不改变父子关系 |
| 枢轴旋转后部件偏移 | 几何写在世界坐标却挂在有位移的枢轴下 | 用局部坐标，或加一个 `position = -jointPos` 的中间组 |
| 头发盖住眼睛 / 颅顶露白 | 按椭球假设头部半径 | 头部最宽在 y 1.66–1.78（±0.51），发际线在 y ≈ 1.32 |
| 三角面超预算 | 每个部件都生成了端面 | 隐藏端面传 `{capStart:false, capEnd:false}` |

---

## 10. 当前示例项目的状态（诚实说明）

`projects/girl-character/` 已按 **Q 版方块风格**参考图重做（2026-09-28）：

- ✅ 以标准模型为骨架（保留 14 个中性骨架网格，隐藏 31 个原角色部件）
- ✅ 按规则 1 **剥离模板外观**：骨架材质统一为共享皮肤材质，丢弃原脸部贴图/发型/服饰/配色
- ✅ 自绘 **白色圆眼 + 细黑描边 + 小嘴**（不再依赖模板贴图）
- ✅ 方块化发型（发团 / 阶梯顶冠 / 后发 / 侧发 / 锯齿刘海 / 方块双马尾 + 尖刺）
- ✅ 方块化服装（敞开外套 + 白边 + 肩块 + 袖条 / 内搭 + 露腰 + 短裤 / 黑白宽腰带）
- ✅ 方块长手套（含 z 向包覆修正）、方块长筒靴 + 白色尖角与鞋底
- ✅ 三角面 **1863**（预算内），材质 7 个全部共享
- ✅ 最低点 -0.001（脚底对齐 Y=0）
- ✅ 真实关节枢轴、双手武器挂点、Classic / Alternate 变体、完整查看器 UI

仍待打磨：

- ⬜ 外套下摆是整体方块裙，未做参考图那种分片开口
- ⬜ 马尾方块链的层次可再细分
- ⬜ 未做面部表情 / 腮红
- ⬜ Alternate 变体目前仅替换主色与下摆配色

这些都是**在标准模型上继续补细节**的工作，不需要再改比例。
