/**
 * Entry point: boots the store into the DOM, wires the three controllers and
 * owns the cross-cutting concerns (theme, language, view switching).
 */

import { $, $$, copyText } from "./util.js";
import { applyStaticI18n, getLang, setLang, t } from "./i18n.js";
import { ACCENTS, store } from "./store.js";
import { OFFLINE_EVENT } from "./api.js";
import { createAccountController } from "./ui/account.js";
import { createDrawView } from "./ui/draw-view.js";
import { createSettingsView } from "./ui/settings-view.js";
import { toastOk } from "./ui/toast.js";

const media = window.matchMedia("(prefers-color-scheme: dark)");

const ACCENT_PROPS = [
	"--accent",
	"--accent-strong",
	"--accent-ink",
	"--accent-soft-light",
	"--accent-soft-dark",
	"--accent-tint-light",
	"--accent-tint-dark",
];

function hexToRgb(hex) {
	const value = hex.replace("#", "");
	return {
		r: Number.parseInt(value.slice(0, 2), 16),
		g: Number.parseInt(value.slice(2, 4), 16),
		b: Number.parseInt(value.slice(4, 6), 16),
	};
}

function mixHex(hex, targetHex, amount) {
	const from = hexToRgb(hex);
	const to = hexToRgb(targetHex);
	const mix = (a, b) => Math.round(a + (b - a) * amount);
	return `#${[mix(from.r, to.r), mix(from.g, to.g), mix(from.b, to.b)]
		.map((value) => value.toString(16).padStart(2, "0"))
		.join("")}`;
}

