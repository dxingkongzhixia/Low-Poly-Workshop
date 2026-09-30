# 模型文件 —— AI Agent 怎么直接拿到

> **一句话**：磁盘上的模型用 `GET /api/models/:id/bundle` 一次拿全；
> **还没保存**的当前状态在页面里调 `EditorAPI.modelFile()`（同一个形状）。
>
> 配套：[`storage.md`](storage.md)（三个目录）、[`editor-api.md`](editor-api.md)（浏览器侧命令）、
> [`ai-workflow.md`](ai-workflow.md)（接管流程）。

---

## 1. 先想清楚：这里的「模型」有三种

这套项目里没有单一的「模型文件」——**三种模型的拿法完全不同**，先对号入座：

| 种类 | 是什么 | 长什么样 | 怎么拿 |
|---|---|---|---|
| **原作低模**（14 人） | `XT(id)` **程序化生成**的几何，磁盘上没有网格文件 | 就一段源码 + 实测比例数据 | 拿源码 `/characters.orig.js` + `/data/characters.json`（含 rig/palette） |
| **原作高模**（3 人 6 变体） | 烘焙好的 `Object3D.toJSON()` | 2.6 MB 的 `.json` | `GET /models/lappland-classic.json` |
| **新增模型**（你和 AI 做的） | 编辑器规格 `spec` + 工厂函数 `model.js` | `NewlyAddedModelList/<id>/` 一个目录 | `GET /api/models/:id/bundle` ★ |

---

## 2. ★ 一次拿全：`GET /api/models/:id/bundle`

**这是 AI 最该用的那个接口。** 不用先 list 再猜、不用拼路径、一次拿到全部：

```bash
curl http://localhost:8765/api/models/brm/bundle
```

返回：

```jsonc
{
  "ok": true,
  "id": "brm",
  "where": "confirmed",              // confirmed=正式 / temporary=待确认
  "path": "D:\\ROTK\\three.js\\NewlyAddedModelList\\brm",   // 有文件系统权限就直接读
  "schema": "lowpoly-workshop/model@1",

  "meta":  { "id","name","category","source","note","createdAt","updatedAt","thumb","stats" },
  "spec":  { "parts": [ …16 个部件… ], "palette": {...}, "rig": {...} },   // ★ 编辑器规格
  "stats": { "parts":16, "primitives":…, "triangles":…, "mode":"parts" },

  "js": "/* 完整的 model.js 源码（工厂函数 build_brm） */",   // ★ 可直接跑到实验室里

  "files": [ { "name":"model.js", "bytes":57783, "mtime":…, "url":"/NewlyAddedModelList/brm/model.js" },
             { "name":"model.json","bytes":109564, … } ],
  "urls":  { "model": "/NewlyAddedModelList/brm/model.json",
             "js":    "/NewlyAddedModelList/brm/model.js",
             "thumb": null },

  "howto": "spec 是编辑器规格（可直接喂给 EditorAPI.setSpec/upsertPart）；…"
}
```

**`spec` 和 `js` 的区别**（别搞混）：

| | 干什么用 | 怎么用 |
|---|---|---|
| `spec` | 喂给**部件编辑器**继续改 | `EditorAPI.setSpec(spec)` → 逐部件继续调 |
| `js` | 喂给**角色实验室**构建 | 它是 `build_<id>(THREE, Q, XT, attachFace)` 工厂 |

---

## 3. 单个文件：`GET /api/models/:id/file/:name`

只要某一个文件（想看原始 `model.json` 的完整结构、或者只想拿 `model.js`）：

```bash
curl http://localhost:8765/api/models/brm/file/model.js            # 直接输出源码
curl -OJ http://localhost:8765/api/models/brm/file/model.js?download=1   # 存成文件
```

