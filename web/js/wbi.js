/**
 * bilibili `wbi` request signing.
 *
 * Some endpoints (notably `/xlive/web-room/v1/index/getDanmuInfo`) answer with
 * `-352` unless the query carries a `w_rid`/`wts` pair derived from the daily
 * `img_key`/`sub_key` that `/x/web-interface/nav` hands out.
 *
 * Steps:
 *   1. img_key = basename(img_url) without extension, likewise sub_key
 *   2. shuffle `img_key + sub_key` through a fixed 64-entry table, keep 32 chars
 *   3. sort params, strip `!'()*` from values, url-encode, append `wts`
 *   4. w_rid = md5(query + mixin_key)
 */

import { md5Hex } from "./md5.js";

/** Fixed permutation published alongside the algorithm. */
export const MIXIN_KEY_ENC_TAB = [
	46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38,
	41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
	20, 34, 44, 52,
];

/** `https://i0.hdslb.com/bfs/wbi/abc123.png` -> `abc123` */
export function keyFromUrl(url) {
	const name = String(url || "").split("?")[0].split("/").pop() || "";
	return name.split(".")[0];
}

export function mixinKey(imgKey, subKey) {
	const source = `${imgKey || ""}${subKey || ""}`;
	if (source.length < 64) throw new Error("wbi: keys are too short");
	let out = "";
	for (let i = 0; i < 32; i += 1) out += source[MIXIN_KEY_ENC_TAB[i]];
	return out;
}

/**
 * @param {Record<string, string|number>} params
 * @param {string} imgKey
 * @param {string} subKey
 * @param {number} [now] unix seconds, injectable for tests
 * @returns {{query: string, full: string, wts: number, w_rid: string}}
 *   `query` is what gets hashed; `full` is the complete query string to send.
 *   Send `full` verbatim — the signature is over the literal bytes, so letting
 *   a URL-encoder re-encode it (spaces become `+`, etc.) would break it.
 */
export function signQuery(params, imgKey, subKey, now = Math.floor(Date.now() / 1000)) {
	const key = mixinKey(imgKey, subKey);
	const all = { ...params, wts: now };
	const query = Object.keys(all)
		.sort()
		.map((name) => {
			// bilibili drops these characters from the value before encoding.
			const value = String(all[name]).replace(/[!'()*]/g, "");
			return `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
		})
		.join("&");

	const w_rid = md5Hex(query + key);
	return { query, full: `${query}&w_rid=${w_rid}`, wts: now, w_rid };
}
