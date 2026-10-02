# OriginalWeaponList —— 共享武器库（= **共享池**本体）

> ★ 显示名已从「原版武器库」改成「**共享武器库**」；目录名沿用 `OriginalWeaponList`（服务端 / API 未改）。

这里是**原版武器**（游戏里就有的 + 我们自己一直用的那几把）：黑刃、黑岩巨炮、葱……

> ★ **武器库的武器 = 共享池**：任何角色都能装（和「角色武器池」——角色自带、模型里分割出来的那把——相对）。
> 新增武器在 [`../NewlyAddedWeaponList/`](../NewlyAddedWeaponList/)；两者都在武器编辑器里显示，
> **原版在「新增武器」上面**。

## 每把武器一个子目录

```
<id>/
  weapon.json   规格：runtime(= 运行时武器 id) / mount / kind / moves / grip / hold（+ 可选 spec）
  weapon.js     可选工厂
  thumb.png     缩略图
```

```jsonc
{
  "schema": "lowpoly-workshop/weapon@1",
  "id": "blackBlade",
  "name": "黑刃",
  "category": "原版武器",
  "runtime": "blackBlade",     // ★ 指向运行时 lp/weapons.js 的 WEAPONS 定义（几何以代码为准）
  "mount": 1,                  // 单手 / 双手
  "kind": "blade",             // 刀 锤 枪 炮 盾 杖 链 箱
  "moves": ["horizontalSlash", "verticalSlash"],
  "grip": [0, -0.48, 0.04],
  "hold": { "rot": [-0.60, 0, 0.44], "scale": 1.28 }
}
```

- `runtime` 有值：几何由 `src/lowpoly/weapons.js` 的 `WEAPONS[<runtime>]` 提供（**代码即真源**），
  这里只存**元数据**（名称 / 挂载数 / 种类 / 绑定的动作 / 握把）。
- 要纯数据版（`spec` 图元），把 geometry 写进 `spec` 即可（和新增武器同格式）。

只读为主：武器编辑器里「共享武器库」可以**预览 / 看动作**，要改就在 `lp/weapons.js` 改代码。

细节见 [`../docs/weapon-files.md`](../docs/weapon-files.md)。
