/** A single reusable modal + a confirm helper built on top of it. */

import { $, clear, el } from "../util.js";
import { t } from "../i18n.js";

let openInstance = null;

/**
 * @param {object} config
 * @param {string} config.title
 * @param {Node|string} config.body
 * @param {Array}  [config.actions]  [{ label, kind, onClick, close }]
 * @param {boolean}[config.dismissible=true]
 * @param {Function}[config.onClose]
 */
export function openModal(config) {
	const { title, body, actions = [], dismissible = true, onClose } = config;
	const root = $("#modal-root");
	// Non-silent: if another modal was open, its promise should settle.
	closeModal();
	clear(root);

	const modal = el("div", { class: "modal", role: "dialog", "aria-modal": "true" });
	const head = el("header", { class: "modal__head" }, [el("h2", { text: title })]);
	const bodyNode = el("div", { class: "modal__body" });
	if (body instanceof Node) bodyNode.append(body);
	else if (typeof body === "string") bodyNode.innerHTML = body;

	const foot = el("footer", { class: "modal__foot" });
	const instance = {
		root,
		modal,
		close: () => closeModal(),
		setTitle: (text) => {
			head.querySelector("h2").textContent = text;
		},
		setBody: (node) => {
			clear(bodyNode);
			if (node instanceof Node) bodyNode.append(node);
			else bodyNode.innerHTML = String(node);
		},
	};

	for (const action of actions) {
		foot.append(
			el("button", {
				class: `btn ${action.kind === "primary" ? "btn--primary" : action.kind === "tiny" ? "btn--tiny" : "btn--ghost"}`,
				type: "button",
				text: action.label,
				onClick: (event) => {
					const result = action.onClick?.(event, instance);
					if (action.close !== false && result !== false) closeModal();
				},
			}),
		);
	}

	if (!actions.length) {
		head.append(
			el("div", { class: "card__tools" }, [
				el("button", {
					class: "btn btn--tiny",
					type: "button",
					text: t("common.close"),
					onClick: () => closeModal(),
				}),
			]),
		);
	}

	modal.append(head, bodyNode, foot);
	root.append(el("div", { class: "modal__backdrop" }), modal);
	root.classList.add("is-open");
	openInstance = { ...instance, onClose, dismissible };

	root.querySelector(".modal__backdrop").addEventListener("click", () => {
		if (dismissible) closeModal();
	});

	const onKey = (event) => {
		if (event.key === "Escape" && dismissible) closeModal();
	};
	document.addEventListener("keydown", onKey);
	openInstance.removeKeyHandler = () => document.removeEventListener("keydown", onKey);

	// Focus the first actionable control so keyboard users land inside.
	window.requestAnimationFrame(() => {
		modal.querySelector("button:not([disabled])")?.focus({ preventScroll: true });
	});

	return instance;
}

export function closeModal({ silent = false } = {}) {
	const current = openInstance;
	openInstance = null;
	if (!current) return;
	current.removeKeyHandler?.();
	current.root.classList.remove("is-open");
	if (!silent) current.onClose?.();
	window.setTimeout(() => {
		if (!openInstance) clear(current.root);
	}, 200);
}

export const isModalOpen = () => Boolean(openInstance);

/** Promise based confirm dialog. */
export function confirmDialog({ title = t("confirm.title"), text, ok = t("confirm.ok"), cancel = t("confirm.cancel") } = {}) {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (value) => {
			if (settled) return;
			settled = true;
			resolve(value);
		};

		openModal({
			title,
			body: el("p", { class: "hint", text }),
			dismissible: true,
			onClose: () => finish(false),
			actions: [
				{ label: cancel, onClick: () => finish(false) },
				{ label: ok, kind: "primary", onClick: () => finish(true) },
			],
		});
	});
}
