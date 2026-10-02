# 武器文件 —— 存哪 · 什么形状 · 怎么拿

> 武器是**独立路线**：**不**跟人物建模走（没有骨架、没有 body/head/arms）。
> 武器在**自己的坐标系**里建模（握把 = 原点），由角色的**武器池绑定**才挂到手上。
>
> 人物模型见 [`model-files.md`](model-files.md)；武器编辑器见 `pages/weapon-editor.html`。

---

## 1. 三个目录

| 目录 | 装什么 | 谁写 | 会被清吗 |
|---|---|---|---|
| **`OriginalWeaponList/`** | **共享武器库 = 共享池本体**（黑刃 / 黑岩巨炮 / 葱 …）—— ★ 显示名已改成「共享武器库」，**目录名沿用 `OriginalWeaponList`**（历史名，服务端 / API 未改） | `lp/weapons.js` 代码为准，落一份元数据 | 不会 |
| `NewlyAddedWeaponList/` | **新增武器**（正式，也进共享池） | 武器编辑器 / AI Agent | 不会 |
| `NewlyAddedWeaponTemporaryList/` | **待确认的新增武器** | 武器编辑器 / AI Agent | 不会 |

> ★ **武器库的武器 = 共享池**：任何角色都能装。
> 对照「角色武器池」——那是角色自带、从模型里按名字分割出来的（`extractNativeWeapons`），只能就地开关。

每把武器一个子目录：

```
<id>/
  weapon.json   规格（本体图元 + 挂载数 + 种类 + 绑定的动作）+ 元数据
  weapon.js     可选工厂函数（AI / 运行时想直接跑它时用）
  thumb.png     缩略图（可选）
```

---

## 2. `weapon.json` 的形状

```jsonc
{
  "schema": "lowpoly-workshop/weapon@1",
  "id": "myBlade",
  "name": "测试长刀",
  "category": "新增武器",
  "source": "weapon-editor:exportJS",
  "note": "",
  "createdAt": 0, "updatedAt": 0,
  "stats": { "parts": 1, "primitives": 6, "triangles": 320, "mode": "weapon" },

  "mount": 1,                 // 挂载数：1 = 单手，2 = 双手
  "kind": "blade",            // 种类：blade 刀 / hammer 锤 / gun 枪 / cannon 炮 / shield 盾 / staff 杖 / chain 链 / case 箱
  "moves": ["horizontalSlash", "verticalSlash"],   // ★ 绑定的动作（lp/moves.js 的 ATTACKS 的 key）
  "grip": [0, 0, 0],          // 握把在武器坐标系里的位置
  "hold": { "rot": [0,0,0], "scale": 1 },           // 挂到手上时的初始朝向 / 缩放

  "spec": { "schema": "lowpoly-workshop/weapon@1", "parts": [
    { "id": "weapon", "name": "武器本体", "category": "武器", "parent": null,
      "primitives": [ /* 和人物同一套四种图元：box / panel / op / geo */ ] }
  ] }
}
```

**四种图元**（和人物一致，写法见 [`editor-api.md`](editor-api.md) §图元）：

```jsonc
{ "kind":"box",   "x":0,"y":0.35,"z":0,"w":0.06,"h":0.7,"d":0.02, "color":11960779, "rotX":0,"rotY":0,"rotZ":0 }
{ "kind":"panel", "points":[[-0.1,0],[0.1,0],[0.06,0.5],[-0.06,0.5]], "depth":0.04, "z":0, "color":… }
{ "kind":"geo",   "shape":"cylinder", "rTop":0.05,"rBot":0.05,"h":0.4,"seg":8, "x":0,"y":0.2,"z":0, "color":… }
```

---

## 3. REST API（`tools/_serve.js`）

