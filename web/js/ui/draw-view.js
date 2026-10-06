/**
 * The draw console.
 *
 * Rooms are a list, not a single slot: every room gets its own danmaku socket
 * (see `RoomManager`) and they all feed ONE participant pool (merge pooling).
 * What keeps them from trampling each other:
 *
 *   - the pool keys participants by uid and remembers their rooms, so a person
 *     who speaks in two rooms is still one participant
 *   - dropping a room only removes that room's slice of the pool
 *   - "每个房间各抽 N 人" draws per room without handing anyone two wins
 */

import { $, clear, copyText, el, formatNumber, formatTime, truncate } from "../util.js";
import { t } from "../i18n.js";
import { DEFAULT_DANMU_HOSTS, fetchDanmuInfo, fetchRoomInfo, parseRoomId } from "../api.js";
import { CONNECTION_STATE } from "../danmaku.js";
import { Pool, parseKeywords } from "../pool.js";
import { RoomManager } from "../rooms.js";
import { store } from "../store.js";
import { downloadRecord, winnersToText } from "../exporter.js";
import { toast, toastApiError, toastOk, toastWarn } from "./toast.js";
import { openModal } from "./modal.js";

const MAX_LOG_NODES = 160;
const DEBUG = false;

export function createDrawView() {
	const nodes = {
		roomInput: $("#room-input"),
		btnConnect: $("#btn-connect"),
		roomCount: $("#room-count"),
		roomStatus: $("#room-status"),
		roomStatusText: $("#room-status-text"),
		roomHint: $("#room-hint"),
		roomList: $("#room-list"),

		keywords: $("#draw-keywords"),
		count: $("#draw-count"),
		modeField: $("#draw-mode-field"),
		modeTabs: $("#draw-mode-tabs"),
		modeHint: $("#draw-mode-hint"),
		btnDraw: $("#btn-draw"),
		btnDrawLabel: $("#btn-draw-label"),
		btnReset: $("#btn-reset"),
		drawHint: $("#draw-hint"),
		poolStatus: $("#pool-status"),
		poolStatusText: $("#pool-status-text"),

		statPool: $("#stat-pool"),
		statRecv: $("#stat-recv"),
		statHit: $("#stat-hit"),

		logList: $("#log-list"),
		logCount: $("#log-count"),
		logFollow: $("#log-follow"),

		cardWinners: $("#card-winners"),
		winnersList: $("#winners-list"),
		winnersCount: $("#winners-count"),
		winnersMeta: $("#winners-meta"),
		btnCopyWinners: $("#btn-copy-winners"),
		btnExportWinners: $("#btn-export-winners"),
	};

	const pool = new Pool();
	const manager = new RoomManager({ onDanmaku: handleDanmaku, onStatus: handleRoomStatus, debug: DEBUG });

	/** roomId -> UI record: { roomId, title, received, state, offline, nodes } */
	const rooms = new Map();

	let running = false;
	let directMode = false;
	let round = 0;
	let drawMode = "merged";
	let receivedTotal = 0;
	let lastRecord = null;
	let logNodes = 0;
	let waitingTimer = 0;
	let pendingAdds = 0;

	/* ---------------------------------------------------------------------- */
	/* Small render helpers                                                   */
	/* ---------------------------------------------------------------------- */

	function setHint(key, vars) {
		if (!key) return;
		nodes.drawHint.dataset.i18n = key;
		nodes.drawHint.textContent = t(key, { count: readCount(), round, rooms: rooms.size, ...vars });
	}

	function bump(node, value) {
		const next = typeof value === "number" ? formatNumber(value) : String(value);
		if (node.textContent === next) return;
		node.textContent = next;
		node.classList.remove("is-bump");
		void node.offsetWidth;
		node.classList.add("is-bump");
	}

	function renderStats() {
		bump(nodes.statPool, pool.size);
		bump(nodes.statRecv, receivedTotal);
		bump(nodes.statHit, pool.stats.matched);
		nodes.logCount.textContent = String(receivedTotal);
	}

	function readCount() {
		const value = Number.parseInt(nodes.count.value, 10);
		return Number.isFinite(value) && value > 0 ? value : 1;
	}

	function keywords() {
		return parseKeywords(nodes.keywords.value);
	}

	function setBusy(node, busy) {
		node.disabled = busy;
		node.classList.toggle("is-busy", busy);
	}

	/** "code -352: 风控校验失败" reads a lot better than a bare message. */
	function describeError(error) {
		const message = error?.message || "";
		if (message === "network" || message === "timeout") return t("err.network");
		if (message === "bad room id") return t("err.badRoom");
		if (message === "no danmaku host" || message === "offline") return "";
		if (error?.code) return `${error.code}: ${message}`;
		return message || t("common.unknown");
	}

	/* ---------------------------------------------------------------------- */
	/* Room list                                                              */
	/* ---------------------------------------------------------------------- */

	function roomStateKey(record) {
		if (record.state === CONNECTION_STATE.CONNECTED) return directMode ? "room.status.direct" : "room.status.connected";
		if (record.state === CONNECTION_STATE.CONNECTING) return "room.status.connecting";
		if (record.state === CONNECTION_STATE.RECONNECTING) return "room.status.reconnecting";
		if (record.state === CONNECTION_STATE.ERROR) return "room.status.error";
		return "room.status.idle";
	}

	function rowState(record) {
		if (record.state === CONNECTION_STATE.CONNECTED) return directMode ? "direct" : "connected";
		if (record.state === CONNECTION_STATE.CONNECTING) return "connecting";
		if (record.state === CONNECTION_STATE.RECONNECTING) return "reconnecting";
		if (record.state === CONNECTION_STATE.ERROR) return "error";
		return "idle";
	}

	function updateRoomRow(record) {
		const view = record.nodes;
		if (!view) return;
		view.status.dataset.state = rowState(record);
		view.statusText.textContent = t(roomStateKey(record));
		view.meta.textContent = t("room.meta", {
			received: formatNumber(record.received),
			inPool: formatNumber(pool.sizeOfRoom(record.roomId)),
		});
		const active = manager.isActive(record.roomId) || record.state === CONNECTION_STATE.CONNECTING;
		view.button.dataset.i18n = active ? "room.remove" : "room.connectOne";
		view.button.textContent = t(active ? "room.remove" : "room.connectOne");
		view.button.dataset.role = active ? "remove" : "connect";
	}

	function renderRoomList() {
		clear(nodes.roomList);
		nodes.roomList.dataset.emptyText = t("room.listEmpty");
		nodes.roomCount.textContent = String(rooms.size);
		nodes.modeField.hidden = rooms.size < 2;

		for (const record of rooms.values()) {
			const statusText = el("span", { text: t(roomStateKey(record)) });
			const meta = el("span", { class: "row__meta" });
			const button = el("button", {
				class: "btn btn--tiny",
				type: "button",
				onClick: () => {
					if (button.dataset.role === "remove") removeRoom(record.roomId);
					else addRoom(record.roomId, { title: record.title });
				},
			});

			const row = el("li", { class: "row room-row", dataset: { room: record.roomId } }, [
				el("span", { class: "status", dataset: { state: "idle" } }, [el("i", { class: "dot" }), statusText]),
				el("div", { class: "row__main" }, [
					el("div", { class: "row__title", title: record.title, text: record.title }),
					meta,
				]),
				el("div", { class: "row__actions" }, [button]),
			]);

			record.nodes = { row, status: row.querySelector(".status"), statusText, meta, button };
			nodes.roomList.append(row);
			updateRoomRow(record);
		}
	}

	/** Everything the pool knows about rooms that are no longer monitored. */
	function prunePool() {
		for (const roomId of [...pool.byRoom.keys()]) {
			if (!rooms.has(roomId)) pool.removeRoom(roomId);
		}
	}

	function removeRoom(roomId) {
		const record = rooms.get(roomId);
		if (!record) return;
		manager.remove(roomId);
		rooms.delete(roomId);
		// Only this room's contribution leaves the pool; anybody who also spoke
		// in another room stays.
		pool.removeRoom(roomId);
		store.forgetRoom(roomId);
		renderRoomList();
		renderStats();
		renderRoomStatus();
		toast(t("room.removed", { id: roomId }), { kind: "info" });
	}

	/** Overall pill: how many of the monitored rooms are actually live. */
	function renderRoomStatus() {
		const list = manager.list();
		const total = rooms.size;
		if (total === 0) {
			nodes.roomStatus.dataset.state = "idle";
			nodes.roomStatusText.dataset.i18n = "room.status.idle";
			nodes.roomStatusText.textContent = t("room.status.idle");
			return;
		}
		const ok = manager.connectedCount();
		const vars = { ok, total };
		if (ok === total) {
			nodes.roomStatus.dataset.state = directMode ? "direct" : "connected";
			nodes.roomStatusText.textContent = t("room.status.connectedN", vars);
		} else if (list.some((record) => record.state === CONNECTION_STATE.RECONNECTING)) {
			nodes.roomStatus.dataset.state = "reconnecting";
			nodes.roomStatusText.textContent = t("room.status.reconnectingN", vars);
		} else if (list.some((record) => record.state === CONNECTION_STATE.CONNECTING)) {
			nodes.roomStatus.dataset.state = "connecting";
			nodes.roomStatusText.textContent = t("room.status.connectingN", vars);
		} else {
			nodes.roomStatus.dataset.state = "error";
			nodes.roomStatusText.textContent = t("room.status.errorN", vars);
		}
	}

	function handleRoomStatus(roomId, state, detail = {}) {
		const record = rooms.get(roomId);
		if (!record) return;
		record.state = state;
		updateRoomRow(record);
		renderRoomStatus();

		if (state === CONNECTION_STATE.CONNECTED) {
			nodes.roomHint.dataset.i18n = directMode ? "room.hint.direct" : "room.hint.connected";
			nodes.roomHint.textContent = t(directMode ? "room.hint.direct" : "room.hint.connected", {
				rooms: manager.connectedCount(),
			});
		} else if (state === CONNECTION_STATE.RECONNECTING) {
			nodes.roomHint.dataset.i18n = "room.hint.reconnecting";
			nodes.roomHint.textContent = t("room.hint.reconnecting", { id: roomId });
			if (detail.attempt === 3) toastWarn(t("err.wsGiveUp", { attempt: 3 }));
		} else if (state === CONNECTION_STATE.ERROR) {
			nodes.roomHint.dataset.i18n = "room.status.error";
			nodes.roomHint.textContent = t("err.roomInfo", { message: detail.reason || t("common.unknown") });
		}
		if (DEBUG) console.info("[draw] room", roomId, state, detail);
	}

	/* ---------------------------------------------------------------------- */
	/* Live danmaku log                                                       */
	/* ---------------------------------------------------------------------- */

	function appendLog(danmu, matched) {
		if (nodes.logList.dataset.empty === "true") {
			clear(nodes.logList);
			nodes.logList.dataset.empty = "false";
		}
		nodes.logList.dataset.rooms = String(rooms.size);

		const item = el("li", { class: `log__item${matched ? " is-hit" : ""}` }, [
			el("span", { class: "log__room", text: danmu.roomId }),
			el("span", { class: "log__user", title: `${danmu.name} (uid ${danmu.uid})`, text: danmu.name }),
			el("span", { class: "log__text", text: truncate(danmu.text, 180) }),
			matched ? el("span", { class: "log__badge", text: "+1" }) : null,
		]);

		nodes.logList.append(item);
		logNodes += 1;
		while (logNodes > MAX_LOG_NODES && nodes.logList.firstElementChild) {
			nodes.logList.firstElementChild.remove();
			logNodes -= 1;
		}

		if (nodes.logFollow.checked) nodes.logList.scrollTop = nodes.logList.scrollHeight;
	}

	function clearLog() {
		clear(nodes.logList);
		nodes.logList.append(el("li", { class: "log__empty", "data-i18n": "log.empty", text: t("log.empty") }));
		nodes.logList.dataset.empty = "true";
		nodes.logList.dataset.rooms = String(rooms.size);
		logNodes = 0;
	}

	/* ---------------------------------------------------------------------- */
	/* Danmaku -> merged pool                                                 */
	/* ---------------------------------------------------------------------- */

	function handleDanmaku(danmu) {
		if (DEBUG) console.info("[danmaku]", danmu.roomId, danmu.name, danmu.text);

		receivedTotal += 1;
		const record = rooms.get(danmu.roomId);
		if (record) {
			record.received += 1;
			updateRoomRow(record);
		}

		// One pool, several rooms: the entry is keyed by uid and remembers which
		// rooms it came from, so the same person is never counted twice.
		const result = running ? pool.ingest(danmu, keywords()) : { matched: false, isNew: false };

		appendLog(danmu, running && result.matched);
		renderStats();
		if (running && result.isNew) {
			window.clearTimeout(waitingTimer);
			setHint("draw.hint.running");
			updateRoomRow(record);
		}
	}

	/* ---------------------------------------------------------------------- */
	/* Adding rooms                                                           */
	/* ---------------------------------------------------------------------- */

	function placeholderRoom(roomId, title) {
		if (rooms.has(roomId)) return rooms.get(roomId);
		const record = { roomId, title: title || t("room.unknownTitle", { id: roomId }), received: 0, state: CONNECTION_STATE.CONNECTING };
		rooms.set(roomId, record);
		renderRoomList();
		renderRoomStatus();
		return record;
	}

	/**
	 * Resolve a room id into something connectable.
	 * When the relay is unreachable we cannot read the room info, but the
	 * danmaku socket is public — so we still go direct rather than refusing.
	 */
	async function resolveRoom(typedId) {
		try {
			return await fetchRoomInfo(typedId, { cookie: store.state.cookie });
		} catch (error) {
			if (!error?.offline) throw error;
			directMode = true;
			const remembered = store.activeSet()?.rooms?.find((room) => room.id === typedId);
			const realId = remembered?.id && remembered.id !== typedId ? remembered.id : typedId;
			toastWarn(t("err.directMode"));
			return {
				roomId: realId,
				title: t("room.unknownTitle", { id: realId }),
				uid: 0,
				liveStatus: 0,
				cover: "",
				offlineFetch: true,
			};
		}
	}

	async function addRoom(typedId, { title = "" } = {}) {
		const roomId = String(typedId);
		if (rooms.has(roomId) && manager.isActive(roomId)) return;

		placeholderRoom(roomId, title);
		pendingAdds += 1;
		setBusy(nodes.btnConnect, true);

		try {
			let info;
			try {
				info = await resolveRoom(roomId);
			} catch (error) {
				const record = rooms.get(roomId);
				if (record) {
					record.state = CONNECTION_STATE.ERROR;
					updateRoomRow(record);
				}
				nodes.roomHint.dataset.i18n = "room.hint";
				nodes.roomHint.textContent = t("err.roomInfo", { message: describeError(error) || t("common.unknown") });
				toastApiError(error);
				return;
			}

			// A short id resolves to the real room id; move the row over.
			if (info.roomId !== roomId) {
				rooms.delete(roomId);
				placeholderRoom(info.roomId, info.title);
			}
			const record = rooms.get(info.roomId);
			record.title = info.title;
			record.offline = Boolean(info.offlineFetch);

			let danmu;
			try {
				danmu = await fetchDanmuInfo(info.roomId, { cookie: store.state.cookie });
			} catch (error) {
				console.warn("[draw] getDanmuInfo refused, trying the public hosts", error);
				danmu = { token: "", hosts: DEFAULT_DANMU_HOSTS, fallback: true };
				toastWarn(t("err.danmuFallback", { message: describeError(error) || t("common.unknown") }));
			}

			await manager.add({
				roomId: info.roomId,
				title: info.title,
				token: danmu.token,
				hosts: danmu.hosts,
				uid: store.state.user?.mid || 0,
				cookie: store.state.cookie,
			});

			store.rememberRoom(info.roomId, info.title);
			renderRoomList();
			renderRoomStatus();
			toastOk(t("room.added", { id: info.roomId, title: info.title }));
		} finally {
			pendingAdds -= 1;
			setBusy(nodes.btnConnect, pendingAdds > 0);
		}
	}

	async function addFromInput() {
		const typed = parseRoomId(nodes.roomInput.value);
		if (!typed) {
			toastWarn(t("err.badRoom"));
			nodes.roomInput.focus();
			return;
		}
		if (rooms.has(typed) && manager.isActive(typed)) {
			toastWarn(t("err.roomAlready", { id: typed }));
			return;
		}
		nodes.roomInput.value = "";
		await addRoom(typed);
	}

	/* ---------------------------------------------------------------------- */
	/* Draw                                                                   */
	/* ---------------------------------------------------------------------- */

	function activeRoomIds() {
		return manager
			.list()
			.filter((record) => record.state === CONNECTION_STATE.CONNECTED || record.state === CONNECTION_STATE.RECONNECTING)
			.map((record) => record.roomId);
	}

	function canDraw() {
		return activeRoomIds().length > 0;
	}

	function startRunning() {
		if (!canDraw()) {
			toastWarn(t("draw.hint.noRoom"));
			return;
		}

		// A draw is one round: a fresh pool every time, so the second round only
		// counts the danmaku that arrived after it started.
		if (pool.size > 0) {
			const previous = pool.size;
			pool.reset();
			renderStats();
			renderRoomList();
			toast(t("draw.roundReset", { size: formatNumber(previous) }), { kind: "info" });
		}
		round += 1;

		running = true;
		nodes.btnDraw.dataset.active = "true";
		nodes.btnDrawLabel.dataset.i18n = "draw.stop";
		nodes.btnDrawLabel.textContent = t("draw.stop");
		nodes.poolStatus.dataset.state = "running";
		nodes.poolStatusText.dataset.i18n = "draw.status.running";
		nodes.poolStatusText.textContent = t("draw.status.running");
		setHint(drawMode === "perRoom" && rooms.size > 1 ? "draw.hint.runningPerRoom" : "draw.hint.running");

		window.clearTimeout(waitingTimer);
		waitingTimer = window.setTimeout(() => {
			if (running && pool.size === 0) setHint("draw.hint.waiting");
		}, 8000);
	}

	function stopRunning({ silent = false } = {}) {
		running = false;
		window.clearTimeout(waitingTimer);
		nodes.btnDraw.dataset.active = "false";
		nodes.btnDrawLabel.dataset.i18n = "draw.start";
		nodes.btnDrawLabel.textContent = t("draw.start");
		nodes.poolStatus.dataset.state = "idle";
		nodes.poolStatusText.dataset.i18n = "draw.status.idle";
		nodes.poolStatusText.textContent = t("draw.status.idle");
		if (!silent) setHint("draw.hint.idle");
	}

	function buildRecord() {
		const requested = readCount();
		const roomIds = activeRoomIds();
		const perRoom = drawMode === "perRoom" && roomIds.length > 1;
		const base = {
			at: Date.now(),
			keywords: nodes.keywords.value.trim(),
			roomIds,
			roomTitle: rooms.size === 1 ? [...rooms.values()][0].title : t("room.n", { n: rooms.size }),
			mode: perRoom ? "perRoom" : "merged",
		};

		if (perRoom) {
			const groups = pool.drawPerRoom(roomIds, requested);
			const winners = groups.flatMap((group) => group.winners);
			return {
				...base,
				groups: groups.map((group) => ({
					roomId: group.roomId,
					size: group.poolSize,
					winners: group.winners.map((winner) => ({ uid: winner.uid, name: winner.name, count: winner.count })),
				})),
				winners: winners.map((winner) => ({ uid: winner.uid, name: winner.name, count: winner.count, roomId: winner.roomId })),
				size: groups.reduce((sum, group) => sum + group.poolSize, 0),
				count: winners.length,
				short: groups.some((group) => group.short),
			};
		}

		const result = pool.draw(requested);
		return {
			...base,
			size: result.poolSize,
			count: result.winners.length,
			short: result.short,
			winners: result.winners.map((winner) => ({
				uid: winner.uid,
				name: winner.name,
				count: winner.count,
				rooms: [...(winner.rooms || [])],
			})),
		};
	}

	async function finishRunning() {
		if (pool.size === 0) {
			toastWarn(t("err.noPool"));
			setHint("draw.hint.waiting");
			return;
		}

		const wanted = `${readCount()}`;
		const record = buildRecord();
		stopRunning();
		showRollModal(record);
		renderWinners(record);
		store.addHistory(record);
		lastRecord = record;

		if (record.short) toastWarn(t("err.poolTooSmall", { size: record.size, count: wanted }));
	}

	function toggleRunning() {
		if (running) finishRunning();
		else startRunning();
	}

	function renderWinners(record) {
		clear(nodes.winnersList);
		nodes.cardWinners.hidden = false;
		nodes.winnersCount.textContent = String(record.winners.length);

		const appendWinner = (winner, index, roomId) => {
			nodes.winnersList.append(
				el("li", { class: `winner${index === 0 ? " is-top" : ""}`, style: { animationDelay: `${index * 45}ms` } }, [
					el("span", { class: "winner__rank", text: String(index + 1) }),
					el("span", { class: "winner__name", title: winner.name, text: winner.name }),
					winner.count > 1 ? el("span", { class: "tag", text: `×${winner.count}` }) : null,
					roomId ? el("span", { class: "tag", text: roomId }) : null,
					el("span", { class: "winner__uid", text: winner.uid ? `uid ${winner.uid}` : "" }),
				]),
			);
		};

		if (record.mode === "perRoom" && record.groups) {
			for (const group of record.groups) {
				const title = rooms.get(group.roomId)?.title || t("room.unknownTitle", { id: group.roomId });
				nodes.winnersList.append(
					el("li", { class: "winner__group", text: `${title} · ${group.roomId}` }),
				);
				group.winners.forEach((winner, index) => appendWinner(winner, index, ""));
			}
		} else {
			record.winners.forEach((winner, index) => appendWinner(winner, index, winner.rooms?.[0]));
		}

		nodes.winnersMeta.textContent = t("winners.meta", {
			size: record.size,
			keywords: record.keywords || t("sets.all"),
			time: formatTime(record.at),
		});
	}

	function winnerCard(winner, index) {
		return el("li", { class: `winner${index === 0 ? " is-top" : ""}`, style: { animationDelay: `${index * 60}ms` } }, [
			el("span", { class: "winner__rank", text: String(index + 1) }),
			el("span", { class: "winner__name", text: winner.name }),
			roomName(winner) ? el("span", { class: "tag", text: roomName(winner) }) : null,
			el("span", { class: "winner__uid", text: winner.uid ? `uid ${winner.uid}` : "" }),
		]);
	}

	function roomName(winner) {
		const id = winner.roomId || winner.rooms?.[0];
		if (!id) return "";
		return rooms.get(id)?.title || id;
	}

	function showRollModal(record) {
		const body = el("div", { class: "roll" }, [
			el("div", { class: "roll__spinner" }),
			el("p", { class: "roll__text", text: t("roll.text", { size: record.size, count: record.count }) }),
		]);

		const modal = openModal({
			title: t("roll.title"),
			body,
			actions: [{ label: t("common.close"), close: false, onClick: (event, instance) => instance.close() }],
		});

		celebrate();

		window.setTimeout(() => {
			modal.setTitle(t("winners.title"));
			const list = el("ol", { class: "winners" });
			if (record.mode === "perRoom" && record.groups) {
				for (const group of record.groups) {
					list.append(el("li", { class: "winner__group", text: `${rooms.get(group.roomId)?.title || group.roomId} · ${group.roomId}` }));
					group.winners.forEach((winner, index) => list.append(winnerCard(winner, index)));
				}
			} else {
				record.winners.forEach((winner, index) => list.append(winnerCard(winner, index)));
			}
			modal.setBody(list);
		}, 900);
	}

	function celebrate() {
		const palette = ["#fb7299", "#8b5cf6", "#2f9ee0", "#12b981", "#f79009"];
		const layer = el("div", { class: "confetti" });
		for (let i = 0; i < 70; i += 1) {
			layer.append(
				el("i", {
					style: {
						left: `${Math.random() * 100}%`,
						background: palette[i % palette.length],
						animationDuration: `${1.5 + Math.random() * 1.6}s`,
						animationDelay: `${Math.random() * 0.45}s`,
						"--dx": `${(Math.random() - 0.5) * 160}px`,
						"--rot": `${(Math.random() - 0.5) * 1200}deg`,
					},
				}),
			);
		}
		document.body.append(layer);
		window.setTimeout(() => layer.remove(), 3600);
	}

	function resetPool() {
		pool.reset();
		clearLog();
		renderStats();
		renderRoomList();
		nodes.cardWinners.hidden = true;
		clear(nodes.winnersList);
		lastRecord = null;
		toast(t("draw.reset"), { kind: "info" });
	}

	/* ---------------------------------------------------------------------- */
	/* Wiring                                                                 */
	/* ---------------------------------------------------------------------- */

	function setDrawMode(mode) {
		drawMode = mode === "perRoom" ? "perRoom" : "merged";
		for (const tab of nodes.modeTabs.querySelectorAll("[data-draw-mode]")) {
			tab.classList.toggle("is-active", tab.dataset.drawMode === drawMode);
		}
		nodes.modeHint.textContent = t(drawMode === "perRoom" ? "draw.modeHintPerRoom" : "draw.modeHintMerged", {
			count: readCount(),
			rooms: rooms.size,
		});
		if (running) setHint(drawMode === "perRoom" && rooms.size > 1 ? "draw.hint.runningPerRoom" : "draw.hint.running");
	}

	function syncFromStore() {
		const set = store.activeSet();
		if (!set) return;
		nodes.keywords.value = set.keywords || "";
		nodes.count.value = String(set.winners || 1);

		// Rooms come back as rows in the "not connected" state: the list is part
		// of the preset, but reconnecting should be a deliberate click.
		for (const room of set.rooms || []) {
			if (rooms.has(room.id)) continue;
			rooms.set(room.id, {
				roomId: room.id,
				title: room.title || t("room.unknownTitle", { id: room.id }),
				received: 0,
				state: CONNECTION_STATE.IDLE,
			});
		}
		renderRoomList();
		renderRoomStatus();
		setDrawMode(drawMode);
	}

	function wire() {
		nodes.btnConnect.addEventListener("click", addFromInput);
		nodes.btnDraw.addEventListener("click", toggleRunning);
		nodes.btnReset.addEventListener("click", resetPool);

		nodes.roomInput.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				addFromInput();
			}
		});

		for (const tab of nodes.modeTabs.querySelectorAll("[data-draw-mode]")) {
			tab.addEventListener("click", () => setDrawMode(tab.dataset.drawMode));
		}

		let saveTimer = 0;
		const persist = () => {
			window.clearTimeout(saveTimer);
			saveTimer = window.setTimeout(() => {
				store.updateActiveSet({ keywords: nodes.keywords.value, winners: readCount() }, "preset-edited");
			}, 350);
		};
		nodes.keywords.addEventListener("input", persist);
		nodes.count.addEventListener("change", persist);
		nodes.count.addEventListener("change", () => setDrawMode(drawMode));

		nodes.btnCopyWinners.addEventListener("click", async () => {
			if (!lastRecord) return;
			await copyText(winnersToText(lastRecord));
			toastOk(t("common.copied"));
		});
		nodes.btnExportWinners.addEventListener("click", () => {
			if (lastRecord) downloadRecord(lastRecord);
		});

		clearLog();
		renderStats();
		renderRoomList();
		renderRoomStatus();
		setHint("draw.hint.idle");
		setDrawMode("merged");
		syncFromStore();
	}

	return {
		wire,
		syncFromStore,
		onLanguageChange: () => {
			renderRoomList();
			renderRoomStatus();
			setHint(running ? "draw.hint.running" : "draw.hint.idle");
			setDrawMode(drawMode);
			if (lastRecord) renderWinners(lastRecord);
		},
		isRunning: () => running,
	};
}
