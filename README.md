# GACHAGO · B 站直播弹幕抽奖

「かんじん GACHAGO!」实习题 T7 的前端实现。项目只使用 HTML / CSS / 原生 JavaScript（ES Modules），没有框架、没有 UI 库、没有构建步骤。

```
登录 → 加房间 → 听弹幕 → 关键词入池 → 抽奖出名单
```

题目原文和接口说明在：

- `docs/api.md`：本地转发服务的路由、Cookie 约定、B 站接口、弹幕包头
- `docs/features.md`：P0 / P1 / P2 功能清单
- `docs/delivery.md`：交付要求

## 运行

### 环境要求

- **Go 1.25 或更高版本**（`server/go.mod` 要求，实测 go1.27.1 可用）
- 浏览器：Chrome / Edge / Firefox
- 不需要 Node.js，前端是静态文件，直接由 Go 服务托管

### 方式一：双击 `start.bat`（Windows 环境）

`start.bat` 会自动：

1. 检查 Go 环境；
2. 在 8787 启动题目原版 `server/`；
3. 等端口起来后自动打开浏览器。

关掉那个黑色窗口就等于停止服务，页面会随之不可用。

端口冲突时脚本会自动换到 8788：

| 8787 上的情况 | 脚本行为 |
| --- | --- |
| 空着 | 正常在 8787 启动并打开页面 |
| 已经是 GACHAGO | 不再启动第二个，直接打开页面 |
| 被别的程序占用 | 自动改用 8788，并给出提示 |

### 方式二：手动启动题目原版 Go 服务

```bash
cd server
go run . -addr 127.0.0.1:8787 -web ../web
```

然后打开 <http://127.0.0.1:8787>。

如果国内网络下载 `github.com/gorilla/websocket` 很慢或失败，先执行一次：

```bash
go env -w GOPROXY=https://goproxy.cn,direct
```

> **不要**直接双击 `web/index.html`，也不要用 Live Server、`python -m http.server` 这类纯静态服务器。
> ES Module 会被 `file://` 拦掉，`/api`、`/live`、`/passport`、`/ws` 也没有转发服务可走。

## 题目要求与完成度

### Level 0：核心链路

| 要求 | 完成情况 |
| --- | --- |
| Layout：抽奖页 + 配置页，能切换 | 完成，顶部 tab 切换两个视图 |
| Request：统一请求管理、Cookie、B 站错误码 | 完成，`web/js/api.js` 的 `request()` |
| Login：拿到昵称和头像 | 完成，支持 Cookie 登录和扫码登录 |
| Room：房间号 / 直播间链接解析 | 完成，支持数字、URL、`/blanc/`、query 参数 |
| Danmaku：连接、解帧、解压、拿到 `DANMU_MSG` | 完成，`web/js/danmaku.js` |
| Pooling：按 uid 去重，实时更新奖池 | 完成，`web/js/pool.js` |
| Draw：停止时随机抽 N 人，不重复 | 完成，部分 Fisher–Yates + 安全随机 |
| Streaming：流程控制，随时终止不出错 | 完成，连接状态机 + 失败收尾 |

### Level 1：配置、历史与主题

- **MultiSettings**：多套配置，支持新建 / 删除 / 切换 / 改名，切换后界面同步。
- **History**：每次开奖自动记录时间、关键词、参与人数、完整名单；可单条删除、全部清空、导出 Markdown。
- **Day & Night**：跟随系统 / 浅色 / 深色三态，选择会持久化。

### Level 2：稳定性与多房间

- **Reconnecting**：断线后按 1s → 2s → 4s … 退避重连，封顶 30s，可手动停止。
- **Exception handling**：房间号非法、未登录、服务未启动、`-352` 风控、弹幕节点失败都有明确提示。
- **Merge Pooling**：同时监听多个直播间；同一个 uid 在合并池里只算一个人；按房间抽奖时不会重复中奖。

### Level 3：主题与动效

- **Theme**：4 套主题色 + 原生取色器自定义颜色 + 深浅模式，全部用 CSS 变量实现。
- **Motion**：按钮、卡片、弹层、列表有轻量过渡；主题切换瞬间会关闭过渡，避免掉帧。

## 功能清单

### P0

| 功能 | 说明 |
| --- | --- |
| 页面骨架 | 抽奖页 / 设置页两个视图，切换正常 |
| 请求封装 | 统一处理 query、`X-Cookie`、超时、HTTP 错误和业务 `code !== 0` |
| Cookie 登录 | 支持粘贴整段 Cookie 或只粘贴 `SESSDATA`，成功后显示昵称和头像 |
| 扫码登录 | 申请二维码 → 每 2s 轮询 → 成功自动登录；支持过期重新申请 |
| 房间号解析 | 数字、直播间链接、`/blanc/` 路径、`room_id=` / `id=` 参数 |
| 弹幕接入 | `getDanmuInfo` → WebSocket → 解帧 → 递归解压 → `DANMU_MSG` |
| 参与池 | 关键词为空即全员参与；多关键词按“或”匹配；按 uid 去重 |
| 抽奖 | 开始收集、停止开奖；名单人数正确且无重复 |

