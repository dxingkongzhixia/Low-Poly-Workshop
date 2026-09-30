# refs/inbox —— 参照图收件箱

**把参照图（PNG）直接存/拖到这个文件夹里，然后告诉 AI 文件名就行。**

## 为什么要这样（踩过）

直接**从聊天窗口/截图工具拖图**进对话框，经常报：

> 发送提示失败
> The requested file could not be read, typically due to permission problems
> that have occurred after a reference to a file was acquired.

原因：那些程序给出的**不是磁盘上的真文件**，而是一个**临时文件路径**，
松手后临时文件就被它自己删了 → 客户端拿着刚拿到的路径去读，文件已经没了。

## 正确姿势

1. 在能看图的程序里**另存为** → 存到 `D:\ROTK\three.js\refs\inbox\`
   （或者直接从文件管理器把图片拖进来）
2. 文件名建议用英文/拼音，例如 `boot-zoom.png`
3. 告诉 AI：「参照图放好了，叫 boot-zoom.png」

AI 会用服务端接口把它收进参照图服务（不用走聊天附件）：

```bash
# AI 侧执行
curl -X POST http://localhost:8765/api/ref -H "Content-Type: application/json" \
     -d "{\"name\":\"boot-zoom\",\"path\":\"refs/inbox/boot-zoom.png\"}"
# → 返回 analysis（尺寸/背景/视野切分/主色板）
# 之后就能量了：
curl "http://localhost:8765/api/ref/boot-zoom/profile?x=0&y=0&w=1&h=1&cols=80&rows=44"

# 看收件箱里有什么（不用猜文件名）
curl http://localhost:8765/api/ref/inbox
```

## 支持什么格式

**PNG 必须**（8bit 非隔行）。服务端是纯 Node 自己解 PNG 的（零依赖）。
`.jpg / .webp` 现在解不了 —— 请先转成 PNG 再放进来。