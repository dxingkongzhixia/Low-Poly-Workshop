# NewlyAddedModelList —— 确认的新增模型（正式）

这里是**已经确认**的用户/AI 新增模型。角色实验室「新增模型」分区会读这里。

> ⚠ 这一区 **不是** 原作 14 个角色。原作角色在 `characters.orig.js` / `characters.hires2.js` 里，
> 两边**故意分开**，避免数据污染。

## 每个模型一个子目录

```
<id>/
  model.json   规格（spec）+ 元数据（name/note/stats/时间戳）
  model.js     编辑器导出的工厂函数（角色实验室靠它构建）
  thumb.png    缩略图
```

## 怎么往里放

在**部件编辑器 →「保存 · 新增模型」**里：
- 「存为新增模型」→ 先进 `NewlyAddedModelTemporaryList`（临时）
- 「确认」→ 移到这里（正式）
- 「存并直接确认」→ 一步到位

或者用 API：

```js
await EditorAPI.saveModel({ name:'通用体型', confirmed:true });
await EditorAPI.confirmModel(id);
```

## 别做的事

- ❌ 手工编辑 `model.json`（用编辑器改完再存一次）
- ❌ 把 `TemporaryCache/` 里的东西搬进来当正式数据
- ❌ 把这里当草稿区（草稿放 `NewlyAddedModelTemporaryList/`）

细节见 [`../docs/storage.md`](../docs/storage.md)。
