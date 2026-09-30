# 存储与目录 —— 保存 · 确认 · 缓存

> 三个目录分工不同，**别混用**。配套 REST API 在 `tools/_serve.js`，浏览器侧封装在 `src/characters.store.js`。

---

## 1. 三个目录

| 目录 | 装什么 | 谁写 | 会不会被清 |
|---|---|---|---|
| `NewlyAddedModelList/` | **确认的新增模型**（正式产物） | 编辑器 / AI Agent | 不会（只能手动删） |
| `NewlyAddedModelTemporaryList/` | **待确认的新增模型** | 编辑器 / AI Agent | 不会（确认后自动移走） |
| `TemporaryCache/` | AI 测试产物、门报告、截图、`agent.json` | 编辑器 / AI Agent | **主界面「清除缓存」会清空**（`agent.json` 除外） |

> ⚠ **不要把正式数据放进 `TemporaryCache/`** —— 它随时会被清掉。
> ⚠ 新增模型**不会**出现在角色实验室的「干员」列表里（那是原作 14 人）。
>   它们在独立的「**新增模型**」分区，避免数据污染。

### 每个模型的磁盘结构

```
NewlyAddedModelList/<id>/
  model.json    规格 + 元数据（name / note / stats / 时间戳）
  model.js      编辑器导出的工厂函数（角色实验室靠它来构建）
  thumb.png     缩略图（保存时自动截，可选）
```

`model.json` 长这样：

```jsonc
{
  "schema": "lowpoly-workshop/model@1",
  "id": "myguy",
  "name": "通用体型",
  "category": "新增模型",
  "source": "editor:exportJS",
  "note": "",
  "createdAt": 1790674000000,
  "updatedAt": 1790674000000,
  "stats": { "parts": 10, "primitives": 52, "triangles": 3732, "mode": "parts" },
  "spec": { /* 完整的编辑器规格：palette / rig / parts[...] */ }
}
```

---

## 2. 保存流程（编辑器 / Agent）

```js
// ① 存（默认进**临时区**）
const r = await EditorAPI.saveModel({ name:'通用体型', note:'按实测拉普兰德比例' });
// r.where === 'temporary'  →  NewlyAddedModelTemporaryList/myguy/

// ② 确认（移进正式区）
await EditorAPI.confirmModel('myguy');
// → NewlyAddedModelList/myguy/

// 想一步到位：
await EditorAPI.saveModel({ name:'通用体型', confirmed:true });

// 撤回确认：
await EditorAPI.unconfirmModel('myguy');

// 删除：
await EditorAPI.removeStoredModel('myguy');
```

**可选参数**：`{ id, name, category, note, confirmed, withJs, withThumb }`
- `withJs:true`（默认）→ 同时写 `model.js`。**关掉它实验室就载不进来**（只能看 spec）。
- `withThumb:true`（默认）→ 截当前视口存 `thumb.png`（约 80ms）。

**尺寸**：`spec` 会完整写进 `model.json`，所以文件大小 ≈ 规格大小（手搓角色几十 KB）。

---

## 3. 临时缓存（AI 测试产物都丢这里）

```js
// 存任意数据（对象会自动 JSON 序列化）
await EditorAPI.cachePut({ name:'gate-blockout', data:{ summary, report } });
await EditorAPI.cachePut({ name:'try-3', data:{...}, thumb:'data:image/png;base64,…' });

// 跑门 + 存报告 + 存截图，一步到位（AI 每遍调一次最省事）
await EditorAPI.gateAndCache({ passId:'hair' });

// 列出 / 清空
await EditorAPI.cacheList();
await EditorAPI.cacheClear();        // 主界面「系统状态 → 清除缓存」也是这个
```

清缓存时**保留** `agent.json`。

---

## 4. REST API（`tools/_serve.js`）

页面和 Agent 都走同源 `fetch`，不用额外配置。

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/index` | ★ **AI 入口总览**：一次列出文档 / 数据 / 角色 / 全部端点 |
| GET | `/api/characters` | ★ 原作角色索引（低模 14 + 高模变体） |
| POST | `/api/characters` | 浏览器把权威角色清单写回 `data/characters.json` |
| GET | `/api/store` | 总览：两个模型目录 + 缓存 + agent |
| GET | `/api/models` | 列表（`{confirmed:[], temporary:[]}`） |
| GET | `/api/models/:id` | 取完整模型（含 `spec` 和 `js`） |
| GET | `/api/models/:id/bundle` | ★ **一次拿全**：`meta` + `spec` + `js` + 文件清单 + 直链 |
| GET | `/api/models/:id/files` | 模型目录里的文件清单 |
| GET | `/api/models/:id/file/:name` | ★ 取原始文件（`?download=1` 带 attachment） |
| POST | `/api/models` | 保存 `{id,name,spec,js,thumb,note,dir}`，`dir:'confirmed'` 直接进正式区 |
| POST | `/api/models/:id/confirm` | 临时 → 正式 |
| POST | `/api/models/:id/unconfirm` | 正式 → 临时 |
| DELETE | `/api/models/:id` | 删除（两处都找） |
| GET | `/api/cache` | 缓存文件列表 |
| POST | `/api/cache` | 写缓存 `{name,data,ext,thumb}` |
| DELETE | `/api/cache` | 清空缓存（保留 `agent.json`） |
| GET | `/api/agent` | 当前接管者 |
| POST | `/api/agent` | 登记接管 `{agent,note}`；`{agent:null}` 交还 |
| POST | `/api/agent/ping` | 续约 |

> 「模型文件」的完整拿法（含 AI 视角的示例）见 [`model-files.md`](model-files.md)。

浏览器侧封装（推荐用这个，别手写 fetch）：

```js
import { Store } from './characters.store.js';
Store.listModels() / getModel(id) / saveModel(o) / confirm(id) / removeModel(id)
Store.cacheList() / cachePut(o) / cacheClear() / cacheGate(label, report, shot)
Store.getAgent() / setAgent(o) / gpu()
// ★ 模型文件
Store.index() / characters() / publishCharacters(o)
Store.getModelBundle(id) / getModelFiles(id) / modelFileURL(id,name,dl) / readModelFile(id,name)
```

---

## 5. 注意

- **缩略图不写进 `model.json`**，而是落盘成 `thumb.png`，接口只回 URL。
  （早期版本把 dataURL 写进 JSON，会让文件爆到几 MB。）
- **请求体必须被读干**：`tools/_serve.js` 对所有 POST/DELETE 无条件读 body，
  否则残留数据会污染 keep-alive 连接，表现为随机 `HTTP 502`。
- 模型 id 会被清洗成 `[A-Za-z0-9_中文.\-]`，最长 64 字符。
- 目录不存在时服务器会自动创建，所以删掉这三个目录不会让服务起不来。
