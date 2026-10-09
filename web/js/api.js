/**
 * Every network call the app makes goes through here.
 *
 * Rules the practice server imposes (see docs/api.md):
 *   - `/api/*`      -> api.bilibili.com
 *   - `/live/*`     -> api.live.bilibili.com
 *   - `/passport/*` -> passport.bilibili.com
 *   - the bilibili cookie travels in an `X-Cookie` header, never `Cookie`
 *   - the login cookie comes back in `X-Set-Cookie`
 */

import { keyFromUrl, signQuery } from "./wbi.js";

const DEFAULT_TIMEOUT = 15000;

/**
 * Fired when a request fails in a way that means "the local relay service is
 * not there", as opposed to "bilibili said no". The UI listens for it and
 * shows the actionable startup banner — the single most common reason this
 * project looks broken is simply that nobody started the server.
 */
export const OFFLINE_EVENT = "gachago:offline";
export const SESSION_EXPIRED_EVENT = "gachago:session-expired";

function reportOffline(detail) {
	window.dispatchEvent(new CustomEvent(OFFLINE_EVENT, { detail }));
}

export class ApiError extends Error {
	constructor(message, { code = null, status = 0, path = "", offline = false } = {}) {
		super(message);
		this.name = "ApiError";
		this.code = code;
		this.status = status;
		this.path = path;
		this.offline = offline;
	}
}

/**
 * fetch + JSON + bilibili envelope handling.
 * Throws ApiError when the transport fails or when `code !== 0`.
 */
export async function request(path, options = {}) {
	const { method = "GET", query, cookie, timeout = DEFAULT_TIMEOUT, body, headers = {} } = options;

	let url = path;
	if (typeof query === "string") {
		// Pre-signed query strings must go out byte-for-byte.
		if (query) url += (url.includes("?") ? "&" : "?") + query;
	} else if (query) {
		const search = new URLSearchParams();
		for (const [key, value] of Object.entries(query)) {
			if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
		}
		const qs = search.toString();
		if (qs) url += (url.includes("?") ? "&" : "?") + qs;
	}

	const controller = new AbortController();
	const timer = window.setTimeout(() => controller.abort(), timeout);

	let response;
	try {
		response = await fetch(url, {
			method,
			headers: {
				Accept: "application/json, text/plain, */*",
				...(cookie ? { "X-Cookie": cookie } : {}),
				...headers,
			},
			body,
			signal: controller.signal,
			credentials: "same-origin",
			cache: "no-store",
		});
	} catch (error) {
		const aborted = error.name === "AbortError";
		// Same-origin fetch failing outright almost always means the local
		// service is not running.
		if (!aborted) reportOffline({ reason: "network", path: url });
		throw new ApiError(aborted ? "timeout" : "network", { path: url, offline: !aborted });
	} finally {
		window.clearTimeout(timer);
	}

	const text = await response.text();
	let payload = null;
	if (text) {
		try {
			payload = JSON.parse(text);
		} catch {
			payload = null;
		}
	}

	// A bare static server (Live Server, `python -m http.server`, double-clicking
	// index.html) answers /api/... with its own HTML 404 page. Say that out loud
	// instead of dumping markup into a toast.
	if (!payload && !response.ok) {
		const looksLikeMissingProxy = [404, 405, 501].includes(response.status);
		if (looksLikeMissingProxy) {
			reportOffline({ reason: "no-proxy", status: response.status, path: url });
			throw new ApiError("offline", { status: response.status, path: url, offline: true });
		}
		throw new ApiError(`HTTP ${response.status}`, { status: response.status, path: url });
	}

	if (!response.ok) {
		if (response.status === 401) {
			window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { path: url } }));
		}
		throw new ApiError(payload?.message || `HTTP ${response.status}`, {
			status: response.status,
			path: url,
			code: payload?.code ?? null,
		});
	}

	if (payload && typeof payload.code === "number" && payload.code !== 0) {
		if (payload.code === -101) {
			window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { path: url } }));
		}
		throw new ApiError(payload.message || `code ${payload.code}`, {
			status: response.status,
			code: payload.code,
			path: url,
		});
	}

	return { data: payload?.data ?? payload, raw: payload, response, text };
}

/* -------------------------------------------------------------------------- */
/* Room id parsing                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Accepts a bare room id or any bilibili live URL and returns the numeric id
 * (short ids included — the caller resolves them against `/live/room/...`).
 * Returns "" when nothing numeric can be found.
 */
