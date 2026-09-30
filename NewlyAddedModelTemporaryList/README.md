# NewlyAddedModelTemporaryList —— 新增模型的临时区

**存下来了但还没确认**的新增模型放这里。

在**部件编辑器 →「保存 · 新增模型」**里点「存为新增模型」会落到这个目录。
看过了、觉得可以了，点「确认」它会**整个目录移到** `NewlyAddedModelList/`；
点「删」就删掉。

```js
await EditorAPI.saveModel({ name:'我的角色' });   // → 这里（temporary）
await EditorAPI.confirmModel('我的角色');          // → 移到 NewlyAddedModelList/
await EditorAPI.removeStoredModel('我的角色');     // → 删掉
```

## 和 TemporaryCache 的区别

| | 本目录 | `TemporaryCache/` |
|---|---|---|
| 会不会被「清除缓存」清掉 | **不会** | **会**（随时可清） |
| 装什么 | 完整的模型（spec + js + 缩略图） | AI 测试产物、门报告、截图 |
| 会被实验室展示吗 | 会（在「新增模型」区，标注「待确认」） | 不会 |

> ⚠ 别把正式的模型直接丢进 `TemporaryCache/` —— 那里随时会被清空。

细节见 [`../docs/storage.md`](../docs/storage.md)。
