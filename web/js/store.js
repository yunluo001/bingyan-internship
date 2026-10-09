/**
 * Application state + localStorage persistence.
 *
 * State shape
 * -----------
 * {
 *   lang, themeMode, accent,
 *   cookie, user, session,              // bilibili session (cookie + metadata)
 *   sets: [{ id, name, keywords, winners, room: { id, title } }],
 *   activeSetId,
 *   history: [{ id, at, keywords, count, size, roomId, winners: [{ uid, name }] }],
 * }
 *
 * The wallpaper lives under its own key because a data URL is heavy and we do
 * not want to rewrite it on every counter tick.
 */

import { uid } from "./util.js";

const KEY = "gachago.state.v1";
const WALLPAPER_KEY = "gachago.wallpaper.v1";
const SESSION_TTL = 6 * 60 * 60 * 1000;

export const ACCENTS = ["pink", "violet", "ocean", "mint"];
export const THEME_MODES = ["system", "light", "dark"];

const DEFAULT_SETTINGS = {
	keywords: "",
	winners: 1,
	rooms: [],
};

/** A preset watches a list of rooms; `room` (singular) is the old shape. */
function normalizeRooms(set) {
	const list = Array.isArray(set?.rooms) ? set.rooms : [];
	const rooms = list
		.map((room) => ({
			id: room?.id ? String(room.id) : "",
			title: typeof room?.title === "string" ? room.title : "",
		}))
		.filter((room) => room.id);

	if (rooms.length === 0 && set?.room?.id) {
		rooms.push({ id: String(set.room.id), title: typeof set.room.title === "string" ? set.room.title : "" });
	}
	return rooms;
}

function createDefaultState() {
	const first = { id: uid("set"), name: "", ...structuredClone(DEFAULT_SETTINGS) };
	return {
		lang: "zh",
		themeMode: "system",
		accent: "pink",
		cookie: "",
		user: null,
		session: { savedAt: 0, checkedAt: 0, expiresAt: 0 },
		sets: [first],
		activeSetId: first.id,
		history: [],
	};
}

/** Merge persisted data into the default shape so old saves never crash the app. */
function normalize(raw) {
	const base = createDefaultState();
	if (!raw || typeof raw !== "object") return base;

	const state = {
		...base,
		...raw,
		sets: Array.isArray(raw.sets) && raw.sets.length ? raw.sets : base.sets,
		history: Array.isArray(raw.history) ? raw.history : [],
	};

	state.lang = raw.lang === "en" ? "en" : "zh";
	state.themeMode = THEME_MODES.includes(raw.themeMode) ? raw.themeMode : "system";
	state.accent =
		ACCENTS.includes(raw.accent) || /^#[0-9a-f]{6}$/i.test(raw.accent) ? raw.accent : "pink";
	state.cookie = typeof raw.cookie === "string" ? raw.cookie : "";
	state.user = raw.user && typeof raw.user === "object" ? raw.user : null;
	state.session = {
		savedAt: Number.isFinite(raw.session?.savedAt) ? raw.session.savedAt : 0,
		checkedAt: Number.isFinite(raw.session?.checkedAt) ? raw.session.checkedAt : 0,
		expiresAt: Number.isFinite(raw.session?.expiresAt) ? raw.session.expiresAt : 0,
	};

	state.sets = state.sets.map((set) => ({
		id: set?.id || uid("set"),
		name: typeof set?.name === "string" ? set.name : "",
		keywords: typeof set?.keywords === "string" ? set.keywords : "",
		winners: Number.isFinite(set?.winners) ? set.winners : 1,
		rooms: normalizeRooms(set),
	}));

	if (!state.sets.some((set) => set.id === state.activeSetId)) {
		state.activeSetId = state.sets[0].id;
	}

	return state;
}