### P1

- 多套配置：关键词、中奖人数、监控房间整体保存
- 抽奖历史：查看、删除、清空、导出 `.md`
- 自定义背景图：本地图片压缩后保存，刷新后仍在
- 主题切换：跟随系统 / 浅色 / 深色 + 预设主题色 + 自定义取色

### P2

- 中英双语：全部界面文案，切换即时生效
- 断线重连：指数退避，轮换弹幕节点，必要时直连兜底
- 长名单：中奖名单卡片内部滚动，页面整体不被撑长
- 多房间：合并参与池，但按房间统计和退房互不干扰

## 目录结构

```text
GACHAGO/
├── README.md
├── start.bat                     # Windows 一键启动（Go 服务）
├── docs/
│   ├── api.md                    # 题目原文：接口与协议
│   ├── features.md               # 题目原文：功能清单
│   ├── delivery.md               # 题目原文：交付要求
│   └── demo/                     # 开发过程截图
├── server/                       # 题目给的 Go 转发服务（未改）
│   ├── main.go
│   ├── go.mod
│   └── go.sum
└── web/                          # 本次实现
    ├── index.html
    ├── favicon.svg
    ├── css/
    │   ├── base.css              # reset、CSS 变量、主题、外壳
    │   ├── components.css        # 按钮、卡片、输入框、toast、弹层
    │   └── views.css             # 抽奖页与设置页布局
    └── js/
        ├── main.js               # 入口：启动、路由、主题、语言
        ├── store.js              # 状态 + localStorage 持久化
        ├── api.js                # 请求封装 + B 站接口 + 房间号解析
        ├── wbi.js                # WBI 签名
        ├── md5.js                # 手写 MD5
        ├── danmaku.js            # 弹幕协议：组包、解帧、解压、重连
        ├── pool.js               # 参与池 + 公平抽奖
        ├── rooms.js              # 多房间连接管理
        ├── exporter.js           # Markdown 导出
        ├── i18n.js               # 中英双语
        ├── qrcode.js             # 手写二维码编码器
        ├── util.js               # DOM / 格式化 / 随机数工具
        └── ui/                   # 各视图控制器、模态框、toast
```

分层原则：**协议、请求、状态、渲染互不引用**。
`danmaku.js` 的解帧和解压是纯函数，可以脱离页面单独测试；界面只通过 store 读状态、写状态。

## 关键实现

### 1. 请求与登录

- 所有网络请求统一走 `web/js/api.js` 的 `request()`：
  - 自动拼 query；
  - 通过 `X-Cookie` 传登录态（浏览器禁止脚本直接设置 `Cookie` 头）；
  - 用 `AbortController` 做 15s 超时；
  - HTTP 错误和业务 `code !== 0` 都抛 `ApiError`，界面据此给出具体提示。
- Cookie 登录：兼容整段 `document.cookie`、`Cookie:` 头和单独的 `SESSDATA` 值。
- 扫码登录：`qrcode/generate` 拿到的是要编码进二维码的链接，前端用 `qrcode.js` 自己画码；
  `qrcode/poll` 的 `0 / 86090 / 86038` 三态分别处理，成功后从 `X-Set-Cookie` 取 Cookie。
- `getDanmuInfo` 需要 WBI 签名：`web/js/wbi.js` 负责 `w_rid` / `wts`，`web/js/md5.js` 负责 MD5；
  签名失败或 `nav` 不可用时退到公共弹幕节点。

### 2. 弹幕协议

弹幕包是 16 字节大端包头：

| 偏移 | 类型 | 字段 |
| --- | --- | --- |
| 0 | int32 | 整包长度（含头） |
| 4 | int16 | 头长度，固定 16 |
| 6 | int16 | 协议版本：0/1 JSON，2 deflate，3 brotli |
| 8 | int32 | operation：2 心跳 / 3 心跳回 / 5 消息 / 7 鉴权 / 8 鉴权成功 |
| 12 | int32 | sequence |
| 16 | bytes | 包体 |

处理流程：

1. `splitPackets()` 按长度切包，遇到不完整的尾巴直接丢弃，不让一条坏包打断整条流。
2. `ver === 2` 用 `DecompressionStream('deflate')` 解压，失败再试 `'deflate-raw'`；
   解压出来仍然可能是多个包，所以递归回到 `splitPackets()`。
3. 解析 `DANMU_MSG`：`info[1]` 文本、`info[2][0]` uid、`info[2][1]` 昵称。
4. 每 30 秒发一次 `op = 2` 心跳；断开后按指数退避重连，并轮换 `host_list`。

### 3. 参与池与公平抽奖

- 参与池用 `Map<uid, entry>`：同一个人发多少条都只算一条，重复发言只增加 `count`。
- 关键词支持逗号、顿号、空格、分号、竖线分隔；关键词为空表示全员参与。
- 抽奖使用**部分 Fisher–Yates**：只在快照上做前 N 次交换，结果不重复。
- 随机数优先用 `crypto.getRandomValues`，并用拒绝采样去掉取模偏差；不支持时才退回 `Math.random`。
- 一轮 = 一次“开始抽奖”：点开始时清空上一轮参与池，避免第二轮抽到历史总人数。

