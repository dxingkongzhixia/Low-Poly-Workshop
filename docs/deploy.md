# 部署到服务器（Linux / 宝塔面板 / Docker）

> 低模工坊 = **一个静态站 + 一个零依赖的 Node 服务**。没有 npm、没有构建步骤，
> 服务端只用 `http` / `fs` / `path`，代码里**没有 Windows 专属逻辑**，`root` 是按自身位置定位的
> （`path.resolve(__dirname, '..')`），所以从哪启动都对。
> 前端 three.js 已**本地化**在 `vendor/three/`，**不依赖任何 CDN**。

---

## 0. 三十秒版

```bash
# 在服务器上（仓库根目录）
AUTH_USER=admin AUTH_PASS='换成一个强密码' HOST=127.0.0.1 ./start.sh
# 再用 nginx / 宝塔反代  http://127.0.0.1:8765  →  你的域名（记得 client_max_body_size）
```

---

## 1. 环境变量（全部可选；模板见仓库根 [`.env.example`](../.env.example)）

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8765` | 监听端口 |
| `HOST` | `127.0.0.1` | **默认只绑本机**（给反代用）。要直连 / 局域网 / 容器映射，设 `0.0.0.0` |
| `AUTH_USER` | 空 | **整站 Basic Auth**（给「人 / 浏览器」）。设了就网页 + `/api/*` 都要账号密码 |
| `AUTH_PASS` | 空 | 同上（**必须两个都设才生效**） |
| `API_READ_TOKEN` | 空 | `/api/*` 的**只读** token（给「只看模型」的 AI / 脚本） |
| `API_WRITE_TOKEN` | 空 | `/api/*` 的**读写** token（存 / 确认 / 删） |

> `.env` **不会自动加载**（零依赖，没有 dotenv）：
> - **docker compose** 会自动读同目录 `.env` ✓
> - shell：`set -a; . ./.env; set +a; ./start.sh`
> - PM2：先 `export`，再 `pm2 start ecosystem.config.js --update-env`

### 1b. 两种钥匙，各管一段

```
① AUTH_USER / AUTH_PASS  →  整站（静态页 + /api/* ），HTTP Basic Auth      ← 人 / 浏览器
② API_READ_TOKEN         →  只管 /api/*，只放 GET / HEAD                   ← 只想看模型的 AI
   API_WRITE_TOKEN       →  只管 /api/*，全放（也含读）                      ← 要存/删的 AI
```

- token 三种传法（任选）：`Authorization: Bearer <t>` · `X-API-Token: <t>` · GET 时 `?token=<t>`
- **只发只读 token 给 Agent 最安全** —— 它拿不走也改不了模型，只能读。
- 没配任何 token 时，`/api/*` **跟随 Basic Auth**（即：开了 Basic 就要 Basic，没开就敞开）。

```bash
# 只读：查列表 / 拿模型
curl -H "Authorization: Bearer $API_READ_TOKEN"  http://127.0.0.1:8765/api/models
curl -H "X-API-Token: $API_READ_TOKEN"           "http://127.0.0.1:8765/api/models"      # 等价
curl "http://127.0.0.1:8765/api/characters?token=$API_READ_TOKEN"                        # GET 还能用 ?token=

# 读写：存模型（用只读 token 会被 401）
curl -H "X-API-Token: $API_WRITE_TOKEN" -H "Content-Type: application/json" \
     -d @model.json http://127.0.0.1:8765/api/models
```

> ⚠ **配了 token 就务必同时开 Basic Auth**：否则浏览器（它没有 token）会调不动 `/api/*`，网页就废了。
> 服务启动时若发现「只开了 token、没开 Basic」，会打印这条警告。

> ⚠ **服务默认无鉴权、CORS 全开、`/api/*` 可读可写。**
> 对外部署**务必**开 Basic Auth（+ 给 Agent 只读 token），或者只让反代 / 内网访问。

---

## 2. 方式 A：宝塔面板（推荐）

**① 装 Node**：软件商店 → **Node.js 版本管理器**（或 **PM2 管理器**）→ 装 **18 / 20 LTS**。

**② 传代码**
```bash
cd /www/wwwroot
git clone https://github.com/dxingkongzhixia/Low-Poly-Workshop.git lowpoly
# 或者宝塔「文件」上传 zip 解压
```
> 没有 `package.json`，**不用 npm install**。

**③ 写权限**（服务要写模型 / 缓存 / `data/characters.json`）
```bash
chown -R www:www /www/wwwroot/lowpoly
```

**④ 起进程**（三选一）
- **宝塔「Node 项目」**：目录=`/www/wwwroot/lowpoly`，启动文件=`tools/_serve.js`，
  环境变量加 `HOST=127.0.0.1`、`AUTH_USER`、`AUTH_PASS`，端口 `8765` → 启动 + 开机自启。
- **宝塔 PM2 管理器**：脚本 `tools/_serve.js`、运行目录=仓库根、名称 `lowpoly-workshop`。
  也可以直接 `pm2 start ecosystem.config.js && pm2 save`（配置就在仓库里）。
- **systemd**：见 §4。

**⑤ 反向代理**：宝塔「网站」→ 添加站点 → 设置 → **反向代理** → 目标 `http://127.0.0.1:8765`。
**关键是加一句** `client_max_body_size`（宝塔 nginx 默认 1m，存带缩略图的模型会 **413**）：
```nginx
location / {
    proxy_pass http://127.0.0.1:8765;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    client_max_body_size 64m;      # ★ 必须
}
```

**⑥ 放行端口**：反代方案放行 **80 / 443** 即可（8765 不用对外）。
**⑦ HTTPS**：站点 → SSL → Let's Encrypt 一键。

---

## 3. 方式 B：Docker Compose

仓库里带 `Dockerfile` + `docker-compose.yml`（镜像基于 `node:20-alpine`，无需构建依赖）。

```bash
AUTH_USER=admin AUTH_PASS='强密码' docker compose up -d --build
docker compose logs -f
```
- compose 把端口映射成 `127.0.0.1:8765`（只给反代用）；要直连改成 `"8765:8765"` 并把 `HOST` 留给镜像默认的 `0.0.0.0`。
- 模型 / 缓存 / 武器 / `data` 都**挂出来了**，容器重建不丢。
- 宝塔里也能跑 docker（软件商店装 Docker 管理器）。

---

## 4. 方式 C：systemd（不用面板）

```ini
# /etc/systemd/system/lowpoly.service
[Unit]
Description=Low-Poly Workshop
After=network.target

[Service]
WorkingDirectory=/www/wwwroot/lowpoly
ExecStart=/usr/bin/node tools/_serve.js
Environment=PORT=8765
Environment=HOST=127.0.0.1
Environment=AUTH_USER=admin
Environment=AUTH_PASS=换成强密码
Restart=always
User=www

[Install]
WantedBy=multi-user.target
```
```bash
systemctl daemon-reload && systemctl enable --now lowpoly
systemctl status lowpoly
journalctl -u lowpoly -f
```

---

## 5. 校验

```bash
curl -I  http://127.0.0.1:8765/                      # 200
curl -sI http://127.0.0.1:8765/api/models            # 200（没开鉴权） / 401（开了）
curl -u admin:密码 http://127.0.0.1:8765/api/models   # 开了鉴权时
curl -s  http://127.0.0.1:8765/api/characters | head
```

浏览器打开域名 → 应该能看到首页四个工具。**页面里的 three.js 现在从 `/vendor/three/` 加载，断网也能开。**

---

## 6. 安全清单（对外部署照着勾）

- [ ] 设了 `AUTH_USER` / `AUTH_PASS`（或只在内网 / 反代 Basic Auth 后面）
- [ ] 给 AI Agent 只发 **`API_READ_TOKEN`（只读）**；确实要写才给 `API_WRITE_TOKEN`
- [ ] ⚠ 配了 token 就**同时开 Basic Auth**（否则网页 UI 调不动 `/api/*`）
- [ ] `HOST=127.0.0.1`（只给反代），8765 不对公网开放
- [ ] 反代加了 `client_max_body_size 64m`
- [ ] HTTPS 打开
- [ ] 项目目录属主是可写用户（`chown -R www:www`）
- [ ] 静态目录包含源码（`tools/_serve.js` 等），别把不该公开的东西放进来

---

## 7. 升级 / 备份

```bash
# 升级
cd /www/wwwroot/lowpoly && git pull
# 若用 PM2 / 宝塔 Node 项目：重启进程即可（自启的不用管 chown，重跑一次更稳）
chown -R www:www .
pm2 restart lowpoly-workshop      # 或宝塔里点「重启」

# 备份（要备份的就是「产物」）
tar czf lowpoly-data-$(date +%F).tgz \
  NewlyAddedModelList NewlyAddedModelTemporaryList \
  NewlyAddedWeaponList NewlyAddedWeaponTemporaryList \
  OriginalWeaponList data
```
> `TemporaryCache/` 是随时可清的缓存，不用备份。

---

## 8. 排错

| 症状 | 原因 / 处理 |
|---|---|
| `Connection reset` / 打不开 | `HOST` 绑的是 `127.0.0.1`，只能本机 / 反代访问；直连要 `HOST=0.0.0.0` 且放行端口 |
| 存模型报 **413** | 反代没加 `client_max_body_size 64m` |
| 存模型报 **500 / EACCES** | 项目目录不可写 → `chown -R www:www .` |
| 页面白屏、控制台报找不到模块 | 看 `vendor/three/` 在不在（应该随仓库一起提交）；自检 `node tools/selfcheck.js` |
| 401 一直弹（浏览器） | 设了 `AUTH_USER/AUTH_PASS`；输账号密码，或清掉这两个变量 |
| `/api/*` 返回 401 但页面能开 | 配了 API token：`Authorization: Bearer <t>` / `X-API-Token` / `?token=`；**只读 token 不能 POST** |
| 页面能打开但「存模型 / 列表」报错 | 只开了 token、没开 Basic Auth → 浏览器没有 token。**同时开 Basic Auth**，或去掉 token |
| Agent（AI）连不上 `/api/*` | 开了 Basic Auth 时，Agent 请求要带 `Authorization` |
