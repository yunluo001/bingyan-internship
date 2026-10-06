/**
 * Tiny i18n layer.
 * - `t(key, vars)` interpolates `{name}` placeholders.
 * - Elements carrying `data-i18n`, `data-i18n-placeholder`, `data-i18n-title`
 *   or `data-i18n-aria` are re-translated whenever the language changes.
 */

const DICT = {
	zh: {
		"brand.tagline": "直播弹幕抽奖",
		"nav.draw": "抽奖",
		"nav.settings": "设置",

		"theme.label": "主题",
		"theme.system": "跟随系统",
		"theme.auto": "自动",
		"theme.systemNow": "跟随系统 · 当前是{theme}",
		"theme.light": "浅色",
		"theme.dark": "深色",
		"lang.switch": "切换语言",

		"room.title": "直播间",
		"room.input": "房间号 / 直播间链接",
		"room.placeholder": "22637261 或 https://live.bilibili.com/22637261",
		"room.connect": "连接",
		"room.connectOne": "连接",
		"room.remove": "断开",
		"room.added": "已加入监控：{title}",
		"room.removed": "已断开房间 {id}，它的参与者已从池子里移除。",
		"room.n": "{n} 个房间",
		"room.listEmpty": "还没有监控任何房间。在上面输入房间号点「连接」加进来——可以加多个，它们会合并进同一个参与池。",
		"room.meta": "收到 {received} 条 · 入池 {inPool} 人",
		"room.hint": "可以添加多个直播间，弹幕会合并进同一个参与池；未登录也能听，但部分房间会限制。",
		"room.hint.connected": "已连接 {rooms} 个房间，弹幕正在进入同一个参与池。",
		"room.hint.reconnecting": "房间 {id} 的连接断了，正在自动重连（1s / 2s / 4s… 逐次退避）。",
		"room.status.idle": "未连接",
		"room.status.connecting": "连接中",
		"room.status.connected": "已连接",
		"room.status.direct": "直连中",
		"room.status.reconnecting": "重连中",
		"room.status.error": "出错了",
		"room.status.connectedN": "已连接 {ok}/{total}",
		"room.status.connectingN": "连接中 {ok}/{total}",
		"room.status.reconnectingN": "重连中 {ok}/{total}",
		"room.status.errorN": "异常 {ok}/{total}",
		"room.unknownTitle": "房间 {id}",
		"room.hint.direct": "本地转发服务没连上，已直连公共弹幕节点接收弹幕；房间标题和登录态拿不到。",

		"draw.title": "抽奖控制",
		"draw.keywords": "参与关键词（逗号或空格分隔，留空 = 全员参与）",
		"draw.keywordsPlaceholder": "抽奖, 参与",
		"draw.count": "中奖人数",
		"draw.poolSize": "参与人数",
		"draw.received": "收到弹幕",
		"draw.matched": "命中关键词",
		"draw.start": "开始抽奖",
		"draw.stop": "停止并开奖",
		"draw.reset": "清空参与池",
		"draw.status.idle": "待开始",
		"draw.status.running": "收集弹幕中",
		"draw.hint.idle": "点「开始抽奖」后，命中关键词的观众会进入参与池。",
		"draw.hint.running": "第 {round} 轮收集中：点「停止并开奖」抽出 {count} 位。",
		"draw.hint.runningPerRoom": "第 {round} 轮收集中：每个房间各抽 {count} 位。",
		"draw.mode": "抽奖方式",
		"draw.modeMerged": "合并抽",
		"draw.modePerRoom": "每个房间各抽",
		"draw.modeHintMerged": "把 {rooms} 个房间的参与者放在一起，抽 {count} 个人。",
		"draw.modeHintPerRoom": "每个房间各抽 {count} 个人；同一个人不会在两个房间重复中奖。",
		"draw.hint.noRoom": "还没连接直播间，先去上面连接一个吧。",
		"draw.hint.waiting": "第 {round} 轮已开始，等待观众发送关键词…",
		"draw.roundReset": "已开始新一轮，上一轮的 {size} 人已清空，重新统计参与。",

		"log.title": "实时弹幕",
		"log.follow": "自动滚动",
		"log.empty": "连接直播间后，弹幕会实时出现在这里",

		"winners.title": "中奖名单",
		"winners.copy": "复制",
		"winners.export": "导出",
		"winners.meta": "本场共 {size} 人参与 · 关键词：{keywords} · {time}",

		"account.title": "账号",
		"account.anonymous": "未登录",
		"account.hint": "登录后可以看到自己的头像昵称，也能进入需要登录的直播间。",
		"account.qr": "扫码登录",
		"account.cookie": "Cookie 登录",
		"account.qrCreate": "获取二维码",
		"account.qrIdle": "用 B 站客户端扫码",
		"account.qrWaiting": "二维码已生成，等待扫码…",
		"account.qrScanned": "已扫码，请在手机上确认",
		"account.qrExpired": "二维码已过期",
		"account.qrRefresh": "重新获取",
		"account.qrSuccess": "登录成功",
		"account.qrOpen": "在新标签页打开二维码",
		"account.cookieLabel": "浏览器 Cookie",
		"account.cookiePlaceholder": "SESSDATA=xxx; bili_jct=xxx; DedeUserID=xxx",
		"account.login": "登录",
		"account.logout": "退出登录",
		"account.loggedIn": "已登录",

		"sets.title": "配置方案",
		"sets.create": "新建",
		"sets.hint": "关键词、中奖人数、房间号各存一套，可随时切换。",
		"sets.defaultName": "配置 {n}",
		"sets.use": "启用",
		"sets.rename": "改名",
		"sets.delete": "删除",
		"sets.active": "使用中",
		"sets.empty": "还没有配置，点「新建」创建一套。",
		"sets.keywords": "关键词：{value}",
		"sets.all": "全部",
		"sets.winners": "抽 {n} 人",
		"sets.roomsList": "房间 {list}",
		"sets.noRoom": "未设置房间",

		"appearance.title": "外观",
		"appearance.mode": "深浅模式",
		"appearance.accent": "主题色",
		"appearance.custom": "自定义",
		"appearance.background": "自定义背景图",
		"appearance.pick": "选择图片",
		"appearance.clear": "移除",
		"appearance.backgroundHint": "建议选大图，会自动压缩后保存到本地。",
		"appearance.language": "语言",
		"appearance.bgSaved": "背景图已保存",
		"appearance.bgCleared": "背景图已移除",
		"appearance.bgFailed": "背景图保存失败，换张小一点的图试试",

		"history.title": "抽奖历史",
		"history.clearAll": "全部清空",
		"history.empty": "还没有开奖记录。",
		"history.export": "导出",
		"history.delete": "删除",
		"history.view": "查看",
		"history.meta": "{time} · {size} 人参与 · 抽 {count} 人",
		"history.keywords": "关键词：{value}",
		"history.cleared": "历史记录已清空",

		"confirm.title": "确认操作",
		"confirm.ok": "确定",
		"confirm.cancel": "取消",
		"common.close": "关闭",
		"common.copy": "复制",
		"common.copied": "已复制到剪贴板",
		"common.unknown": "未知",

		"toast.ok": "成功",
		"toast.warn": "注意",
		"toast.error": "出错了",
		"toast.info": "提示",

		"offline.title": "没连上本地转发服务",
		"offline.text":
			"页面能打开，但 /api、/live、/ws 需要一个本地服务转发到 B 站。在项目根目录下执行：",
		"offline.copy": "复制命令",
		"offline.more": "详细步骤",
		"err.offline": "本地转发服务没连上：请先启动服务，再从这个服务提供的地址打开页面。",

		"err.network": "请求失败，检查后端服务是否在运行。",
		"err.badRoom": "没解析出房间号，换一个输入试试。",
		"err.badCookie": "Cookie 无效或已过期。",
		"err.loginRequired": "需要登录后才能继续。",
		"err.qrExpired": "二维码已过期，请重新获取。",
		"err.wsFailed": "弹幕连接失败，正在重试…",
		"err.wsRelay": "弹幕连接失败：中继服务拒绝了该上游地址。",
		"err.noPool": "参与池是空的，先让观众发弹幕吧。",
		"err.poolTooSmall": "参与池只有 {size} 人，本次抽 {count} 人，全部中奖。",
		"err.danmuInfo": "拿不到弹幕服务器配置：{message}。可能是房间号不对，或 B 站要求先登录。",
		"err.danmuInfoBare": "拿不到弹幕服务器配置。可能是房间号不对，或 B 站要求先登录。",
		"err.danmuFallback": "拿不到弹幕服务器配置（{message}），已改用公共弹幕节点直连。",
		"err.directMode": "本地转发服务没连上，已自动改用直连方式接收弹幕。",
		"err.roomInfo": "房间信息获取失败：{message}",
		"err.roomAlready": "房间 {id} 已经在列表里了。",
		"err.wsGiveUp": "弹幕连接一直失败（已重试 {attempt} 次），可能是网络或中继被拦。",

		"roll.title": "开奖中",
		"roll.text": "正在从 {size} 位参与者中抽取 {count} 位…",
		"roll.done": "开奖完成",
		"lang.name": "中",
	},

	en: {
		"brand.tagline": "Live danmaku lottery",
		"nav.draw": "Draw",
		"nav.settings": "Settings",

		"theme.label": "Theme",
		"theme.system": "Follow system",
		"theme.auto": "Auto",
		"theme.systemNow": "Follow system · currently {theme}",
		"theme.light": "Light",
		"theme.dark": "Dark",
		"lang.switch": "Switch language",

		"room.title": "Live room",
		"room.input": "Room id / live URL",
		"room.placeholder": "22637261 or https://live.bilibili.com/22637261",
		"room.connect": "Connect",
		"room.connectOne": "Connect",
		"room.remove": "Disconnect",
		"room.added": "Now monitoring: {title}",
		"room.removed": "Disconnected room {id}; its participants left the pool.",
		"room.n": "{n} rooms",
		"room.listEmpty": "No rooms yet. Type a room id above and hit Connect — add several and they merge into one pool.",
		"room.meta": "{received} danmaku · {inPool} in pool",
		"room.hint": "Add several live rooms; their danmaku merge into one participant pool. Guests can listen, but some rooms are restricted.",
		"room.hint.connected": "{rooms} room(s) connected, all feeding the same pool.",
		"room.hint.reconnecting": "Room {id} dropped its socket; reconnecting with backoff (1s / 2s / 4s…).",
		"room.status.idle": "Not connected",
		"room.status.connecting": "Connecting",
		"room.status.connected": "Connected",
		"room.status.direct": "Direct",
		"room.status.reconnecting": "Reconnecting",
		"room.status.error": "Error",
		"room.status.connectedN": "Connected {ok}/{total}",
		"room.status.connectingN": "Connecting {ok}/{total}",
		"room.status.reconnectingN": "Reconnecting {ok}/{total}",
		"room.status.errorN": "Trouble {ok}/{total}",
		"room.unknownTitle": "Room {id}",
		"room.hint.direct": "The local relay is unreachable, so danmaku is coming straight from the public nodes. Room title and login state are unavailable.",

		"draw.title": "Draw control",
		"draw.keywords": "Keywords (comma or space separated, empty = everyone)",
		"draw.keywordsPlaceholder": "lucky, enter",
		"draw.count": "Winners",
		"draw.poolSize": "Participants",
		"draw.received": "Danmaku seen",
		"draw.matched": "Keyword hits",
		"draw.start": "Start draw",
		"draw.stop": "Stop & pick",
		"draw.reset": "Reset pool",
		"draw.status.idle": "Idle",
		"draw.status.running": "Collecting",
		"draw.hint.idle": "Press start, then every danmaku that matches a keyword joins the pool.",
		"draw.hint.running": "Round {round} is collecting. Press stop to pick {count} winners.",
		"draw.hint.runningPerRoom": "Round {round} is collecting. Picking {count} from each room.",
		"draw.mode": "Draw mode",
		"draw.modeMerged": "Merged",
		"draw.modePerRoom": "Per room",
		"draw.modeHintMerged": "All {rooms} rooms share one pool; pick {count} in total.",
		"draw.modeHintPerRoom": "Pick {count} from each room; nobody wins twice.",
		"draw.hint.noRoom": "No live room yet — connect one above first.",
		"draw.hint.waiting": "Round {round} started, waiting for keyword danmaku…",
		"draw.roundReset": "New round started — {size} participants from the previous round were cleared.",

		"log.title": "Live danmaku",
		"log.follow": "Auto scroll",
		"log.empty": "Connect a live room and danmaku shows up here",

		"winners.title": "Winners",
		"winners.copy": "Copy",
		"winners.export": "Export",
		"winners.meta": "{size} participants · keywords: {keywords} · {time}",

		"account.title": "Account",
		"account.anonymous": "Signed out",
		"account.hint": "Sign in to show your avatar and to enter members-only rooms.",
		"account.qr": "QR code",
		"account.cookie": "Cookie",
		"account.qrCreate": "Get QR code",
		"account.qrIdle": "Scan with the bilibili app",
		"account.qrWaiting": "Waiting for scan…",
		"account.qrScanned": "Scanned — confirm on your phone",
		"account.qrExpired": "QR code expired",
		"account.qrRefresh": "Refresh",
		"account.qrSuccess": "Signed in",
		"account.qrOpen": "Open the QR code in a new tab",
		"account.cookieLabel": "Browser cookie",
		"account.cookiePlaceholder": "SESSDATA=xxx; bili_jct=xxx; DedeUserID=xxx",
		"account.login": "Sign in",
		"account.logout": "Sign out",
		"account.loggedIn": "Signed in",

		"sets.title": "Presets",
		"sets.create": "New",
		"sets.hint": "Keywords, winner count and room id stored as one preset.",
		"sets.defaultName": "Preset {n}",
		"sets.use": "Use",
		"sets.rename": "Rename",
		"sets.delete": "Delete",
		"sets.active": "Active",
		"sets.empty": "No preset yet — create one.",
		"sets.keywords": "Keywords: {value}",
		"sets.all": "everyone",
		"sets.winners": "{n} winners",
		"sets.roomsList": "Rooms {list}",
		"sets.noRoom": "No room",

		"appearance.title": "Appearance",
		"appearance.mode": "Colour mode",
		"appearance.accent": "Accent",
		"appearance.custom": "Custom",
		"appearance.background": "Custom wallpaper",
		"appearance.pick": "Pick image",
		"appearance.clear": "Remove",
		"appearance.backgroundHint": "Large images are downscaled before being stored locally.",
		"appearance.language": "Language",
		"appearance.bgSaved": "Wallpaper saved",
		"appearance.bgCleared": "Wallpaper removed",
		"appearance.bgFailed": "Could not store that image, try a smaller one",

		"history.title": "Draw history",
		"history.clearAll": "Clear all",
		"history.empty": "No draw yet.",
		"history.export": "Export",
		"history.delete": "Delete",
		"history.view": "View",
		"history.meta": "{time} · {size} participants · {count} winners",
		"history.keywords": "Keywords: {value}",
		"history.cleared": "History cleared",

		"confirm.title": "Please confirm",
		"confirm.ok": "Confirm",
		"confirm.cancel": "Cancel",
		"common.close": "Close",
		"common.copy": "Copy",
		"common.copied": "Copied to clipboard",
		"common.unknown": "unknown",

		"toast.ok": "Done",
		"toast.warn": "Heads up",
		"toast.error": "Something broke",
		"toast.info": "Info",

		"offline.title": "Local relay service not reachable",
		"offline.text":
			"The page loaded, but /api, /live and /ws need a local service to reach bilibili. From the project root run:",
		"offline.copy": "Copy command",
		"offline.more": "How to start",
		"err.offline": "The local relay service is not running — start it, then open the page from its address.",

		"err.network": "Request failed — is the backend running?",
		"err.badRoom": "No room id found in that input.",
		"err.badCookie": "That cookie is invalid or expired.",
		"err.loginRequired": "Sign in to continue.",
		"err.qrExpired": "QR code expired, please refresh.",
		"err.wsFailed": "Danmaku socket failed, retrying…",
		"err.wsRelay": "Danmaku socket refused: the relay rejected that upstream host.",
		"err.noPool": "The pool is empty — wait for viewers to send danmaku.",
		"err.poolTooSmall": "Only {size} participants but {count} winners requested; everyone wins.",
		"err.danmuInfo": "Could not fetch danmaku server config: {message}. Wrong room id, or login required.",
		"err.danmuInfoBare": "Could not fetch danmaku server config. Wrong room id, or login required.",
		"err.danmuFallback": "Could not fetch danmaku config ({message}); connecting to the public danmaku nodes instead.",
		"err.directMode": "The local relay service is unreachable; switched to a direct danmaku connection.",
		"err.roomInfo": "Room info failed: {message}",
		"err.roomAlready": "Room {id} is already in the list.",
		"err.wsGiveUp": "Danmaku socket keeps failing (retried {attempt} times).",

		"roll.title": "Drawing",
		"roll.text": "Picking {count} of {size} participants…",
		"roll.done": "Done",
		"lang.name": "EN",
	},
};

