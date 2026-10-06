/**
 * bilibili danmaku protocol.
 *
 * Wire format (all integers big endian):
 *
 *   0  int32   total packet length (header included)
 *   4  int16   header length, always 16
 *   6  int16   protocol version
 *   8  int32   operation
 *  12  int32   sequence
 *  16  ...     body
 *
 * operation: 2 heartbeat | 3 heartbeat reply | 5 message | 7 auth | 8 auth ok
 * version:   0/1 JSON | 2 zlib(deflate) | 3 brotli
 *
 * A version-2 body is itself a concatenation of complete packets (possibly
 * more than one), so decoding recurses. Everything below is pure except
 * `DanmakuClient`, which owns a WebSocket and a reconnect timer.
 */

import { truncate } from "./util.js";

export const HEADER_SIZE = 16;

export const OP = {
	HEARTBEAT: 2,
	HEARTBEAT_REPLY: 3,
	MESSAGE: 5,
	AUTH: 7,
	AUTH_REPLY: 8,
};

export const VER = {
	JSON: 0,
	JSON_ALT: 1,
	DEFLATE: 2,
	BROTLI: 3,
};

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

/* -------------------------------------------------------------------------- */
/* Packing                                                                    */
/* -------------------------------------------------------------------------- */

/** Build one packet. `body` may be a JSON-able object, string or bytes. */
export function packPacket(op, body = new Uint8Array(0), ver = VER.JSON_ALT, sequence = 1) {
	let payload;
	if (body instanceof Uint8Array) payload = body;
	else if (typeof body === "string") payload = encoder.encode(body);
	else payload = encoder.encode(JSON.stringify(body));

	const total = HEADER_SIZE + payload.byteLength;
	const buffer = new ArrayBuffer(total);
	const view = new DataView(buffer);
	view.setInt32(0, total);
	view.setInt16(4, HEADER_SIZE);
	view.setInt16(6, ver);
	view.setInt32(8, op);
	view.setInt32(12, sequence);
	new Uint8Array(buffer, HEADER_SIZE).set(payload);
	return new Uint8Array(buffer);
}

export function authPacket({ roomId, uid = 0, token }) {
	return packPacket(
		OP.AUTH,
		{
			uid: Number(uid) || 0,
			roomid: Number(roomId),
			protover: 2,
			platform: "web",
			type: 2,
			key: token,
		},
		VER.JSON_ALT,
		1,
	);
}

