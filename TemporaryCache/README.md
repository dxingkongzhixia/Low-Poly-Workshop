# TemporaryCache —— 临时缓存（AI 测试产物都丢这里）

**这里的东西随时会被清掉。** 主界面「系统状态 → 清除缓存」、编辑器的「清空缓存」、
或者 `DELETE /api/cache` 都会清空本目录（保留 `README.md` 和 `agent.json`）。

## 装什么

- AI 跑流水线时每一遍的**质量门报告**（`gate-<遍>-<时间>.json`）
- 对应的**截图**（同名 `.png`）
- 任何调试用的中间数据
- `agent.json` —— 当前接管生成流程的 AI Agent（**清缓存不会清它**）

## 怎么用

```js
// 跑门 + 存报告 + 存截图，一步到位（AI 每遍调一次最省事）
await EditorAPI.gateAndCache({ passId:'hair' });

// 或者自己丢
await EditorAPI.cachePut({ name:'try-3', data:{ ... } });
await EditorAPI.cacheList();
await EditorAPI.cacheClear();
```

## 别做的事

- ❌ **不要把正式模型放这里** —— 会被清掉。正式模型放 `NewlyAddedModelList/`，
  待确认的放 `NewlyAddedModelTemporaryList/`。
- ❌ 不要依赖这里的文件长期存在（比如在文档里引用它）。

细节见 [`../docs/storage.md`](../docs/storage.md)。
