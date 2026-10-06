# API

本地服务默认 `127.0.0.1:8787`：

```
-addr  监听地址，默认 127.0.0.1:8787
-web   静态目录，默认 web
```

## 路由

| 本机路径 | 转发到 | 说明 |
| --- | --- | --- |
| `/api/{path}` | `https://api.bilibili.com/{path}` | 账号 |
| `/live/{path}` | `https://api.live.bilibili.com/{path}` | 直播 / 弹幕配置 |
| `/passport/{path}` | `https://passport.bilibili.com/{path}` | 扫码登录 |
| `/ws` | 弹幕 WebSocket | 二进制原样转发 |
| 其它 | `web/` | 静态文件 |

query 原样保留。

## Cookie

浏览器 `fetch` 设不了 `Cookie` 头，用 `X-Cookie`：

```js
await fetch('/api/x/space/myinfo', {
  headers: { 'X-Cookie': cookieString },
});
```

扫码成功后从 `X-Set-Cookie` 读 Cookie：

```js
const res = await fetch('/passport/x/passport-login/web/qrcode/poll?qrcode_key=' + key);
const cookie = res.headers.get('X-Set-Cookie');
```

## 弹幕中转

```
ws://127.0.0.1:8787/ws?upstream=<encodeURIComponent(wss)>&cookie=<encodeURIComponent(cookie)>
```

只允许 `*.chat.bilibili.com`。服务不解析字节，鉴权 / 心跳 / 解帧 / 解压都在浏览器做。也可以直连 `getDanmuInfo` 给的 `wss://.../sub`。

## B 站接口

### 账号

```
GET /api/x/space/myinfo
-> { code, message, data: { mid, name, face } }
```

### 扫码

```
GET /passport/x/passport-login/web/qrcode/generate
-> { code: 0, data: { url, qrcode_key } }

GET /passport/x/passport-login/web/qrcode/poll?qrcode_key=<key>
-> { code: 0, data: { code, message, ... } }
```

`data.code`：`0` 成功（读 `X-Set-Cookie`）/ `86038` 过期 / `86090` 已扫待确认。轮询间隔 2s 左右。

### 直播间

```
GET /live/room/v1/Room/get_info?room_id=<id>
-> { code: 0, data: { room_id, uid, title, live_status, ... } }

GET /live/xlive/web-room/v1/index/getDanmuInfo?id=<realRoomId>&type=0
-> { code: 0, data: { token, host_list: [{ host, port, wss_port, ws_port }] } }
```

短号用返回的 `data.room_id`。`room_id` 为 0 时可试 `/live/room/v1/Room/mobileRoomInit?id=<id>`。

### 弹幕包

16 字节大端包头：

| 偏移 | 类型 | 字段 |
| --- | --- | --- |
| 0 | int32 | 整包长度（含头） |
| 4 | int16 | 头长，固定 16 |
| 6 | int16 | 协议版本 |
| 8 | int32 | operation |
| 12 | int32 | sequence |

operation：`2` 心跳 / `3` 心跳回包 / `5` 消息 / `7` 鉴权 / `8` 鉴权成功。

协议版本：`0` = JSON；`2` = deflate，解压后还是完整包（可能多个），要递归。

鉴权包体：

```json
{ "uid": 0, "roomid": 123, "protover": 2, "platform": "web", "type": 2, "key": "<token>" }
```

弹幕：

```json
{ "cmd": "DANMU_MSG", "info": [ [...], "文本", [uid, "昵称", ...], ... ] }
```

只处理 `DANMU_MSG`：`info[1]` 文本，`info[2][0]` uid，`info[2][1]` 昵称。
