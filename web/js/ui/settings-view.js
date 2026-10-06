/**
 * Settings view: presets, history, appearance.
 * Pure rendering off `store`; the only writes it makes are store patches.
 */

import { $, clear, copyText, el, formatTime, relativeTime } from "../util.js";
import { t } from "../i18n.js";
import { ACCENTS, store } from "../store.js";
import { downloadRecord, winnersToText } from "../exporter.js";
import { confirmDialog, openModal } from "./modal.js";
import { toast, toastError, toastOk } from "./toast.js";

export function createSettingsView({ onLanguageChange, onThemeChange } = {}) {
	const nodes = {
		setList: $("#set-list"),
		historyList: $("#history-list"),
		swatches: $("#accent-swatches"),
		accentCustom: $("#accent-custom"),
		accentPicker: $("#accent-picker"),
		bgFile: $("#bg-file"),
		langSelect: $("#lang-select"),
	};

	const PRESET_HEX = {
		pink: "#fb7299",
		violet: "#8b5cf6",
		ocean: "#2f9ee0",
		mint: "#12b981",
	};

	/* ---------------------------------------------------------------------- */
	/* Presets                                                                */
	/* ---------------------------------------------------------------------- */

	function presetTitle(set, index) {
		return set.name?.trim() || t("sets.defaultName", { n: index + 1 });
	}

	function renderSets() {
		clear(nodes.setList);
		const { sets, activeSetId } = store.state;
		nodes.setList.dataset.emptyText = t("sets.empty");

		sets.forEach((set, index) => {
			const active = set.id === activeSetId;
			const meta = el("div", { class: "row__meta" }, [
				el("span", { text: t("sets.keywords", { value: set.keywords?.trim() || t("sets.all") }) }),
				el("span", { text: t("sets.winners", { n: set.winners }) }),
				el("span", {
					text: set.rooms?.length
						? t("sets.roomsList", { n: set.rooms.length, list: set.rooms.map((room) => room.id).join("、") })
						: t("sets.noRoom"),
				}),
			]);

			const row = el("li", { class: `row${active ? " is-active" : ""}` }, [
				el("div", { class: "row__main" }, [
					el("div", { class: "row__title" }, [
						document.createTextNode(presetTitle(set, index)),
						active ? el("span", { class: "tag tag--accent", text: t("sets.active"), style: { marginLeft: "8px" } }) : null,
					]),
					meta,
				]),
				el("div", { class: "row__actions" }, [
					el("button", {
						class: "btn btn--tiny",
						type: "button",
						text: t("sets.use"),
						disabled: active,
						onClick: () => store.selectSet(set.id),
					}),
					el("button", {
						class: "btn btn--tiny",
						type: "button",
						text: t("sets.rename"),
						onClick: () => renameSet(set, index),
					}),
					el("button", {
						class: "btn btn--tiny",
						type: "button",
						text: t("sets.delete"),
						disabled: sets.length <= 1,
						onClick: () => removeSet(set, index),
					}),
				]),
			]);

			row.addEventListener("dblclick", () => store.selectSet(set.id));
			nodes.setList.append(row);
		});
	}

	function renameSet(set, index) {
		const input = el("input", { type: "text", value: set.name || presetTitle(set, index), maxLength: 40 });
		const wrapper = el("label", { class: "field" }, [
			el("span", { class: "field__label", text: t("sets.rename") }),
			input,
		]);
		openModal({
			title: t("sets.rename"),
			body: wrapper,
			actions: [
				{ label: t("confirm.cancel") },
				{
					label: t("confirm.ok"),
					kind: "primary",
					onClick: () => {
						store.renameSet(set.id, input.value.trim());
					},
				},
			],
		});
		window.requestAnimationFrame(() => input.select());
	}

	async function removeSet(set, index) {
		const ok = await confirmDialog({
			text: `${t("sets.delete")} 「${presetTitle(set, index)}」 ?`,
			ok: t("sets.delete"),
		});
		if (ok) store.removeSet(set.id);
	}

	/* ---------------------------------------------------------------------- */
	/* History                                                                */
	/* ---------------------------------------------------------------------- */

	function renderHistory() {
		clear(nodes.historyList);
		const { history } = store.state;
		nodes.historyList.dataset.emptyText = t("history.empty");

		for (const record of history) {
			const names = record.winners.map((winner) => winner.name).join("、");
			nodes.historyList.append(
				el("li", { class: "row" }, [
					el("div", { class: "row__main" }, [
						el("div", { class: "row__title", title: names, text: record.winners.length ? names : "—" }),
						el("div", { class: "row__meta" }, [
							el("span", { text: t("history.meta", { time: relativeTime(record.at), size: record.size, count: record.winners.length }) }),
							el("span", { text: t("history.keywords", { value: record.keywords || t("sets.all") }) }),
						]),
					]),
					el("div", { class: "row__actions" }, [
						el("button", {
							class: "btn btn--tiny",
							type: "button",
							text: t("history.view"),
							onClick: () => viewRecord(record),
						}),
						el("button", {
							class: "btn btn--tiny",
							type: "button",
							text: t("history.export"),
							onClick: () => downloadRecord(record),
						}),
						el("button", {
							class: "btn btn--tiny",
							type: "button",
							text: t("history.delete"),
							onClick: () => store.removeHistory(record.id),
						}),
					]),
				]),
			);
		}
	}

	function recordBody(record) {
		const list = el("ol", { class: "winners" });
		const push = (winner, index) => {
			list.append(
				el("li", { class: `winner${index === 0 ? " is-top" : ""}` }, [
					el("span", { class: "winner__rank", text: String(index + 1) }),
					el("span", { class: "winner__name", text: winner.name }),
					el("span", { class: "winner__uid", text: winner.uid ? `uid ${winner.uid}` : "" }),
				]),
			);
		};
		if (record.groups?.length) {
			for (const group of record.groups) {
				list.append(el("li", { class: "winner__group", text: `${group.roomId} · ${group.winners.length} 人` }));
				group.winners.forEach(push);
			}
		} else {
			record.winners.forEach(push);
		}
		const wrapper = el("div", {}, [
			el("p", { class: "hint", text: t("winners.meta", {
				size: record.size,
				keywords: record.keywords || t("sets.all"),
				time: formatTime(record.at),
			}) }),
			list,
		]);
		return wrapper;
	}

	function viewRecord(record) {
		openModal({
			title: t("winners.title"),
			body: recordBody(record),
			actions: [
				{
					label: t("common.copy"),
					close: false,
					onClick: async () => {
						await copyText(winnersToText(record));
						toastOk(t("common.copied"));
					},
				},
				{
					label: t("history.export"),
					close: false,
					onClick: () => downloadRecord(record),
				},
				{
					label: t("common.close"),
					kind: "primary",
				},
			],
		});
	}

	/* ---------------------------------------------------------------------- */
	/* Appearance                                                             */
	/* ---------------------------------------------------------------------- */

	function renderSwatches() {
		clear(nodes.swatches);
		for (const accent of ACCENTS) {
			nodes.swatches.append(
				el("button", {
					class: `swatch${store.state.accent === accent ? " is-active" : ""}`,
					type: "button",
					dataset: { accentValue: accent },
					"aria-label": accent,
					onClick: () => {
						store.patch({ accent }, "appearance");
						renderSwatches();
					},
				}),
			);
		}

		const custom = !ACCENTS.includes(store.state.accent);
		if (nodes.accentPicker) {
			nodes.accentPicker.classList.toggle("is-active", custom);
			nodes.accentPicker.style.background = custom ? store.state.accent : "";
		}
		if (nodes.accentCustom) {
			nodes.accentCustom.value = custom
				? store.state.accent
				: PRESET_HEX[store.state.accent] || PRESET_HEX.pink;
		}
	}

	/**
	 * Downscale before persisting: a 12MP photo would blow the 5MB
	 * localStorage budget, and a wallpaper never needs to be that big.
	 */
	async function loadImageFile(file) {
		const bitmap = await createImageBitmap(file);
		const maxWidth = 1920;
		const scale = Math.min(1, maxWidth / bitmap.width);
		const canvas = el("canvas");
		canvas.width = Math.round(bitmap.width * scale);
		canvas.height = Math.round(bitmap.height * scale);
		canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		bitmap.close?.();
		return canvas.toDataURL("image/jpeg", 0.82);
	}

	/* ---------------------------------------------------------------------- */
	/* Wiring                                                                 */
	/* ---------------------------------------------------------------------- */

	function wire() {
		$("#btn-set-create")?.addEventListener("click", () => {
			store.createSet({
				keywords: $("#draw-keywords")?.value || "",
				winners: Number.parseInt($("#draw-count")?.value, 10) || 1,
			});
			toastOk(t("sets.create"));
		});

		$("#btn-history-clear")?.addEventListener("click", async () => {
			if (!store.state.history.length) return;
			const ok = await confirmDialog({ text: t("history.clearAll"), ok: t("history.clearAll") });
			if (!ok) return;
			store.clearHistory();
			toastOk(t("history.cleared"));
		});

		$("#btn-bg-pick")?.addEventListener("click", () => nodes.bgFile.click());
		nodes.bgFile?.addEventListener("change", async () => {
			const file = nodes.bgFile.files?.[0];
			nodes.bgFile.value = "";
			if (!file) return;
			try {
				const dataUrl = await loadImageFile(file);
				if (store.setWallpaper(dataUrl)) toastOk(t("appearance.bgSaved"));
				else toastError(t("appearance.bgFailed"));
			} catch (error) {
				console.warn("[wallpaper] failed", error);
				toastError(t("appearance.bgFailed"));
			}
		});

		$("#btn-bg-clear")?.addEventListener("click", () => {
			store.setWallpaper("");
			toastOk(t("appearance.bgCleared"));
		});

		nodes.accentCustom?.addEventListener("input", () => {
			store.patch({ accent: nodes.accentCustom.value }, "appearance");
			renderSwatches();
		});

		nodes.langSelect?.addEventListener("change", () => {
			store.patch({ lang: nodes.langSelect.value }, "lang");
			onLanguageChange?.();
		});

		// Scoped to the buttons: `[data-theme-mode]` alone also matched <html>
		// back when the root carried that attribute, which attached this
		// handler to the document and re-applied the theme on every click.
		for (const button of document.querySelectorAll(".theme-mode-btn")) {
			button.addEventListener("click", () => {
				store.patch({ themeMode: button.dataset.themeMode }, "theme");
				onThemeChange?.();
			});
		}
	}

	function refresh() {
		renderSets();
		renderHistory();
		renderSwatches();
		if (nodes.langSelect) nodes.langSelect.value = store.state.lang;
		for (const button of document.querySelectorAll(".theme-mode-btn")) {
			button.classList.toggle("is-active", button.dataset.themeMode === store.state.themeMode);
		}
	}

	return { wire, refresh };
}