export function heartbeatPacket() {
	return packPacket(OP.HEARTBEAT, new Uint8Array(0), VER.JSON_ALT, 1);
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Split a raw buffer into packets without touching the body beyond copying it.
 * Tolerant by design: a truncated tail is dropped instead of throwing.
 */
export function splitPackets(raw) {
	const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
	const packets = [];
	let offset = 0;

	while (offset + HEADER_SIZE <= bytes.byteLength) {
		const view = new DataView(bytes.buffer, bytes.byteOffset + offset, HEADER_SIZE);
		const total = view.getInt32(0);
		const headerSize = view.getInt16(4);
		const ver = view.getInt16(6);
		const op = view.getInt32(8);
		const seq = view.getInt32(12);

		if (total < headerSize || headerSize < HEADER_SIZE || offset + total > bytes.byteLength) break;

		packets.push({
			ver,
			op,
			sequence: seq,
			body: bytes.slice(offset + headerSize, offset + total),
		});
		offset += total;
	}

	return packets;
}

/**
 * zlib inflate via the platform's DecompressionStream.
 * Some senders use raw deflate, so we retry with 'deflate-raw'.
 */
export async function inflate(bytes) {
	const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	const formats = ["deflate", "deflate-raw"];
	let lastError;

	for (const format of formats) {
		if (typeof DecompressionStream !== "function") break;
		try {
			const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream(format));
			const buffer = await new Response(stream).arrayBuffer();
			return new Uint8Array(buffer);
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError || new Error("DecompressionStream unavailable");
}

/**
 * Turn a websocket frame into decoded JSON messages.
 * Handles JSON bodies, deflate bodies (recursively) and politely ignores
 * brotli/damaged frames so one bad packet cannot kill the stream.
 */
export async function decodeFrame(raw, { onPacket } = {}) {
	const messages = [];

	const walk = async (bytes, depth = 0, stats = { packets: 0, json: 0, inflated: 0, skipped: 0 }) => {
		const packets = splitPackets(bytes);
		for (const packet of packets) {
			stats.packets += 1;
			onPacket?.(packet, stats);

			if (packet.op === OP.MESSAGE || packet.op === OP.HEARTBEAT_REPLY || packet.op === OP.AUTH_REPLY) {
				if (packet.ver === VER.DEFLATE && depth < 4) {
					try {
						stats.inflated += 1;
						await walk(await inflate(packet.body), depth + 1, stats);
						continue;
					} catch (error) {
						stats.skipped += 1;
						console.warn("[danmaku] inflate failed", error);
						continue;
					}
				}
				if (packet.ver === VER.BROTLI) {
					stats.skipped += 1;
					if (typeof DecompressionStream === "function") {
						try {
							const stream = new Blob([packet.body]).stream().pipeThrough(new DecompressionStream("brotli"));
							await walk(new Uint8Array(await new Response(stream).arrayBuffer()), depth + 1, stats);
							continue;
						} catch {
							/* brotli needs a newer engine; fall through */
						}
					}
					continue;
				}
				const text = decoder.decode(packet.body);
				if (!text) continue;
				try {
					stats.json += 1;
					messages.push(JSON.parse(text));
				} catch {
					stats.skipped += 1;
				}
			}
		}
		return stats;
	};

	const stats = await walk(raw);
	return { messages, stats };
}

/**
 * Normalise a `DANMU_MSG`.
 * info[1] = text, info[2][0] = uid, info[2][1] = nickname, info[9].ts = time.
 */
export function parseDanmaku(message) {
	if (!message || message.cmd !== "DANMU_MSG") return null;
	const info = message.info;
	if (!Array.isArray(info)) return null;

	const text = typeof info[1] === "string" ? info[1] : "";
	const user = Array.isArray(info[2]) ? info[2] : [];
	const meta = Array.isArray(info[0]) ? info[0] : [];

	const uid = Number(user[0]) || 0;
	const name = String(user[1] ?? "").trim() || `uid${uid}`;
	const ts = Number(info[9]?.ts ?? meta[4] ?? 0);

	return {
		uid,
		name,
		text,
		ts: ts > 1e12 ? ts : ts * 1000 || Date.now(),
		medal: Array.isArray(info[3]) ? info[3]?.[1] : undefined,
		guard: Number(meta[7] ?? 0),
	};
}

/* -------------------------------------------------------------------------- */
/* Client                                                                     */
/* -------------------------------------------------------------------------- */

export const CONNECTION_STATE = {
	IDLE: "idle",
	CONNECTING: "connecting",
	CONNECTED: "connected",
	RECONNECTING: "reconnecting",
	CLOSED: "closed",
	ERROR: "error",
};

/**
 * Owns one websocket to a live room.
 *
 * Everything protocol related (auth packet, 30s heartbeat, deflate) happens
 * here; the rest of the app only sees `onDanmaku` / `onStatus`.
 *
 * Reconnect: 1s, 2s, 4s … capped at 30s, with the host list rotated so a dead
 * edge node does not trap us forever. `stop()` cancels it for good.
 */
export class DanmakuClient {
	constructor({ onDanmaku, onStatus, onError, onAuth, debug = false } = {}) {
		this.onDanmaku = onDanmaku || (() => {});
		this.onStatus = onStatus || (() => {});
		this.onError = onError || (() => {});
		this.onAuth = onAuth || (() => {});
		this.debug = debug;

		this.socket = null;
		this.roomId = "";
		this.uid = 0;
		this.token = "";
		this.cookie = "";
		this.hosts = [];
		this.hostIndex = 0;
		this.attempt = 0;
		this.manuallyStopped = true;
		this.state = CONNECTION_STATE.IDLE;
		this.heartbeatTimer = 0;
		this.reconnectTimer = 0;
		this.useRelay = true;
		this.stats = { frames: 0, packets: 0, messages: 0, danmaku: 0, inflateErrors: 0 };
	}

	async start({ roomId, token, hosts, uid = 0, cookie = "" }) {
		this.stop();
		this.roomId = String(roomId);
		this.token = token;
		this.hosts = Array.isArray(hosts) && hosts.length ? hosts : [];
		this.uid = uid;
		this.cookie = cookie;
		this.hostIndex = 0;
		this.attempt = 0;
		this.manuallyStopped = false;
		this.useRelay = true;
		this.stats = { frames: 0, packets: 0, messages: 0, danmaku: 0, inflateErrors: 0 };
		await this.open();
	}

	stop() {
		this.manuallyStopped = true;
		window.clearInterval(this.heartbeatTimer);
		window.clearTimeout(this.reconnectTimer);
		this.heartbeatTimer = 0;
		this.reconnectTimer = 0;

		if (this.socket) {
			const socket = this.socket;
			this.socket = null;
			socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
			try {
				if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
					socket.close(1000, "client stop");
				}
			} catch {
				/* nothing to do */
			}
		}
		this.setState(CONNECTION_STATE.CLOSED);
	}

	setState(state, detail) {
		this.state = state;
		this.onStatus(state, detail);
	}

	currentHost() {
		if (!this.hosts.length) return null;
		return this.hosts[this.hostIndex % this.hosts.length];
	}

	buildUrl(host, relay) {
		const port = host.wss_port || 443;
		const upstream = `wss://${host.host}:${port}/sub`;
		if (!relay) return upstream;
		const scheme = location.protocol === "https:" ? "wss" : "ws";
		const params = new URLSearchParams({ upstream });
		if (this.cookie) params.set("cookie", this.cookie);
		return `${scheme}://${location.host}/ws?${params.toString()}`;
	}

	async open() {
		const host = this.currentHost();
		if (!host) {
			this.setState(CONNECTION_STATE.ERROR, "no host");
			return;
		}

		this.setState(this.attempt === 0 ? CONNECTION_STATE.CONNECTING : CONNECTION_STATE.RECONNECTING, {
			attempt: this.attempt,
			host: host.host,
			relay: this.useRelay,
		});

		const url = this.buildUrl(host, this.useRelay);
		let socket;
		try {
			socket = new WebSocket(url);
		} catch (error) {
			this.onError(error);
			this.scheduleReconnect();
			return;
		}
		socket.binaryType = "arraybuffer";
		this.socket = socket;

		const guard = window.setTimeout(() => {
			if (this.socket === socket && socket.readyState === WebSocket.CONNECTING) {
				try {
					socket.close();
				} catch {
					/* ignore */
				}
			}
		}, 12000);

		socket.onopen = () => {
			window.clearTimeout(guard);
			if (this.debug) console.info("[danmaku] socket open", url);
			socket.send(authPacket({ roomId: this.roomId, uid: this.uid, token: this.token }));
			this.startHeartbeat();
		};

		socket.onmessage = async (event) => {
			try {
				const raw = event.data instanceof Blob ? await event.data.arrayBuffer() : event.data;
				this.stats.frames += 1;
				const { messages, stats } = await decodeFrame(raw, {
					onPacket: (packet) => {
						if (packet.op === OP.AUTH_REPLY && this.state !== CONNECTION_STATE.CONNECTED) {
							this.attempt = 0;
							this.setState(CONNECTION_STATE.CONNECTED, { host: host.host });
							this.onAuth();
						}
					},
				});
				this.stats.packets += stats.packets;
				this.stats.messages += stats.json;
				if (this.debug) {
					console.debug("[danmaku] frame", stats, messages.length ? messages : "");
				}
				for (const message of messages) {
					const danmu = parseDanmaku(message);
					if (danmu) {
						this.stats.danmaku += 1;
						this.onDanmaku(danmu);
					}
				}
			} catch (error) {
				console.warn("[danmaku] frame error", error);
			}
		};

		socket.onerror = () => {
			window.clearTimeout(guard);
			this.onError(new Error("websocket error"));
		};

		socket.onclose = (event) => {
			window.clearTimeout(guard);
			if (this.socket !== socket) return;
			this.socket = null;
			window.clearInterval(this.heartbeatTimer);
			if (this.manuallyStopped) return;
			if (this.debug) console.info("[danmaku] socket closed", event.code, event.reason);
			this.scheduleReconnect();
		};
	}

	/** Backoff 1s → 2s → 4s … 30s, rotating hosts and falling back off-relay. */
	scheduleReconnect() {
		if (this.manuallyStopped) return;
		this.attempt += 1;
		// After a couple of relay failures try a direct wss:// connection.
		if (this.attempt === 3) this.useRelay = false;
		if (this.attempt === 5) {
			this.useRelay = true;
			this.hostIndex += 1;
			this.attempt = 1;
		}
		const delay = Math.min(30000, 1000 * 2 ** Math.min(this.attempt - 1, 5));
		this.setState(CONNECTION_STATE.RECONNECTING, { attempt: this.attempt, delay });
		this.reconnectTimer = window.setTimeout(() => this.open(), delay);
	}

	startHeartbeat() {
		window.clearInterval(this.heartbeatTimer);
		this.heartbeatTimer = window.setInterval(() => {
			if (this.socket?.readyState === WebSocket.OPEN) {
				try {
					this.socket.send(heartbeatPacket());
				} catch (error) {
					console.warn("[danmaku] heartbeat failed", error);
				}
			}
		}, 30000);
	}
}

/** Console-friendly one liner used when debugging a live room. */
export function describeDanmaku(danmu) {
	return `${truncate(danmu.name, 12)}(${danmu.uid}): ${truncate(danmu.text, 60)}`;
}
