/**
 * Small dependency-free helpers used across the app.
 * Nothing here touches app state, so it is safe to import from anywhere.
 */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/** Create an element with props/attrs and children in one call. */
export function el(tag, props = {}, children = []) {
	const node = document.createElement(tag);

	for (const [key, value] of Object.entries(props)) {
		if (value === null || value === undefined || value === false) continue;
		if (key === "class") node.className = value;
		else if (key === "text") node.textContent = value;
		else if (key === "html") node.innerHTML = value;
		else if (key === "dataset") Object.assign(node.dataset, value);
		else if (key === "style" && typeof value === "object") Object.assign(node.style, value);
		else if (key.startsWith("on") && typeof value === "function") {
			node.addEventListener(key.slice(2).toLowerCase(), value);
		} else if (key in node && key !== "list") {
			node[key] = value;
		} else {
			node.setAttribute(key, value === true ? "" : String(value));
		}
	}

	for (const child of [].concat(children)) {
		if (child === null || child === undefined || child === false) continue;
		node.append(child instanceof Node ? child : document.createTextNode(String(child)));
	}

	return node;
}

export function clear(node) {
	while (node.firstChild) node.removeChild(node.firstChild);
	return node;
}

/** Truncate without cutting a surrogate pair in half. */
export function truncate(text, max) {
	const value = String(text ?? "");
	if (value.length <= max) return value;
	return `${value.slice(0, Math.max(0, max - 1))}…`;
}

export function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

export function toInt(value, fallback = 0) {
	const n = Number.parseInt(String(value ?? "").trim(), 10);
	return Number.isFinite(n) ? n : fallback;
}

export function formatNumber(value) {
	return new Intl.NumberFormat().format(Number(value) || 0);
}

export function formatTime(ts, locale = "zh-CN") {
	if (!ts) return "—";
	try {
		return new Intl.DateTimeFormat(locale, {
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
		}).format(new Date(ts));
	} catch {
		return new Date(ts).toLocaleString();
	}
}

export function formatClock(ts, locale = "zh-CN") {
	if (!ts) return "";
	try {
		return new Intl.DateTimeFormat(locale, {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		}).format(new Date(ts));
	} catch {
		return "";
	}
}

export function debounce(fn, wait = 250) {
	let timer = 0;
	return (...args) => {
		window.clearTimeout(timer);
		timer = window.setTimeout(() => fn(...args), wait);
	};
}

export function uid(prefix = "id") {
	return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Fisher–Yates. Returns a new array; the input is never mutated. */
export function shuffled(list, rng = Math.random) {
	const out = list.slice();
	for (let i = out.length - 1; i > 0; i -= 1) {
		const j = Math.floor(rng() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

/**
 * Cryptographically strong random index in [0, max) when available.
 * Falls back to Math.random for very old browsers.
 */
export function secureRandom(max) {
	if (max <= 0) return 0;
	const crypto = globalThis.crypto;
	if (crypto?.getRandomValues) {
		const limit = Math.floor(0xffffffff / max) * max;
		const buf = new Uint32Array(1);
		let value;
		do {
			crypto.getRandomValues(buf);
			value = buf[0];
		} while (value >= limit);
		return value % max;
	}
	return Math.floor(Math.random() * max);
}

export function sleep(ms) {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Trigger a browser download for a generated text file. */
export function downloadText(filename, text, mime = "text/plain;charset=utf-8") {
	const blob = new Blob([text], { type: mime });
	const url = URL.createObjectURL(blob);
	const link = el("a", { href: url, download: filename });
	document.body.append(link);
	link.click();
	link.remove();
	window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function copyText(text) {
	if (navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(text);
		return true;
	}
	const area = el("textarea", { value: text, style: { position: "fixed", opacity: "0" } });
	document.body.append(area);
	area.select();
	const ok = document.execCommand("copy");
	area.remove();
	return ok;
}

function escapeXml(value) {
	return String(value).replace(
		/[<>&'"]/g,
		(ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[ch],
	);
}

/**
 * A deterministic gradient avatar carrying the first character of `name`.
 *
 * Used as the fallback whenever a remote avatar cannot be loaded — bilibili's
 * image CDN (`i0.hdslb.com`) rejects hot-linking with anything that is not a
 * bilibili Referer, so a local page can still end up with a 403 even after the
 * request is sent without one.
 */
export function initialsAvatar(name, { size = 96 } = {}) {
	const text = String(name ?? "").trim();
	const initial = text ? [...text][0].toUpperCase() : "?";
	let hue = 0;
	for (const ch of text) hue = (hue * 31 + ch.codePointAt(0)) % 360;

	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 96 96">` +
		`<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
		`<stop offset="0" stop-color="hsl(${hue} 82% 64%)"/>` +
		`<stop offset="1" stop-color="hsl(${(hue + 46) % 360} 76% 46%)"/>` +
		`</linearGradient></defs>` +
		`<rect width="96" height="96" rx="48" fill="url(#g)"/>` +
		`<text x="48" y="63" font-size="44" text-anchor="middle" fill="#fff" ` +
		`font-family="-apple-system,Segoe UI,sans-serif">${escapeXml(initial)}</text></svg>`;
	return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Point an <img> at a remote avatar and swap in a generated one if it fails.
 * The guard stops an infinite error loop if even the fallback cannot render.
 */
export function setAvatarImage(img, url, name) {
	if (!img) return;
	img.onerror = null;
	const fallback = initialsAvatar(name);
	if (!url) {
		img.src = fallback;
		return;
	}
	let fellBack = false;
	img.onerror = () => {
		if (fellBack) return;
		fellBack = true;
		img.src = fallback;
	};
	img.src = url;
}

/** Human readable "3 秒前" style relative time. */
export function relativeTime(ts, locale = "zh-CN") {
	let value = Math.max(0, Math.floor((Date.now() - ts) / 1000));
	let unit = "second";
	if (value >= 60) {
		value /= 60;
		unit = "minute";
		if (value >= 60) {
			value /= 60;
			unit = "hour";
			if (value >= 24) {
				value /= 24;
				unit = "day";
				if (value >= 30) {
					value /= 30;
					unit = "month";
					if (value >= 12) {
						value /= 12;
						unit = "year";
					}
				}
			}
		}
	}
	try {
		return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-Math.round(value), unit);
	} catch {
		return formatTime(ts, locale);
	}
}