- `?download=1` → 服务端回 `Content-Disposition: attachment`，浏览器/curl 直接下载
- 文件名会被清洗（`/`、`\` 全部去掉），**不可能穿出模型目录**
- 也可以完全绕过 API，用静态直链：`GET /NewlyAddedModelList/brm/model.js`

清单接口：`GET /api/models/:id/files` → `{ files:[...], urls:{...}, urlBase }`

---

## 4. 还没保存的当前状态：`EditorAPI.modelFile()`

上面两个接口读的都是**磁盘**上的东西。编辑器里改到一半、**还没调 `saveModel()`** 的状态，
磁盘上根本没有 —— 这时在页面里调：

```js
const mf = await EditorAPI.modelFile();
// 形状和 /api/models/:id/bundle 完全一致，只有 where 是 'memory'
mf.where   // 'memory' —— 只在浏览器内存里
mf.spec    // 现场规格
mf.js      // 现场导出的工厂源码
```

**为什么要设计成同一种形状**：AI 不用判断「这个模型是在磁盘还是在内存」，
拿到的对象永远有 `spec` / `js` / `stats` / `meta`。

想让它变成磁盘上的真文件，就下一步：

```js
await EditorAPI.saveModel({ name:'我的模型' });   // → NewlyAddedModelTemporaryList
await EditorAPI.confirmModel('我的模型');        // → NewlyAddedModelList（正式）
```

---

## 5. 原作角色：`GET /api/characters`

AI 先要知道「有哪些角色可以拿来当参照」。一个接口返回全部：

```bash
curl http://localhost:8765/api/characters
```

```jsonc
{
  "ok": true,
  "schema": "lowpoly-workshop/characters@1",
  "source": "data/characters.json（浏览器导出）",
  "low": [
    { "id":"lappland", "label":"拉普兰德",
      "build":"XT(\"lappland\")",                       // 低模是程序化生成的
      "faces":"attachFace(...)  // src/characters.face.js",
      "details":"/data/reference-models.json#models.lappland",
      "rig":{ "headY":1.47, "armX":0.36, "legY":0.73, … },
      "palette":{ "hair":14542308, … },
      "meshCount":24, "groups":["head","body","coatTails",…] },
    … 共 14 人 …
  ],
  "high": [
    { "id":"lappland", "label":"拉普兰德", "variants":["classic","desolate"],
      "build":"buildHires(\"lappland\", \"classic\")",
      "baked": true,
      "files":["/models/lappland-classic.json","/models/lappland-desolate.json"],
      "sharedBaseline":"/models/_shared-baseline.json" },
    { "id":"texas",   "variants":["classic","silent"]  },
    { "id":"exusiai", "variants":["classic","covenant"] },
  ],
  "sources": { "lowPoly":"/characters.orig.js", "face":"/characters.face.js",
               "highPoly":"/characters.hires2.js", "reference":"/data/reference-models.json" }
}
```

> **为什么高模只有 3 个人**：只有 lappland / texas / exusiai 有烘焙高模。
> 而且 **texas 和 exusiai 共用 `_shared-baseline.json`** —— 所以服务端靠扫
> `models/` 目录是猜不全变体的，得靠角色实验室打开时把清单发布回来
> （见下面 §7）。

### 想拿「数值」而不是「名单」

- **比例 / 配色 / 每个网格的包围盒** → `/data/reference-models.json`（80 KB，14 人全在里面）
- **某一个人的 rig 摘要** → `/api/characters` 的 `low[i].rig` / `.palette`（不用下 80 KB）

### 想拿「网格几何」

低模**没有网格文件** —— 它是 `XT(id)` 现场算出来的。能拿到的替代品：

| 想要 | 怎么拿 |
|---|---|
| 精确比例（做新角色参照） | `/data/reference-models.json` |
| 真实三角面 / 顶点 | 只能在浏览器里：`EditorAPI.boxify('lappland')` 拆成可编辑图元，再 `exportSpecJSON()` |
| 一个能直接用 three.js 加载的网格 | 高模有（`/models/*.json` → `ObjectLoader.parse`）；低模没有 |
| GLB | 只能在浏览器里导（编辑器/实验室的「导出 GLB」按钮） |

---

## 6. AI 的最小上手路径

```bash
# ① 这里有什么？（一次看清全部：文档 / 数据 / 角色 / 端点）
curl http://localhost:8765/api/index

# ② 有哪些角色
curl http://localhost:8765/api/characters

# ③ 有哪些已保存的模型
curl http://localhost:8765/api/models

# ④ 拿某个模型的全部（spec + js + 文件）
curl http://localhost:8765/api/models/brm/bundle

# ⑤ 只要源码
curl http://localhost:8765/api/models/brm/file/model.js
```

浏览器里（AI 有页面控制权时）：

```js
await EditorAPI.aiIndex();        // = GET /api/index
await EditorAPI.characters();     // = GET /api/characters
EditorAPI.modelFile();            // 当前没保存的状态
await EditorAPI.saveModel({ name:'…' });   // 存下去
```

---

## 7. 数据是怎么保持最新的

```
角色实验室（pages/character-lab.html）每次打开
   └─ publishCharacters()
        ├─ 低模 14 人 × ROSTER（id + 中文名）
        ├─ 高模变体 × HIRES_VARIANTS（来自 src/characters.hires2.js）
        └─ + /data/reference-models.json 的 rig / palette
   └─ POST /api/characters  →  写 data/characters.json
                                       ↓
                          GET /api/characters 直接读它（最权威）
```

`data/characters.json` 不在时，服务端会退回「扫 `data/reference-models.json` + `models/` 目录」——
**猜得到低模 14 人，但高模只会认出 lappland**（另外两个共用了 baseline）。
所以想要完整索引，**至少打开一次角色实验室**（或者直接调 `EditorAPI.exportCharacterIndex()`）。

> 文件里带了 `generatedAt` / `generatedBy`，可以判断它是不是过期了。

---

## 8. 拿不到的东西（别浪费时间找）

| 拿不到 | 为什么 | 替代 |
|---|---|---|
| 低模的**网格文件** | 它是程序生成的，磁盘上不存在 | `/data/reference-models.json` 的 rig/bbox |
| **没保存**的编辑器状态（走 HTTP） | 只活在浏览器内存里 | 页面里调 `EditorAPI.modelFile()` |
| 实时**渲染截图**（走 HTTP） | 要 WebGL 上下文 | `EditorAPI.render()` / `gateAndCache()` 落盘到 `TemporaryCache/` |
| 用 `POST /api/models/:id/file/:name` **写回单个文件** | 故意没做：会绕过 spec/js 的一致性 | `POST /api/models`（带 `spec` + `js`）整体写 |

---

## 9. 自查

```bash
# 服务在跑吗 + 有哪些端点
curl -s http://localhost:8765/api/index | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.endpoints.map(e=>e[1]).join('\n'))})"

# 某个模型的直链能不能下
curl -sI http://localhost:8765/api/models/brm/file/model.js
```

```js
// 浏览器里：模型文件和磁盘上的是不是一致
const mf = EditorAPI.modelFile();
const onDisk = await Store.getModelBundle(mf.id).catch(()=>null);
console.log('内存部件数', mf.spec.parts.length, '| 磁盘部件数', onDisk && onDisk.spec.parts.length);
```

**常见不工作的情况**

| 现象 | 原因 |
|---|---|
| `/api/models/xxx/bundle` 返回 404 | 模型不在两个目录里；先 `GET /api/models` 看 id 拼写 |
| `urls.model` 打不开 | 目录被改过名 → 直链是按真实目录名拼的（`NewlyAddedModelList`），别用 `confirmed` 去 GET |
| `Store.*` 全报「连不上」 | `tools/_serve.js` 没跑（ES module 也必须要它） |
| `data/characters.json` 里高模少了 texas / exusiai | 打开一次角色实验室，或调 `EditorAPI.exportCharacterIndex()` |
