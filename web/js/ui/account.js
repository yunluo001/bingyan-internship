/**
 * Account panel: cookie login, QR login, session display.
 * Owns `store.state.cookie` / `store.state.user`; everything else reads them
 * through the store.
 */

import { $, el, setAvatarImage } from "../util.js";
import { t } from "../i18n.js";
import {
	SESSION_EXPIRED_EVENT,
	fetchMyInfo,
	normalizeCookieInput,
	qrGenerate,
	qrPoll,
} from "../api.js";
import { looksLikeImageSource, qrDataUrl } from "../qrcode.js";
import { store } from "../store.js";
import { toastApiError, toastError, toastOk, toastWarn } from "./toast.js";

const POLL_INTERVAL = 2000;

export function createAccountController({ onUser }) {
	const nodes = {
		chip: $("#btn-account"),
		chipAvatar: $("#account-avatar"),
		chipName: $("#account-name"),
		idle: $("#account-idle"),
		user: $("#account-user"),
		userAvatar: $("#account-user-avatar"),
		userName: $("#account-user-name"),
		userMid: $("#account-user-mid"),
		qrImage: $("#qr-image"),
		qrPlaceholder: $("#qr-placeholder"),
		qrMask: $("#qr-mask"),
		qrMaskText: $("#qr-mask-text"),
		qrStatus: $("#qr-status"),
		cookieInput: $("#cookie-input"),
	};

	let pollTimer = 0;
	let currentKey = "";
	let pollBusy = false;
	let currentUrl = "";

	function setQrStatus(key, state) {
		nodes.qrStatus.dataset.i18n = key;
		nodes.qrStatus.textContent = t(key);
		if (state) nodes.qrStatus.dataset.state = state;
		else delete nodes.qrStatus.dataset.state;
	}

	function stopPolling() {
		window.clearTimeout(pollTimer);
		pollTimer = 0;
		pollBusy = false;
	}

	function showQrPlaceholder() {
		nodes.qrImage.hidden = true;
		nodes.qrImage.removeAttribute("src");
		nodes.qrPlaceholder.hidden = false;
		nodes.qrMask.hidden = true;
		nodes.qrPlaceholder.replaceChildren(
			el("button", {
				class: "btn btn--primary",
				id: "btn-qr-create",
				type: "button",
				text: t("account.qrCreate"),
				onClick: createQr,
			}),
		);
	}

	function maskQr(textKey) {
		nodes.qrMask.hidden = false;
		nodes.qrMaskText.textContent = t(textKey);
	}

	async function createQr() {
		stopPolling();
		nodes.qrPlaceholder.hidden = true;
		nodes.qrMask.hidden = true;
		nodes.qrImage.hidden = false;
		setQrStatus("account.qrWaiting");

		try {
			const { url, key } = await qrGenerate();
			currentKey = key;
			currentUrl = url;
			renderQr(url);
			schedulePoll();
		} catch (error) {
			stopPolling();
			showQrPlaceholder();
			setQrStatus("account.qrIdle");
			toastApiError(error);
		}
	}

	/**
	 * bilibili hands back the *content* to encode (a passport URL holding the
	 * qrcode_key), not an image, so we draw the symbol ourselves. A server that
	 * does return an image URL (like the offline mock) still works.
	 */
	function renderQr(source) {
		nodes.qrImage.hidden = false;
		nodes.qrImage.onerror = null;
		nodes.qrMask.hidden = true;
		nodes.qrPlaceholder.hidden = true;

		if (looksLikeImageSource(source)) {
			nodes.qrImage.src = source;
			nodes.qrImage.onerror = () => showQrFallback(source);
			return;
		}

		try {
			nodes.qrImage.src = qrDataUrl(source, { margin: 4, scale: 4 });
		} catch (error) {
			console.warn("[qr] could not encode login url", error);
			showQrFallback(source);
		}
	}

	function showQrFallback(source) {
		nodes.qrImage.hidden = true;
		nodes.qrImage.removeAttribute("src");
		nodes.qrPlaceholder.hidden = false;
		nodes.qrPlaceholder.replaceChildren(
			el("a", {
				class: "btn btn--primary",
				href: source,
				target: "_blank",
				rel: "noreferrer",
				text: t("account.qrOpen"),
			}),
		);
	}

	function schedulePoll(delay = POLL_INTERVAL) {
		window.clearTimeout(pollTimer);
		pollTimer = window.setTimeout(poll, delay);
	}

	async function poll() {
		if (!currentKey || pollBusy) return;
		pollBusy = true;
		try {
			const result = await qrPoll(currentKey, { cookie: store.state.cookie });
			if (result.state === "success") {
				stopPolling();
				currentKey = "";
				maskQr("account.qrSuccess");
				setQrStatus("account.qrSuccess", "ok");
				await adoptCookie(result.cookie || store.state.cookie);
				return;
			}
			if (result.state === "scanned") {
				setQrStatus("account.qrScanned", "ok");
			} else if (result.state === "expired") {
				stopPolling();
				currentKey = "";
				maskQr("account.qrExpired");
				setQrStatus("account.qrExpired", "error");
				return;
			}
			schedulePoll();
		} catch (error) {
			// A single failed poll is not fatal; keep trying until expired.
			console.warn("[qr] poll failed", error);
			schedulePoll(POLL_INTERVAL * 2);
		} finally {
			pollBusy = false;
		}
	}

	/** Verify a cookie against `/x/space/myinfo` and persist the session. */
	async function adoptCookie(rawCookie) {
		const cookie = normalizeCookieInput(rawCookie);
		if (!cookie) {
			toastError(t("err.badCookie"));
			return false;
		}
		try {
			const user = await fetchMyInfo(cookie);
			store.saveSession(cookie, user);
			stopPolling();
			render();
			onUser?.(user);
			toastOk(`${t("account.loggedIn")}: ${user.name}`);
			return true;
		} catch (error) {
			if (error?.code !== -101) toastApiError(error, "err.badCookie");
			return false;
		}
	}

	function logout() {
		stopPolling();
		currentKey = "";
		store.clearSession();
		showQrPlaceholder();
		setQrStatus("account.qrIdle");
		render();
		onUser?.(null);
	}

	/**
	 * Validate the stored cookie on boot and after a long idle period.
	 * A -101 from any request clears the session through SESSION_EXPIRED_EVENT.
	 */
	async function validateSession() {
		const { cookie, user } = store.state;
		if (!cookie) {
			render();
			return false;
		}
		if (user && !store.needsSessionCheck()) {
			render();
			return true;
		}
		try {
			const fresh = await fetchMyInfo(cookie);
			store.saveSession(cookie, fresh);
			render();
			onUser?.(fresh);
			return true;
		} catch (error) {
			// -101 is handled by the session-expired listener; offline or
			// transient errors keep the current session untouched.
			console.warn("[account] session check failed", error);
			return false;
		}
	}

	function render() {
		const { user } = store.state;
		if (user) {
			nodes.idle.hidden = true;
			nodes.user.hidden = false;
			nodes.userName.textContent = user.name;
			nodes.userMid.textContent = `uid ${user.mid}`;
			nodes.chipAvatar.hidden = false;
			nodes.chipName.textContent = user.name;
			delete nodes.chipName.dataset.i18n;
			// bilibili's CDN blocks hot-linking, so both avatars carry
			// referrerpolicy=no-referrer and fall back to a generated initial.
			setAvatarImage(nodes.userAvatar, user.face, user.name);
			setAvatarImage(nodes.chipAvatar, user.face, user.name);
		} else {
			nodes.idle.hidden = false;
			nodes.user.hidden = true;
			nodes.chipAvatar.hidden = true;
			nodes.chipAvatar.onerror = null;
			nodes.chipAvatar.removeAttribute("src");
			nodes.chipName.dataset.i18n = "account.anonymous";
			nodes.chipName.textContent = t("account.anonymous");
		}
	}

	function wire() {
		$("#btn-qr-create")?.addEventListener("click", createQr);
		$("#btn-qr-refresh")?.addEventListener("click", createQr);
		$("#btn-cookie-login")?.addEventListener("click", () => adoptCookie(nodes.cookieInput.value));
		$("#btn-logout")?.addEventListener("click", logout);

		window.addEventListener(SESSION_EXPIRED_EVENT, () => {
			if (!store.state.cookie) return;
			store.clearSession();
			render();
			onUser?.(null);
			toastWarn(t("account.expired"));
		});

		for (const tab of document.querySelectorAll("[data-account-tab]")) {
			tab.addEventListener("click", () => {
				const name = tab.dataset.accountTab;
				for (const node of document.querySelectorAll("[data-account-tab]")) {
					node.classList.toggle("is-active", node === tab);
				}
				for (const pane of document.querySelectorAll("[data-account-pane]")) {
					pane.hidden = pane.dataset.accountPane !== name;
				}
				if (name === "qr" && !currentKey) createQr();
			});
		}

		// Opening the account chip jumps to the settings tab.
		nodes.chip?.addEventListener("click", () => {
			document.querySelector('[data-goto="settings"]')?.click();
			nodes.idle.scrollIntoView({ block: "nearest", behavior: "smooth" });
		});
	}

	return {
		wire,
		render,
		validateSession,
		adoptCookie,
		logout,
		isLoggedIn: () => Boolean(store.state.user),
	};
}