export function parseRoomId(input) {
	const value = String(input ?? "").trim();
	if (!value) return "";

	const direct = value.match(/^\d{1,12}$/);
	if (direct) return direct[0];

	// Short links look like https://b23.tv/xxxxx — nothing numeric, so bail out
	// with an empty string and let the UI ask for the real id.
	if (/^https?:\/\//i.test(value)) {
		try {
			const url = new URL(value);
			const segments = url.pathname.split("/").filter(Boolean);
			for (let i = segments.length - 1; i >= 0; i -= 1) {
				const found = segments[i].match(/^\d{1,12}$/);
				if (found) return found[0];
			}
			const fromQuery = url.searchParams.get("room_id") || url.searchParams.get("id");
			if (fromRoomQuery(fromQuery)) return fromRoomQuery(fromQuery);
			return "";
		} catch {
			/* fall through to the loose match below */
		}
	}

	const loose = value.match(/\d{1,12}/);
	return loose ? loose[0] : "";
}

function fromRoomQuery(value) {
	return value && /^\d{1,12}$/.test(value) ? value : "";
}

/* -------------------------------------------------------------------------- */
/* Account                                                                    */
/* -------------------------------------------------------------------------- */

export async function fetchMyInfo(cookie) {
	const { data } = await request("/api/x/space/myinfo", { cookie });
	if (!data || (data.mid ?? 0) === 0) throw new ApiError("not logged in", { code: -101 });
	return {
		mid: data.mid,
		name: data.name || data.uname || "",
		face: normalizeUrl(data.face),
		level: data.level,
	};
}

export async function qrGenerate() {
	const { data } = await request("/passport/x/passport-login/web/qrcode/generate");
	if (!data?.url || !data?.qrcode_key) throw new ApiError("bad qrcode payload");
	return { url: data.url, key: data.qrcode_key };
}

/**
 * Poll a login QR code.
 * @returns {{state: 'success'|'scanned'|'expired'|'waiting', cookie?: string, message?: string}}
 */
export async function qrPoll(key, { cookie = "" } = {}) {
	const { data, response } = await request("/passport/x/passport-login/web/qrcode/poll", {
		query: { qrcode_key: key },
		cookie,
	});

	const state = data?.code;
	if (state === 0) {
		const cookieHeader = response.headers.get("X-Set-Cookie") || "";
		const parsed = parseCookieHeader(cookieHeader);
		return { state: "success", cookie: parsed.cookie || cookieHeader, message: data.message };
	}
	if (state === 86090) return { state: "scanned", message: data?.message };
	if (state === 86038) return { state: "expired", message: data?.message };
	return { state: "waiting", message: data?.message };
}

/** `X-Set-Cookie` is a `; ` joined list of name=value pairs. */
export function parseCookieHeader(header) {
	const cookie = String(header || "").trim();
	const fields = {};
	if (!cookie) return { cookie: "", fields };
	for (const part of cookie.split(";")) {
		const [name, ...rest] = part.trim().split("=");
		if (!name) continue;
		fields[name] = rest.join("=");
	}
	return { cookie, fields };
}

/** Read the `SESSDATA` / `bili_jct` / `DedeUserID` triple out of any cookie blob. */
export function extractCookieFields(raw) {
	const text = String(raw || "");
	const fields = {};
	for (const key of ["SESSDATA", "bili_jct", "DedeUserID", "buvid3"]) {
		const match = text.match(new RegExp(`${key}=([^;\\s]+)`));
		if (match) fields[key] = match[1];
	}
	return fields;
}

/**
 * Normalise whatever the user pasted into a cookie header value.
 * Accepts a full "document.cookie" dump, a `Cookie:` header line, or just the
 * value of SESSDATA.
 */
export function normalizeCookieInput(raw) {
	let text = String(raw || "").trim();
	if (!text) return "";
	text = text.replace(/^cookie\s*:/i, "").trim();
	text = text.replace(/\s+/g, " ");

	const fields = extractCookieFields(text);
	if (Object.keys(fields).length > 0) {
		return Object.entries(fields)
			.map(([key, value]) => `${key}=${value}`)
			.join("; ");
	}
	// Bare SESSDATA value pasted on its own.
	if (/^[A-Za-z0-9%*_.\-]+$/.test(text)) return `SESSDATA=${text}`;
	return text;
}

