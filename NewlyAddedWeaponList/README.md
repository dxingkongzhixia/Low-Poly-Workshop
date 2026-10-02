# NewlyAddedWeaponList —— 确认的新增武器（正式）

这里是**已经确认**的用户/AI 新增**武器**。武器编辑器（`pages/weapon-editor.html`）会读这里。

> ⚠ **武器是独立路线**：它**不**跟人物建模走（没有骨架、没有 body/head/arms）。
> 武器在自己的坐标系里建模（握把在原点），由角色**武器池绑定**时才挂到手上。
> 人物在 `NewlyAddedModelList/`，两边**故意分开**。

## 每把武器一个子目录

```
<id>/
  weapon.json   规格（本体图元 + 挂载数 + 种类 + 绑定的动作）+ 元数据（name/note/时间戳）
  weapon.js     可选的工厂函数（运行时/实验室靠它构建）
  thumb.png     缩略图
```

`weapon.json` 长这样：

```jsonc
{
  "schema": "lowpoly-workshop/weapon@1",
  "id": "myBlade",
  "name": "测试长刀",
  "category": "新增武器",
  "source": "weapon-editor:exportJS",
  "note": "",
  "createdAt": 0,
  "updatedAt": 0,
  "stats": { "parts": 1, "primitives": 6, "triangles": 320, "mode": "weapon" },

  "mount": 1,                 // 挂载数：1 = 单手，2 = 双手
  "kind": "blade",            // 种类：blade 刀 / hammer 锤 / gun 枪 / cannon 炮 / shield 盾 / staff 杖 / chain 链 / case 箱
  "moves": ["horizontalSlash", "verticalSlash"],   // ★ 绑定的动作（来自 lp/moves.js 的 ATTACKS）
  "grip": [0, 0, 0],          // 握把在武器坐标系里的位置
  "hold": { "rot": [0,0,0], "scale": 1 },           // 挂到手上时的初始朝向 / 缩放

  "spec": { /* 武器本体的图元列表：parts[].primitives[]，和人物同一套四种图元 */ }
}
```

## 怎么往里放

**武器编辑器 →「保存 · 新增武器」**：存为新增武器 → 先进 `NewlyAddedWeaponTemporaryList`（临时）→「确认」→ 移到这里。
或者用 API：

```js
await WeaponAPI.saveWeapon({ name:'测试长刀', confirmed:true });
await WeaponAPI.confirmWeapon(id);
```

## 别做的事

- ❌ 把人物模型塞进来（那是 `NewlyAddedModelList/`）
- ❌ 把这里当草稿区（草稿放 `NewlyAddedWeaponTemporaryList/`）
- ❌ 手工编辑 `weapon.json`（用武器编辑器改完再存）

细节见 [`../docs/weapon-files.md`](../docs/weapon-files.md)。