### 4. 状态与持久化

- `web/js/store.js` 是唯一状态源：配置、历史、主题、语言、Cookie 都存在一个 state 对象里。
- 修改统一走 `patch()` / `updateActiveSet()` 等方法，改完保存并通知订阅者。
- `localStorage` 读取有 `try/catch`；数据结构带 `v1` 版本后缀，读取时和默认值合并，旧数据不会让页面白屏。
- 不需要跨刷新保存的连接状态、参与池、弹幕日志不写入存储。

### 5. 多房间 Merge Pooling

- B 站没有“一条连接听多个房间”的能力，所以一个房间一条 WebSocket，由 `rooms.js` 的 `RoomManager` 管理。
- 所有房间共用一个参与池 `Map<uid, entry>`，每条 entry 记录 `rooms: Set<roomId>`。
- 另建 `Map<roomId, Set<uid>>` 反查索引，断开某个房间时只摘掉这个房间的贡献；
  如果同一个人也在别的房间发过弹幕，他会留在池子里。
- 按房间抽奖时用 `taken` 集合挡住已中奖的人，保证同一人不会在两个房间重复中奖。

### 6. 主题与性能

- 所有颜色都用 CSS 变量；切主题只改 `<html data-theme>`，不需要改上百条规则。
- 切换瞬间给 `<html>` 加 `.theme-switching` 临时关闭过渡，让新配色一帧落地。
- 常驻卡片去掉大面积 `backdrop-filter`，热路径颜色改为预计算变量，避免切换掉帧。
- 弹幕日志最多保留 160 条，超出从头部删除，跑很久 DOM 数量也恒定。

## 演示

`docs/demo/` 里有开发过程的截图：

- 收集弹幕
- 开奖弹层
- 深色设置页
- 刷新后状态恢复
- 窄窗口响应式
- 扫码登录
- 头像加载失败回退
- 多房间合并池

> 这些截图是开发阶段的数据。提交前建议再补一段真实直播间的 30 秒录屏，
> 完整走一遍「登录 → 加房间 → 人数涨 → 出名单」。

## 常见现象

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 页面里到处出现黑色竖线 / 文本光标 | 浏览器开启了“光标浏览”（caret browsing） | 按 `F7` 关闭；也可以在 Chrome / Edge 的辅助功能设置里关闭 |
| 标签页图标还是旧图标 | 浏览器缓存了 favicon | `Ctrl + F5` 强制刷新，或关掉标签页重新打开 |
| 打开页面白屏 | 用 `file://` 或纯静态服务器打开了 | 必须从 `http://127.0.0.1:8787` 打开 |
| 请求 404 / CORS | 直接请求了 B 站域名 | 改用 `/api`、`/live`、`/passport` 相对路径 |
| `EADDRINUSE` | 8787 端口被占用 | 换端口：`go run . -addr 127.0.0.1:8080 -web ../web` |

## 已知问题 / 还没做的

1. `b23.tv` 短链只给了明确提示，没有做短链展开。
2. Cookie 存在 `localStorage`，这是本地练习工具的方便做法；真实产品应该使用 httpOnly Cookie。
3. 中继服务沿用题目原版的白名单：只允许 `*.chat.bilibili.com` / `*.chat.bilibili.co`；
   中继不可用时客户端会尝试直连 `wss://…/sub`，并显示“直连中”。
4. 仓库内没有自动化端到端测试；目前依靠浏览器控制台、Network 面板和手工验收。
5. `docs/demo/` 目前是开发阶段截图，真实直播间录屏待补。

## 验收清单

- [ ] 能解析房间号和直播间链接，非法输入有明确提示
- [ ] 能连上真实直播间，控制台能看到实时弹幕
- [ ] 关键词为空 = 全员参与；同一个人发多条只算一个人
- [ ] 停止开奖名单人数正确、无重复
- [ ] 刷新页面后配置、历史、主题还在
- [ ] Cookie 无效、未登录、服务未启动都有可读提示
- [ ] 窗口从 1400px 拉到 400px 不溢出
- [ ] 控制台没有红色报错
- [ ] 多房间合并、断开某一房间不影响其他房间

## 关于 `server/`

`server/` 是题目提供的转发服务，只负责：

- 静态托管 `web/`；
- 把 `/api`、`/live`、`/passport` 反向代理到 B 站；
- 把 `/ws` 的二进制字节原样中转。

它不解析弹幕，不做业务逻辑。解帧、解压、登录、参与池、抽奖全部在 `web/` 前端完成。

本仓库的 `server/main.go`、`go.mod`、`go.sum` 与题目仓库
<https://github.com/aDarkMaker/BiliLuckyDraw/tree/BingyanFE-Practice>
的 `BingyanFE-Practice` 分支（commit `d9d7b77`）保持一致。