/* -------------------------------------------------------------------------- */
/* Live room                                                                  */
/* -------------------------------------------------------------------------- */

function normalizeUrl(url) {
	if (!url) return "";
	if (url.startsWith("//")) return `https:${url}`;
	return url;
}

/**
 * Resolve a user supplied id into a real room.
 * Falls back to `mobileRoomInit` when `get_info` reports room_id 0 (the
 * documented behaviour for short ids that are not the real room id).
 */
export async function fetchRoomInfo(inputId, { cookie = "" } = {}) {
	const roomId = parseRoomId(inputId);
	if (!roomId) throw new ApiError("bad room id");

	const { data } = await request("/live/room/v1/Room/get_info", {
		query: { room_id: roomId },
		cookie,
	});

	let info = data;
	if (!info?.room_id) {
		const fallback = await request("/live/room/v1/Room/mobileRoomInit", {
			query: { id: roomId },
			cookie,
		});
		info = fallback.data;
	}

	const realId = info?.room_id || roomId;
	return {
		inputId: roomId,
		roomId: String(realId),
		shortId: info?.short_id ? String(info.short_id) : roomId,
		uid: info?.uid ?? 0,
		title: info?.title || `房间 ${roomId}`,
		liveStatus: Number(info?.live_status ?? 0),
		cover: normalizeUrl(info?.user_cover || info?.cover || info?.keyframe || ""),
		online: Number(info?.online ?? 0),
		raw: info,
	};
}

/**
 * Public danmaku hosts, used when `getDanmuInfo` refuses to talk to us.
 * The token it hands out is a best-effort credential — plenty of clients
 * connect with an empty key and still receive DANMU_MSG.
 */
export const DEFAULT_DANMU_HOSTS = [
	{ host: "broadcastlv.chat.bilibili.com", wss_port: 443, ws_port: 2244 },
	{ host: "tx-bj-live-comet-01.chat.bilibili.com", wss_port: 443, ws_port: 2244 },
	{ host: "tx-sh-live-comet-03.chat.bilibili.com", wss_port: 443, ws_port: 2244 },
];

/* -------------------------------------------------------------------------- */
/* wbi signing                                                                */
/* -------------------------------------------------------------------------- */

let wbiKeys = null;

export function forgetWbiKeys() {
	wbiKeys = null;
}

/**
 * `/x/web-interface/nav` publishes the daily img_key/sub_key used to sign
 * other requests. Cached for the session; `forgetWbiKeys()` forces a refetch
 * (the pair rotates at midnight, and a stale one produces -352).
 */
export async function getWbiKeys(cookie, { force = false } = {}) {
	if (wbiKeys && !force) return wbiKeys;
	const { data } = await request("/api/x/web-interface/nav", { cookie });
	const imgKey = keyFromUrl(data?.wbi_img?.img_url);
	const subKey = keyFromUrl(data?.wbi_img?.sub_url);
	if (!imgKey || !subKey) throw new ApiError("wbi keys unavailable");
	wbiKeys = { imgKey, subKey, fetchedAt: Date.now() };
	return wbiKeys;
}

/**
 * `getDanmuInfo` returns the websocket hosts + the auth token.
 * It is wbi-protected: without `w_rid`/`wts` bilibili answers `-352`, which is
 * exactly what a freshly logged-in user used to hit here.
 */
export async function fetchDanmuInfo(roomId, { cookie = "" } = {}) {
	const params = { id: roomId, type: 0 };

	const attempt = async (forceKeys) => {
		const keys = await getWbiKeys(cookie, { force: forceKeys });
		const signed = signQuery(params, keys.imgKey, keys.subKey);
		const { data } = await request("/live/xlive/web-room/v1/index/getDanmuInfo", {
			query: signed.full,
			cookie,
		});
		const hosts = Array.isArray(data?.host_list) ? data.host_list : [];
		if (!data?.token || hosts.length === 0) throw new ApiError("no danmaku host");
		return { token: data.token, hosts, signed: true };
	};

	try {
		return await attempt(false);
	} catch (error) {
		// -352 with a valid cookie almost always means the cached keys are stale.
		if (error?.code === -352) {
			forgetWbiKeys();
			return attempt(true);
		}
		throw error;
	}
}