let current = "zh";

export function setLang(lang) {
	current = DICT[lang] ? lang : "zh";
	document.documentElement.lang = current === "zh" ? "zh-CN" : "en";
	return current;
}

export function getLang() {
	return current;
}

export function t(key, vars) {
	const table = DICT[current] || DICT.zh;
	let text = table[key] ?? DICT.zh[key] ?? key;
	if (vars) {
		text = text.replace(/\{(\w+)\}/g, (match, name) =>
			vars[name] === undefined || vars[name] === null ? match : String(vars[name]),
		);
	}
	return text;
}

/** Re-apply translations to every tagged node under `root`. */
export function applyStaticI18n(root = document) {
	for (const node of root.querySelectorAll("[data-i18n]")) {
		if (node.dataset.i18n) node.textContent = t(node.dataset.i18n);
	}
	for (const node of root.querySelectorAll("[data-i18n-placeholder]")) {
		if (node.dataset.i18nPlaceholder) node.placeholder = t(node.dataset.i18nPlaceholder);
	}
	for (const node of root.querySelectorAll("[data-i18n-title]")) {
		if (node.dataset.i18nTitle) node.title = t(node.dataset.i18nTitle);
	}
	for (const node of root.querySelectorAll("[data-i18n-aria]")) {
		if (node.dataset.i18nAria) node.setAttribute("aria-label", t(node.dataset.i18nAria));
	}
}

export const LANGS = Object.keys(DICT);