function readJSON(key) {
	try {
		const raw = localStorage.getItem(key);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

class Store {
	constructor() {
		this.state = normalize(readJSON(KEY));
		this.wallpaper = localStorage.getItem(WALLPAPER_KEY) || "";
		this.listeners = new Set();
		this.warnedQuota = false;
	}

	subscribe(listener) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	emit(reason = "patch") {
		for (const listener of this.listeners) {
			try {
				listener(this.state, reason);
			} catch (error) {
				console.error("[store] listener failed", error);
			}
		}
	}

	/** Shallow-merge a patch, persist and notify. */
	patch(partial, reason) {
		Object.assign(this.state, partial);
		this.save();
		this.emit(reason);
		return this.state;
	}

	save() {
		try {
			localStorage.setItem(KEY, JSON.stringify(this.state));
			return true;
		} catch (error) {
			if (!this.warnedQuota) {
				this.warnedQuota = true;
				console.warn("[store] persist failed", error);
			}
			return false;
		}
	}

	/* ------------------------------------------------------------------ */
	/* Bilibili session                                                   */
	/* ------------------------------------------------------------------ */

	/** Persist a verified cookie together with its session metadata. */
	saveSession(cookie, user) {
		const now = Date.now();
		this.state.cookie = cookie;
		this.state.user = user;
		this.state.session = {
			savedAt: now,
			checkedAt: now,
			expiresAt: now + SESSION_TTL,
		};
		this.save();
		this.emit("account");
		return this.state;
	}

	/** Call after a successful `myinfo` check to extend the soft TTL. */
	markSessionChecked() {
		const now = Date.now();
		this.state.session.checkedAt = now;
		this.state.session.expiresAt = now + SESSION_TTL;
		this.save();
		this.emit("account");
		return this.state;
	}

	clearSession() {
		this.state.cookie = "";
		this.state.user = null;
		this.state.session = { savedAt: 0, checkedAt: 0, expiresAt: 0 };
		this.save();
		this.emit("account");
		return this.state;
	}

	/** Old saves or a stale 6h window should be checked once on boot. */
	needsSessionCheck() {
		const { cookie, session } = this.state;
		if (!cookie) return false;
		if (!session?.checkedAt) return true;
		return Date.now() - session.checkedAt > SESSION_TTL;
	}

	/* ------------------------------------------------------------------ */
	/* Presets                                                            */
	/* ------------------------------------------------------------------ */

	activeSet() {
		return this.state.sets.find((set) => set.id === this.state.activeSetId) || this.state.sets[0];
	}

	updateActiveSet(patch, reason = "set") {
		const set = this.activeSet();
		if (!set) return null;
		Object.assign(set, patch);
		this.save();
		this.emit(reason);
		return set;
	}

	createSet(patch = {}) {
		const set = {
			id: uid("set"),
			name: patch.name || "",
			keywords: patch.keywords ?? "",
			winners: patch.winners ?? 1,
			rooms: Array.isArray(patch.rooms) ? patch.rooms : [],
		};
		this.state.sets.push(set);
		this.state.activeSetId = set.id;
		this.save();
		this.emit("sets");
		return set;
	}

	selectSet(id) {
		if (!this.state.sets.some((set) => set.id === id)) return;
		this.state.activeSetId = id;
		this.save();
		this.emit("sets");
	}

	renameSet(id, name) {
		const set = this.state.sets.find((item) => item.id === id);
		if (!set) return;
		set.name = name;
		this.save();
		this.emit("sets");
	}

	removeSet(id) {
		if (this.state.sets.length <= 1) return false;
		const index = this.state.sets.findIndex((set) => set.id === id);
		if (index < 0) return false;
		this.state.sets.splice(index, 1);
		if (this.state.activeSetId === id) {
			this.state.activeSetId = this.state.sets[Math.min(index, this.state.sets.length - 1)].id;
		}
		this.save();
		this.emit("sets");
		return true;
	}

	/* ------------------------------------------------------------------ */
	/* Rooms inside the active preset                                     */
	/* ------------------------------------------------------------------ */

	/** Remember a room in the preset so it comes back after a refresh. */
	rememberRoom(roomId, title = "") {
		const set = this.activeSet();
		if (!set) return;
		const id = String(roomId);
		const rooms = set.rooms.filter((room) => room.id !== id);
		rooms.push({ id, title: title || "" });
		set.rooms = rooms;
		this.save();
		this.emit("set");
	}

	forgetRoom(roomId) {
		const set = this.activeSet();
		if (!set) return;
		const id = String(roomId);
		const rooms = set.rooms.filter((room) => room.id !== id);
		if (rooms.length === set.rooms.length) return;
		set.rooms = rooms;
		this.save();
		this.emit("set");
	}

	/* ------------------------------------------------------------------ */
	/* History                                                            */
	/* ------------------------------------------------------------------ */

	addHistory(entry) {
		const record = { id: uid("draw"), at: Date.now(), ...entry };
		this.state.history.unshift(record);
		if (this.state.history.length > 200) this.state.history.length = 200;
		this.save();
		this.emit("history");
		return record;
	}

	removeHistory(id) {
		const index = this.state.history.findIndex((item) => item.id === id);
		if (index < 0) return;
		this.state.history.splice(index, 1);
		this.save();
		this.emit("history");
	}

	clearHistory() {
		this.state.history = [];
		this.save();
		this.emit("history");
	}

	/* ------------------------------------------------------------------ */
	/* Wallpaper                                                          */
	/* ------------------------------------------------------------------ */

	setWallpaper(dataUrl) {
		try {
			if (dataUrl) localStorage.setItem(WALLPAPER_KEY, dataUrl);
			else localStorage.removeItem(WALLPAPER_KEY);
			this.wallpaper = dataUrl || "";
			this.emit("wallpaper");
			return true;
		} catch (error) {
			console.warn("[store] wallpaper too large", error);
			return false;
		}
	}
}

export const store = new Store();