function rgba(hex, alpha) {
	const { r, g, b } = hexToRgb(hex);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function luminance(hex) {
	const { r, g, b } = hexToRgb(hex);
	const channel = (value) => {
		const v = value / 255;
		return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Preset palettes come from CSS; a custom #rrggbb is materialised inline. */
function applyAccent(root, accent) {
	if (ACCENTS.includes(accent)) {
		root.dataset.accent = accent;
		for (const prop of ACCENT_PROPS) root.style.removeProperty(prop);
		return;
	}
	if (!/^#[0-9a-f]{6}$/i.test(accent)) return;

	root.dataset.accent = accent;
	root.style.setProperty("--accent", accent);
	root.style.setProperty("--accent-strong", mixHex(accent, "#000000", 0.14));
	root.style.setProperty("--accent-ink", luminance(accent) > 0.6 ? "#10131a" : "#ffffff");
	root.style.setProperty("--accent-soft-light", mixHex(accent, "#ffffff", 0.86));
	root.style.setProperty("--accent-soft-dark", rgba(accent, 0.22));
	root.style.setProperty("--accent-tint-light", rgba(accent, 0.12));
	root.style.setProperty("--accent-tint-dark", rgba(accent, 0.18));
}

/* -------------------------------------------------------------------------- */
/* Theme / wallpaper                                                          */
/* -------------------------------------------------------------------------- */

function effectiveTheme() {
	const mode = store.state.themeMode;
	if (mode === "light" || mode === "dark") return mode;
	return media.matches ? "dark" : "light";
}

function applyTheme() {
	const root = document.documentElement;

	// Every colour is a variable, so this invalidates the whole document. Let
	// the swap land in one repaint instead of animating ~200ms of raster work
	// (that is what made the light/dark toggle feel sticky).
	root.classList.add("theme-switching");
	window.clearTimeout(applyTheme.releaseTimer);

	root.dataset.theme = effectiveTheme();
	applyAccent(root, store.state.accent);
	// Note: NOT `data-theme-mode`. That attribute belongs to the mode buttons,
	// and putting it on <html> too made `querySelectorAll("[data-theme-mode]")`
	// match the document element — which silently attached the mode-switch click
	// handler to <html>, so every click anywhere re-applied the theme.
	root.dataset.themePref = store.state.themeMode;

	for (const button of $$(".theme-mode-btn")) {
		button.classList.toggle("is-active", button.dataset.themeMode === store.state.themeMode);
	}
	updateThemeLabels();

	// Two frames: one to flush the new colours, one to be sure they are on
	// screen before transitions come back.
	window.requestAnimationFrame(() => {
		window.requestAnimationFrame(() => {
			root.classList.remove("theme-switching");
		});
	});
	applyTheme.releaseTimer = window.setTimeout(() => root.classList.remove("theme-switching"), 250);
}

function applyWallpaper() {
	const backdrop = $("#app-backdrop");
	if (!backdrop) return;
	if (store.wallpaper) {
		backdrop.style.setProperty("--bg-image", `url("${store.wallpaper}")`);
		backdrop.classList.add("has-image");
		// Backdrop blur is only worth paying for when a wallpaper sits behind it.
		document.documentElement.classList.add("has-wallpaper");
	} else {
		backdrop.style.removeProperty("--bg-image");
		backdrop.classList.remove("has-image");
		document.documentElement.classList.remove("has-wallpaper");
	}
}

/**
 * "跟随系统" and "浅色" look identical when the OS is light, which makes the
 * icon-only switch ambiguous. Say the resolved theme out loud.
 */
function updateThemeLabels() {
	const mode = store.state.themeMode;
	const resolved = t(effectiveTheme() === "dark" ? "theme.dark" : "theme.light");
	const label = mode === "system" ? `${t("theme.auto")} · ${resolved}` : t(`theme.${mode}`);

	const topbarLabel = $("#theme-mode-label");
	if (topbarLabel) topbarLabel.textContent = label;

	const settingsHint = $("#theme-mode-hint");
	if (settingsHint) {
		// Only interesting for "follow system"; the other two already say it.
		settingsHint.textContent = mode === "system" ? t("theme.systemNow", { theme: resolved }) : "";
	}
}

/* -------------------------------------------------------------------------- */
/* View switching                                                             */
/* -------------------------------------------------------------------------- */

function showView(name) {
	for (const view of $$("[data-view]")) {
		view.classList.toggle("is-active", view.dataset.view === name);
	}
	for (const tab of $$("[data-goto]")) {
		const active = tab.dataset.goto === name;
		tab.classList.toggle("is-active", active);
		tab.setAttribute("aria-selected", String(active));
	}
	$("#stage")?.scrollTo({ top: 0 });
}

/* -------------------------------------------------------------------------- */
/* "The relay service is not running" banner                                  */
/* -------------------------------------------------------------------------- */

const START_COMMAND = "node tools/dev-server.mjs --web web";

function showOfflineBanner(detail) {
	const banner = $("#offline-banner");
	if (!banner) return;
	banner.hidden = false;
	if (detail) console.warn("[gachago] local relay service unreachable:", detail);
}

function wireOfflineBanner() {
	$("#offline-command").textContent = START_COMMAND;

	$("#btn-offline-close")?.addEventListener("click", () => {
		$("#offline-banner").hidden = true;
	});

	$("#btn-offline-copy")?.addEventListener("click", async () => {
		await copyText(START_COMMAND);
		toastOk(t("common.copied"));
	});

	$("#btn-offline-help")?.addEventListener("click", () => {
		const help = $("#boot-help");
		if (!help) return;
		const slot = $("#boot-help-reason");
		if (slot) slot.textContent = t("err.offline");
		help.hidden = false;
	});

	// Any request that cannot reach the local service escalates to the banner.
	window.addEventListener(OFFLINE_EVENT, (event) => showOfflineBanner(event.detail));
}

/* -------------------------------------------------------------------------- */
/* Boot                                                                       */
/* -------------------------------------------------------------------------- */

function boot() {
	window.__GACHAGO_BOOTED__ = true;
	document.getElementById("boot-help")?.setAttribute("hidden", "");

	setLang(store.state.lang);
	applyStaticI18n();
	applyTheme();
	applyWallpaper();
	document.title = `GACHAGO · ${t("brand.tagline")}`;
	wireOfflineBanner();

	const account = createAccountController({
		onUser: () => {
			// Re-login changes the uid sent in the auth packet; reconnect the
			// room so the new identity is used.
			drawView.syncFromStore();
		},
	});

	const drawView = createDrawView();
	const settingsView = createSettingsView({
		onLanguageChange: () => {
			setLang(store.state.lang);
			applyStaticI18n();
			document.title = `GACHAGO · ${t("brand.tagline")}`;
			applyTheme();
			account.render();
			drawView.onLanguageChange();
			settingsView.refresh();
		},
		onThemeChange: () => applyTheme(),
	});

	account.wire();
	drawView.wire();
	settingsView.wire();
	account.render();
	settingsView.refresh();

	// Nav tabs.
	for (const tab of $$("[data-goto]")) {
		tab.addEventListener("click", () => showView(tab.dataset.goto));
	}

	// Language quick toggle in the top bar.
	$("#btn-lang")?.addEventListener("click", () => {
		const next = getLang() === "zh" ? "en" : "zh";
		store.patch({ lang: next }, "lang");
		setLang(next);
		applyStaticI18n();
		document.title = `GACHAGO · ${t("brand.tagline")}`;
		applyTheme();
		account.render();
		drawView.onLanguageChange();
		settingsView.refresh();
		$("#lang-label").textContent = t("lang.name");
	});
	$("#lang-label").textContent = t("lang.name");

	// Keep the UI in sync with any store write coming from a controller.
	store.subscribe((_state, reason) => {
		if (["theme", "appearance"].includes(reason)) applyTheme();
		if (reason === "wallpaper") applyWallpaper();
		if (reason === "sets") settingsView.refresh();
		if (reason === "history") settingsView.refresh();
	});

	media.addEventListener("change", () => {
		if (store.state.themeMode === "system") applyTheme();
	});

	// A tab that stays open overnight should not keep a stale "reconnecting"
	// pill on screen when the browser restores it.
	document.addEventListener("visibilitychange", () => {
		if (!document.hidden) applyTheme();
	});
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
	boot();
}
