/** Stacking, self-dismissing notifications. */

import { el } from "../util.js";
import { t } from "../i18n.js";

const MAX_VISIBLE = 4;

function container() {
	return document.getElementById("toasts");
}

/**
 * @param {string} text    body copy
 * @param {object} options { kind: 'info'|'ok'|'warn'|'error', title, timeout }
 */
export function toast(text, options = {}) {
	const { kind = "info", title, timeout = kind === "error" ? 7000 : 4200 } = options;
	const root = container();
	if (!root) return () => {};

	const node = el("div", { class: "toast", dataset: { kind }, role: kind === "error" ? "alert" : "status" }, [
		el("div", { class: "toast__body" }, [
			el("div", { class: "toast__title", text: title ?? t(`toast.${kind === "ok" ? "ok" : kind}`) }),
			el("div", { class: "toast__text", text }),
		]),
		el("button", {
			class: "toast__close",
			type: "button",
			"aria-label": t("common.close"),
			text: "×",
			onClick: () => dismiss(),
		}),
	]);

	root.append(node);
	while (root.children.length > MAX_VISIBLE) root.firstElementChild.remove();

	let timer = window.setTimeout(dismiss, timeout);

	function dismiss() {
		window.clearTimeout(timer);
		if (!node.isConnected) return;
		node.classList.add("is-leaving");
		window.setTimeout(() => node.remove(), 240);
	}

	return dismiss;
}

export const toastOk = (text, options) => toast(text, { ...options, kind: "ok" });
export const toastWarn = (text, options) => toast(text, { ...options, kind: "warn" });
export const toastError = (text, options) => toast(text, { ...options, kind: "error" });

/** Turn an ApiError (or anything else) into a readable toast. */
export function toastApiError(error, fallbackKey = "err.network") {
	const raw = error?.message || "";
	let message = raw;

	if (error?.offline || raw === "offline") message = t("err.offline");
	else if (raw === "network") message = t("err.network");
	else if (raw === "timeout") message = t("err.network");
	else if (raw === "bad room id") message = t("err.badRoom");
	else if (raw === "not logged in") message = t("err.badCookie");
	else if (raw === "no danmaku host") message = t("err.danmuInfo");
	else if (!message) message = t(fallbackKey);

	return toastError(message);
}
