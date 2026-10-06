/**
 * Participant pool + draw algorithm.
 *
 * Rules from the brief:
 *   - empty keyword list means "everyone participates"
 *   - one person counts once no matter how many times they spam
 *   - a draw returns N distinct people
 *
 * Merge pooling (P2): several live rooms feed ONE pool. uids are global on
 * bilibili, so the same person showing up in two rooms is one participant —
 * but every entry remembers which rooms it came from, and a per-room index
 * (`byRoom`) lets a room be removed without touching anybody else's data.
 * That is the "井水不犯河水" part; the merging itself is the easy half.
 */

import { secureRandom } from "./util.js";

/** "抽奖, 参与 抽奖" -> ["抽奖", "参与"] (deduped, lower-cased). */
export function parseKeywords(text) {
	const seen = new Set();
	for (const raw of String(text ?? "").split(/[,，、\s;；|]+/)) {
		const word = raw.trim().toLowerCase();
		if (word) seen.add(word);
	}
	return [...seen];
}

/** Substring match, case-insensitive. No keywords => everything matches. */
export function matchesKeywords(text, keywords) {
	if (!keywords.length) return true;
	const haystack = String(text ?? "").toLowerCase();
	return keywords.some((word) => haystack.includes(word));
}

export class Pool {
	constructor() {
		this.entries = new Map();
		/** roomId -> Set<entry key>, so removing a room is O(that room). */
		this.byRoom = new Map();
		// `matched` counts keyword hits *this round*; overall traffic is tracked
		// by the view, so a new round can start from a clean slate.
		this.stats = { matched: 0 };
	}

	reset() {
		this.entries.clear();
		this.byRoom.clear();
		this.stats = { matched: 0 };
	}

	get size() {
		return this.entries.size;
	}

	/** Everyone, or — with a roomId — only those who spoke in that room. */
	list(roomId) {
		if (!roomId) return [...this.entries.values()];
		const keys = this.byRoom.get(String(roomId));
		if (!keys) return [];
		const out = [];
		for (const key of keys) {
			const entry = this.entries.get(key);
			if (entry) out.push(entry);
		}
		return out;
	}

	/** How many participants a single room contributed to the merged pool. */
	sizeOfRoom(roomId) {
		return this.byRoom.get(String(roomId))?.size ?? 0;
	}

	/**
	 * Drop everything one room contributed.
	 * A person who also spoke in another room stays in the pool, minus this
	 * room — that is the whole point of keeping a per-room index.
	 */
	removeRoom(roomId) {
		const keys = this.byRoom.get(String(roomId));
		if (!keys) return 0;
		let dropped = 0;
		for (const key of keys) {
			const entry = this.entries.get(key);
			if (!entry) continue;
			entry.rooms.delete(String(roomId));
			if (entry.rooms.size === 0) {
				this.entries.delete(key);
				dropped += 1;
			}
		}
		this.byRoom.delete(String(roomId));
		return dropped;
	}

	/**
	 * Feed one danmaku into the pool.
	 * @returns {{matched: boolean, isNew: boolean, entry: object|null}}
	 */
	ingest(danmu, keywords) {
		if (!matchesKeywords(danmu.text, keywords)) return { matched: false, isNew: false, entry: null };

		this.stats.matched += 1;
		const key = danmu.uid || `anon:${danmu.name}`;
		const roomId = String(danmu.roomId ?? "");
		const existing = this.entries.get(key);

		if (existing) {
			existing.count += 1;
			existing.lastText = danmu.text;
			existing.lastAt = danmu.ts;
			this.linkRoom(existing, key, roomId);
			return { matched: true, isNew: false, entry: existing };
		}

		const entry = {
			uid: danmu.uid,
			name: danmu.name,
			rooms: new Set(),
			firstText: danmu.text,
			lastText: danmu.text,
			firstAt: danmu.ts,
			lastAt: danmu.ts,
			count: 1,
		};
		this.entries.set(key, entry);
		this.linkRoom(entry, key, roomId);
		return { matched: true, isNew: true, entry };
	}

	linkRoom(entry, key, roomId) {
		if (!roomId) return;
		if (entry.rooms.has(roomId)) return;
		entry.rooms.add(roomId);
		if (!this.byRoom.has(roomId)) this.byRoom.set(roomId, new Set());
		this.byRoom.get(roomId).add(key);
	}

	/**
	 * Pick `count` distinct participants.
	 * Uses a partial Fisher–Yates over a snapshot so the input order — which is
	 * arrival order — never leaks into the result.
	 *
	 * @param {number} count
	 * @param {{roomId?: string}} [options] restrict to one room
	 */
	draw(count, { roomId } = {}) {
		const wanted = Math.max(1, Math.floor(Number(count) || 1));
		const snapshot = this.list(roomId);
		const picked = [];
		const limit = Math.min(wanted, snapshot.length);

		for (let i = 0; i < limit; i += 1) {
			const j = i + secureRandom(snapshot.length - i);
			[snapshot[i], snapshot[j]] = [snapshot[j], snapshot[i]];
			picked.push(snapshot[i]);
		}

		return {
			winners: picked.map((entry, index) => ({ ...entry, rank: index + 1 })),
			requested: wanted,
			poolSize: snapshot.length,
			short: snapshot.length < wanted,
		};
	}

	/**
	 * Draw `count` from each room in turn, treating the rooms as separate pools
	 * so one room cannot fill up somebody else's quota — but never handing the
	 * same person two wins in the same draw.
	 *
	 * @param {string[]} roomIds
	 * @param {number} count per room
	 * @returns {Array<{roomId: string, winners: object[], requested: number, poolSize: number, short: boolean}>}
	 */
	drawPerRoom(roomIds, count) {
		const taken = new Set();
		const results = [];

		for (const roomId of roomIds) {
			const key = String(roomId);
			const candidates = this.list(key).filter((entry) => !taken.has(entry.uid || `anon:${entry.name}`));
			const wanted = Math.max(1, Math.floor(Number(count) || 1));
			const picked = [];
			const limit = Math.min(wanted, candidates.length);

			for (let i = 0; i < limit; i += 1) {
				const j = i + secureRandom(candidates.length - i);
				[candidates[i], candidates[j]] = [candidates[j], candidates[i]];
				picked.push(candidates[i]);
				taken.add(candidates[i].uid || `anon:${candidates[i].name}`);
			}

			results.push({
				roomId: key,
				winners: picked.map((entry, index) => ({ ...entry, rank: index + 1, roomId: key })),
				requested: wanted,
				poolSize: candidates.length,
				short: candidates.length < wanted,
			});
		}

		return results;
	}
}
