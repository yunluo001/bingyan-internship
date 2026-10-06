/**
 * Several live rooms at once.
 *
 * One `DanmakuClient` per room, all of them feeding the same participant pool.
 * The manager only owns the connections and their status; keeping the rooms
 * apart (per-room stats, per-room removal, per-room draws) is the pool's job.
 *
 * Bilibili itself has no notion of "one connection, many rooms", so this is
 * genuinely N sockets — the merge happens entirely on our side.
 */

import { CONNECTION_STATE, DanmakuClient } from "./danmaku.js";

export const ACTIVE_STATES = new Set([
	CONNECTION_STATE.CONNECTING,
	CONNECTION_STATE.CONNECTED,
	CONNECTION_STATE.RECONNECTING,
]);

export class RoomManager {
	/**
	 * @param {object} handlers
	 * @param {(danmu: object) => void} handlers.onDanmaku  gets `roomId` attached
	 * @param {(roomId: string, state: string, detail: object) => void} handlers.onStatus
	 */
	constructor({ onDanmaku, onStatus, debug = false } = {}) {
		this.onDanmaku = onDanmaku || (() => {});
		this.onStatus = onStatus || (() => {});
		this.debug = debug;
		/** roomId -> { roomId, title, client, state, detail } */
		this.rooms = new Map();
	}

	get size() {
		return this.rooms.size;
	}

	list() {
		return [...this.rooms.values()];
	}

	ids() {
		return [...this.rooms.keys()];
	}

	get(roomId) {
		return this.rooms.get(String(roomId)) || null;
	}

	has(roomId) {
		return this.rooms.has(String(roomId));
	}

	/** A room is "live" when its socket is connecting / connected / retrying. */
	isActive(roomId) {
		const record = this.get(roomId);
		return Boolean(record && ACTIVE_STATES.has(record.state));
	}

	anyActive() {
		return this.list().some((record) => ACTIVE_STATES.has(record.state));
	}

	activeCount() {
		return this.list().filter((record) => ACTIVE_STATES.has(record.state)).length;
	}

	/** Connected (auth acknowledged) rooms only. */
	connectedCount() {
		return this.list().filter((record) => record.state === CONNECTION_STATE.CONNECTED).length;
	}

	async add({ roomId, title, token, hosts, uid = 0, cookie = "" }) {
		const key = String(roomId);
		if (this.rooms.has(key)) return this.rooms.get(key);

		const client = new DanmakuClient({
			debug: this.debug,
			onDanmaku: (danmu) => this.onDanmaku({ ...danmu, roomId: key }),
			onStatus: (state, detail = {}) => {
				const record = this.rooms.get(key);
				if (record) {
					record.state = state;
					record.detail = detail;
				}
				this.onStatus(key, state, detail);
			},
		});

		const record = { roomId: key, title: title || `房间 ${key}`, client, state: CONNECTION_STATE.IDLE, detail: {} };
		this.rooms.set(key, record);
		await client.start({ roomId: key, token, hosts, uid, cookie });
		return record;
	}

	/** Drop one room: its socket, and (via the caller) its slice of the pool. */
	remove(roomId) {
		const key = String(roomId);
		const record = this.rooms.get(key);
		if (!record) return false;
		record.client.stop();
		this.rooms.delete(key);
		return true;
	}

	stopAll() {
		for (const record of this.rooms.values()) record.client.stop();
		this.rooms.clear();
	}
}
