# Q版方块角色 · MagicaVoxel 体素版

参考图的 **体素（voxel）实现**：直接生成 MagicaVoxel 的 `.vox` 文件，并提供浏览器体素预览。

## 为什么是"生成 .vox"而不是"操作 MagicaVoxel"

MagicaVoxel 是**纯 GUI 程序，没有可用的命令行建模接口**，无法脚本化点击操作。
但 `.vox` 是公开格式，所以正确做法是：

```
代码生成 .vox  →  MagicaVoxel 打开 / 手改 / 渲染  →  导出 OBJ/PLY  →  Three.js
```

我生成的文件你可以直接在 MagicaVoxel 里打开继续编辑。

## 文件

| 文件 | 说明 |
|---|---|
| `qgirl-classic.vox` | Classic 原版，MagicaVoxel 可直接打开 |
| `qgirl-alternate.vox` | Alternate 变体 |
| `qgirl-classic.json` / `qgirl-alternate.json` | 同一模型的 JSON，供浏览器查看器使用 |
| `index.html` / `app.js` / `style.css` | Three.js 体素查看器 |

`.vox` 已同时复制到：

```
C:\Users\31273\Desktop\MagicaVoxel-0.99.7.2-win64\vox\
```

## 在 MagicaVoxel 中打开

1. 启动 `MagicaVoxel.exe`
2. 右侧面板 → `Open` → 选择 `vox\qgirl-classic.vox`
3. 或者直接把 `.vox` 拖进窗口

打开后可以直接：
- 用 `Attach` / `Erase` 修形状
- 用 `Paint` 改配色（调色板已内置 6 色）
- 按 `Render` 出图
- `Export` → `obj` / `ply` 给 Three.js 用

## 浏览器预览

```bash
cd skills/ThreejS_Standard_modeling
npx --yes http-server . -p 4178
```

打开 `http://localhost:4178/projects/voxel-character/`

查看器功能：
- Classic / Alternate 变体切换
- 自动旋转、地面网格、重置视角
- 实时统计（体素总数 / 可见体素 / 三角面 / 模型尺寸）

**已做面剔除**：完全被包围的内部体素不生成实例。

| 指标 | 数值 |
|---|---|
| 体素总数 | 57,620 |
| 可见（表面）体素 | 15,740 |
| 三角面 | 188,880（InstancedMesh，1 次 draw call） |
| 模型尺寸 | 72 × 34 × 74 体素 |

## 重新生成

```bash
# 生成 .vox + .json
node tools/build-voxel-character.js projects/voxel-character

# 终端 ASCII 三视图自检（不开 GUI 也能看造型）
node tools/build-voxel-character.js --preview
```

生成器在 `tools/build-voxel-character.js`，无需任何依赖。

## 生成器结构

```js
const V = new Vox();                       // 体素网格
V.box(x0,x1, y0,y1, z0,z1, color)          // 实心方块
V.both(...)                                // 左右镜像
V.taperBoth(...)                           // 左右镜像 + 逐层收窄（四肢）
V.discXZ(cx,cz, r, y, color)               // 圆形（眼睛）
V.ringXZ(cx,cz, r, y, color)               // 圆环（描边）
```

坐标：`x` 左右、`y` 前后（**正面 = -Y**）、`z` 高度（**Z 轴向上**，符合 `.vox` 约定）。
写入 Three.js 时映射为 `(x, y, z) → (x, z, -y)`。

## 调色板

| 索引 | 颜色 | 用途 |
|---|---|---|
| 1 | `#1b1e26` | 布料黑 |
| 2 | `#14161c` | 头发黑 |
| 3 | `#f2f4f6` | 白 |
| 4 | `#f8ddc9` | 皮肤 |
| 5 | `#ecc8b2` | 皮肤暗部 |
| 6 | `#b9c4cb` | 金属 |
| 7 | `#0a0b0e` | 描边黑 |
| 8 | `#2a2d38` | Alternate 布料 |

## 造型对照参考图已实现的部分

- ✅ 方块化大头发团 + 阶梯顶冠 + 后发 + 侧发 + 锯齿刘海
- ✅ 白色圆眼 + 细黑描边 + 小嘴
- ✅ 方块双马尾（分段收窄）+ 外侧尖刺 + 发带
- ✅ 黑色敞开长外套 + 白色翻边 + 肩块 + 袖条
- ✅ 内搭 + 露腰 + 黑色短裤 + 黑白宽腰带 + 腰带扣
- ✅ 方块长手套 + 白袖口 + 指节
- ✅ 方块长筒靴 + 白色尖角靴口 + 白色鞋底
- ✅ 颈圈 / 背部五角星

## 已知不足

- 马尾是整体方块链，未做参考图那种多束分叉
- 面部只有眼和嘴，没有腮红
- 后发与头部的衔接比较简单
- 外套下摆是左右两片 + 后片，不是参考图的多片开口

这些都是**在 MagicaVoxel 里手动微调最快**的部分——直接在体素上点几下即可，不需要改生成器。
