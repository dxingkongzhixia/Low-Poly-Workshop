# NewlyAddedWeaponTemporaryList —— 待确认的新增武器

武器编辑器 / AI 存进来的**草稿**放这里。确认后才移到 [`../NewlyAddedWeaponList/`](../NewlyAddedWeaponList/)。

```
<id>/
  weapon.json   规格 + 元数据
  weapon.js     可选工厂
  thumb.png     缩略图
```

- **确认** → `WeaponAPI.confirmWeapon(id)`（或武器编辑器里的「确认」按钮）
- **删除** → `WeaponAPI.removeWeapon(id)`
- 正式区在 `../NewlyAddedWeaponList/`，别把正式数据写进这里。

结构说明见 [`../NewlyAddedWeaponList/README.md`](../NewlyAddedWeaponList/README.md)。