和 `/api/models` **一一对称**（同一批读写函数，只是目录 / 文件名不同）：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/weapons` | 列表（`{confirmed:[], temporary:[]}`） |
| GET | `/api/original-weapons` | 共享武器库（`OriginalWeaponList/`，= 共享池本体） |
| GET | `/api/weapons/:id` | 取完整武器（含 `spec` + `js`） |
| GET | `/api/weapons/:id/bundle` | ★ 一次拿全：meta + spec + js + 文件清单 + 直链 |
| GET | `/api/weapons/:id/files` | 目录里的文件清单 |
| GET | `/api/weapons/:id/file/:name` | ★ 取原始文件（`?download=1` 带 attachment） |
| POST | `/api/weapons` | 存 `{id,name,spec,js,thumb,note,mount,kind,moves,grip,hold,dir}` |
| POST | `/api/weapons/:id/confirm` | 临时 → 正式 |
| POST | `/api/weapons/:id/unconfirm` | 正式 → 临时 |
| DELETE | `/api/weapons/:id` | 删除 |

> ★ **列表接口的每一项都带 `runtime`（布尔）+ `runtimeId`（真正的运行时武器 id，如 `blackBlade`）**。
> 编辑器要用 **`runtimeId`** 去 `LP.WEAPONS[...]` 取几何 —— 只拿 `runtime` 布尔会取不到（曾经的「**武器无法显示**」就是把它当 id 用了）。

浏览器侧（`src/characters.store.js`）：

```js
Store.listWeapons() / getWeapon(id) / saveWeapon(o) / confirmWeapon(id)
Store.unconfirmWeapon(id) / removeWeapon(id)
Store.getWeaponBundle(id) / getWeaponFiles(id) / weaponFileURL(id,name,dl) / readWeaponFile(id,name)
```

---

## 4. 给 AI Agent（`window.WeaponAPI`）

武器编辑器暴露了一个 `EditorAPI` 式的入口（**规则见 §6**）：

```js
WeaponAPI.state()                       // { current, draft, list }
WeaponAPI.kinds() / moves()             // 种类表 / 动作库
WeaponAPI.setMeta({ name, mount, kind })// 名称 · 挂载数 · 种类
WeaponAPI.setPrimitives([…]) / addPrimitive({…})
WeaponAPI.select(i) / removePrimitive(i) / duplicatePrimitive(i)   // 视口点选 / 增删图元
WeaponAPI.mode('translate|rotate|scale') / frame()                // gizmo 模式 / 居中视图
WeaponAPI.captureOriginal(id)           // ★ 把共享武器「拆解」成图元数组（黑刃 14 / 巨炮 33 / 葱 4）
WeaponAPI.setMoves(['horizontalSlash']) // 手调动作
WeaponAPI.templateFor(kind)             // ★ 同类型武器的默认动作模板（返回 key 数组）
WeaponAPI.applyKindTemplate(kind?)      // ★ 套用同类型模板
WeaponAPI.features('剪影/部件/配色')      // 记录特征清单
WeaponAPI.save({ confirmed:true })      // 存 → 返回 id
WeaponAPI.load(id) / confirm(id) / remove(id)
WeaponAPI.list() / listOriginal() / get(id)
WeaponAPI.snapshot() / render() / setView(x,y,z)
// ★ 建模流水线 + 系统提示词
WeaponAPI.pipeline() / mark(id,{evidence}) / reset()
WeaponAPI.systemPrompt()                // 给 AI 的武器系统提示词（最新版）
```

**纯 HTTP 的 Agent** 也能干（不用浏览器）：直接 `POST /api/weapons`，见上表。

---

## 5. 和人物的关系

- 人物模型在 [`NewlyAddedModelList/`](../NewlyAddedModelList/)（`model.json` / `model.js`）。
- 武器**不烘进人物模型**：它是独立文件，载入游戏时由**武器池绑定**（`lowpoly/rig.js` 的 `mountWeapons`）挂到手上。
  —— 黑岩的黑刃 / 黑岩巨炮来自 `CHARACTERS.brs.defaultLoadout()`，初音的葱是烘在模型里的特例。
- 挂载数决定占几个手位（上限 2）；种类决定用哪套标准招（见 [`lowpoly-runtime.md`](lowpoly-runtime.md) §6.1）。

---

## 6. ★ 武器建模流水线（AI 生成武器）

武器比人物**轻**：**没有体态要求**（不受头身比 / 四肢 / 站姿影响），所以**没有** silhouette / 接缝 / 净空那套门 ——
只有「别漏步」。和人物一样走「**特征驱动 + 程序化图元**」。

```
① features   收集特征       —— AI 自己上网查这把武器的公开资料（剪影 / 部件构成 / 配色 / 材质感）；
                              有参考图只**取图上的特征**，绝不逐像素对剪影
② meta       定名称/挂载/种类 —— mount 1|2；kind 刀/锤/枪/炮/盾/杖/链/箱
③ moves      套动作模板     —— **复用同类型武器**的那套招（KIND_MOVES，见 lowpoly/weapons.js），之后可手调
④ primitives 图元建本体     —— box / panel / geo（cylinder·sphere·cone·torus）；握把 = 原点
⑤ preview    预览剪影       —— render() / snapshot() 转一圈看
⑥ save       存库           —— 临时（待确认）/ 正式（也进共享池）
```

命令：`WeaponAPI.pipeline()` → 执行 `nextCommand` → `WeaponAPI.mark(id,{evidence})` → 下一步。
`WeaponAPI.systemPrompt()` 一键拿系统提示词；面板「复制系统提示词」按钮同源。

**打开即用**：武器编辑器**启动时默认载入「葱」**（共享武器库里的 `leek`）并**拆解成可编辑图元**
（4 个：1 圆柱 + 3 片），不用从空白方块起手；服务没起来时退回默认方块。

**★ 视口编辑（像部件编辑器）**：武器**悬空**显示（无地面、自动取景）；
点选图元 → gizmo **拖动 / 旋转 / 缩放**（<kbd>W</kbd>/<kbd>E</kbd>/<kbd>R</kbd>），<kbd>Delete</kbd> 删除，<kbd>Esc</kbd> 取消；
右侧「武器本体 · 图元 / 代码」能**新增 / 复制 / 删除 / 上移下移 / 直接编辑模型代码**（图元 JSON）。
点「共享武器库」里的武器 = **拆解成可编辑图元** —— `captureOriginal(id)` 把运行时几何
（`Builder.box/shape/add`）还原成 `box / panel / geo`，实测黑刃 14 / 黑岩巨炮 33 / 葱 4 个图元，**包围盒与原武器完全一致**。

**动作模板表**（`lowpoly/weapons.js` 的 `KIND_MOVES`）：

| 种类 | 默认动作 |
|---|---|
| `blade` 刀 | 横斩 / 竖斩 |
| `hammer` 锤 | 上劈 |
| `gun` 枪 / `cannon` 炮 | 连射 |
| `shield` 盾 | 盾击 |
| `staff` 杖 | 横扫 |
| `chain` 链 | 链锤回旋 |
| `case` 箱 | 提箱挥击 |

> 与人物流水线的差别：人物要 **体态（抄原版模型）+ 8 个质量门**；武器只关心**剪影 / 部件 / 配色 / 材质**，无门。
> 人物那份在 [`ai-pipeline.md`](ai-pipeline.md) §十一。
