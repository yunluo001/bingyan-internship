/**
 * Dependency-free QR Code encoder — byte mode, error-correction level L,
 * versions 1-10 (up to 271 bytes).
 *
 * Why hand-rolled: bilibili's `/x/passport-login/web/qrcode/generate` returns
 * `data.url` = the *content to encode* (a passport URL containing the
 * qrcode_key), not an image URL. Something has to turn that string into a
 * scannable symbol, and the project forbids pulling in libraries.
 *
 * Structure follows ISO/IEC 18004:
 *   bit stream -> data codewords -> Reed-Solomon blocks -> interleave
 *   -> function patterns -> zigzag placement -> mask + format info
 *
 * Everything here is pure: no DOM except the two `render*` helpers at the end.
 */

/* -------------------------------------------------------------------------- */
/* Tables                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Version -> (EC codewords per block, block layout).
 * Groups are [blockCount, dataCodewordsPerBlock]; level L only.
 */
const BLOCKS = {
	1: { ec: 7, groups: [[1, 19]] },
	2: { ec: 10, groups: [[1, 34]] },
	3: { ec: 15, groups: [[1, 55]] },
	4: { ec: 20, groups: [[1, 80]] },
	5: { ec: 26, groups: [[1, 108]] },
	6: { ec: 18, groups: [[2, 68]] },
	7: { ec: 20, groups: [[2, 78]] },
	8: { ec: 24, groups: [[2, 97]] },
	9: { ec: 30, groups: [[2, 116]] },
	10: { ec: 18, groups: [[2, 68], [2, 69]] },
};

const MAX_VERSION = 10;
const EC_FORMAT_BITS = 0b01; // level L

/* -------------------------------------------------------------------------- */
/* GF(256) arithmetic, primitive polynomial 0x11d                             */
/* -------------------------------------------------------------------------- */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(function buildTables() {
	let x = 1;
	for (let i = 0; i < 255; i += 1) {
		EXP[i] = x;
		LOG[x] = i;
		x <<= 1;
		if (x & 0x100) x ^= 0x11d;
	}
	for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

function mul(a, b) {
	if (a === 0 || b === 0) return 0;
	return EXP[LOG[a] + LOG[b]];
}

/** Generator polynomial for `degree` EC codewords, highest power first. */
function generatorPoly(degree) {
	let poly = [1];
	for (let i = 0; i < degree; i += 1) {
		const next = new Array(poly.length + 1).fill(0);
		for (let j = 0; j < poly.length; j += 1) {
			next[j] ^= poly[j];
			next[j + 1] ^= mul(poly[j], EXP[i]);
		}
		poly = next;
	}
	return poly;
}

/** Polynomial long division: returns the `degree` EC codewords for `data`. */
function rsRemainder(data, degree) {
	const gen = generatorPoly(degree);
	const remainder = new Uint8Array(degree);
	for (const byte of data) {
		const factor = byte ^ remainder[0];
		remainder.copyWithin(0, 1);
		remainder[degree - 1] = 0;
		for (let i = 0; i < degree; i += 1) remainder[i] ^= mul(gen[i + 1], factor);
	}
	return remainder;
}

/* -------------------------------------------------------------------------- */
/* Encoding                                                                   */
/* -------------------------------------------------------------------------- */

function dataCapacity(version) {
	return BLOCKS[version].groups.reduce((sum, [count, words]) => sum + count * words, 0);
}

function pickVersion(byteLength) {
	for (let version = 1; version <= MAX_VERSION; version += 1) {
		const lengthBits = version <= 9 ? 8 : 16;
		const neededBits = 4 + lengthBits + byteLength * 8;
		if (neededBits <= dataCapacity(version) * 8) return version;
	}
	throw new Error(`qrcode: ${byteLength} bytes exceeds version ${MAX_VERSION} capacity`);
}

/** Build the padded data codeword sequence (no EC yet). */
function buildDataCodewords(bytes, version) {
	const capacity = dataCapacity(version);
	const bits = [];
	const push = (value, length) => {
		for (let i = length - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
	};

	push(0b0100, 4); // byte mode
	push(bytes.length, version <= 9 ? 8 : 16);
	for (const byte of bytes) push(byte, 8);

	const capacityBits = capacity * 8;
	push(0, Math.max(0, Math.min(4, capacityBits - bits.length))); // terminator
	while (bits.length % 8 !== 0) bits.push(0);

	const codewords = [];
	for (let i = 0; i < bits.length; i += 8) {
		let value = 0;
		for (let j = 0; j < 8; j += 1) value = (value << 1) | bits[i + j];
		codewords.push(value);
	}

	// Pad bytes alternate, per spec, until the data capacity is filled.
	const padBytes = [0xec, 0x11];
	let padIndex = 0;
	while (codewords.length < capacity) {
		codewords.push(padBytes[padIndex % 2]);
		padIndex += 1;
	}
	return codewords;
}

/** Split into blocks, append EC, then interleave in the spec's order. */
function buildFinalCodewords(dataCodewords, version) {
	const { ec, groups } = BLOCKS[version];
	const dataBlocks = [];
	const ecBlocks = [];

	let offset = 0;
	for (const [count, words] of groups) {
		for (let i = 0; i < count; i += 1) {
			const block = dataCodewords.slice(offset, offset + words);
			offset += words;
			dataBlocks.push(block);
			ecBlocks.push(rsRemainder(block, ec));
		}
	}

	const result = [];
	const longest = Math.max(...dataBlocks.map((block) => block.length));
	for (let i = 0; i < longest; i += 1) {
		for (const block of dataBlocks) if (i < block.length) result.push(block[i]);
	}
	for (let i = 0; i < ec; i += 1) {
		for (const block of ecBlocks) result.push(block[i]);
	}
	return result;
}

/* -------------------------------------------------------------------------- */
/* Matrix construction                                                        */
/* -------------------------------------------------------------------------- */

function alignmentPositions(version) {
	if (version === 1) return [];
	const count = Math.floor(version / 7) + 2;
	const size = version * 4 + 17;
	const step = Math.floor((version * 4 + count * 2 + 1) / (count * 2 - 2)) * 2;
	const positions = new Array(count);
	positions[0] = 6;
	for (let i = count - 1, pos = size - 7; i >= 1; i -= 1, pos -= step) positions[i] = pos;
	return positions;
}

function getBit(value, index) {
	return (value >>> index) & 1;
}

/**
 * Build the module matrix.
 * @returns {boolean[][]} `matrix[y][x]` — true means a dark module.
 */
function buildMatrix(bytes, version, mask) {
	const size = version * 4 + 17;
	const modules = Array.from({ length: size }, () => new Array(size).fill(false));
	const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));

	const set = (x, y, dark) => {
		modules[y][x] = dark;
		isFunction[y][x] = true;
	};

	/* Timing patterns */
	for (let i = 0; i < size; i += 1) {
		set(6, i, i % 2 === 0);
		set(i, 6, i % 2 === 0);
	}

	/* Finder patterns (with their separators, marked via the 9x9 square) */
	const drawFinder = (cx, cy) => {
		for (let dy = -4; dy <= 4; dy += 1) {
			for (let dx = -4; dx <= 4; dx += 1) {
				const x = cx + dx;
				const y = cy + dy;
				if (x < 0 || y < 0 || x >= size || y >= size) continue;
				const dist = Math.max(Math.abs(dx), Math.abs(dy));
				set(x, y, dist !== 2 && dist !== 4);
			}
		}
	};
	drawFinder(3, 3);
	drawFinder(size - 4, 3);
	drawFinder(3, size - 4);

	/* Alignment patterns */
	const positions = alignmentPositions(version);
	for (let i = 0; i < positions.length; i += 1) {
		for (let j = 0; j < positions.length; j += 1) {
			const corner = (i === 0 && j === 0) || (i === 0 && j === positions.length - 1) || (i === positions.length - 1 && j === 0);
			if (corner) continue;
			const cx = positions[i];
			const cy = positions[j];
			for (let dy = -2; dy <= 2; dy += 1) {
				for (let dx = -2; dx <= 2; dx += 1) {
					const dist = Math.max(Math.abs(dx), Math.abs(dy));
					set(cx + dx, cy + dy, dist !== 1);
				}
			}
		}
	}

	/* Reserve the format information areas so data skips them. */
	for (let i = 0; i <= 8; i += 1) {
		if (!isFunction[8][i]) set(i, 8, false);
		if (!isFunction[i][8]) set(8, i, false);
	}
	for (let i = 0; i < 8; i += 1) {
		if (!isFunction[8][size - 1 - i]) set(size - 1 - i, 8, false);
		if (!isFunction[size - 1 - i][8]) set(8, size - 1 - i, false);
	}

	/* Version information (v7+) */
	if (version >= 7) {
		let rem = version;
		for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
		const bits = (version << 12) | rem;
		for (let i = 0; i < 18; i += 1) {
			const bit = getBit(bits, i) === 1;
			const a = size - 11 + (i % 3);
			const b = Math.floor(i / 3);
			set(a, b, bit);
			set(b, a, bit);
		}
	}

	/* Data placement: right-to-left column pairs, zigzag vertical direction. */
	const codewords = buildFinalCodewords(buildDataCodewords(bytes, version), version);
	let bitIndex = 0;
	const totalBits = codewords.length * 8;
	for (let right = size - 1; right >= 1; right -= 2) {
		if (right === 6) right = 5;
		for (let vert = 0; vert < size; vert += 1) {
			for (let j = 0; j < 2; j += 1) {
				const x = right - j;
				const upward = ((right + 1) & 2) === 0;
				const y = upward ? size - 1 - vert : vert;
				if (isFunction[y][x] || bitIndex >= totalBits) continue;
				modules[y][x] = getBit(codewords[bitIndex >>> 3], 7 - (bitIndex & 7)) === 1;
				bitIndex += 1;
			}
		}
	}

	/* Masking touches the encoding region only — never the function patterns. */
	applyMask(modules, isFunction, mask);
	drawFormatBits(modules, size, mask);

	return modules;
}

function maskFn(mask, x, y) {
	switch (mask) {
		case 0:
			return (x + y) % 2 === 0;
		case 1:
			return y % 2 === 0;
		case 2:
			return x % 3 === 0;
		case 3:
			return (x + y) % 3 === 0;
		case 4:
			return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
		case 5:
			return ((x * y) % 2) + ((x * y) % 3) === 0;
		case 6:
			return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
		case 7:
			return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
		default:
			throw new Error(`qrcode: bad mask ${mask}`);
	}
}

function applyMask(modules, isFunction, mask) {
	const size = modules.length;
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			if (isFunction[y][x]) continue;
			if (maskFn(mask, x, y)) modules[y][x] = !modules[y][x];
		}
	}
}

function formatBits(mask) {
	const data = (EC_FORMAT_BITS << 3) | mask;
	let rem = data;
	for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
	return ((data << 10) | rem) ^ 0x5412;
}

function drawFormatBits(modules, size, mask) {
	const bits = formatBits(mask);
	const put = (x, y, dark) => {
		modules[y][x] = dark;
	};

	for (let i = 0; i <= 5; i += 1) put(8, i, getBit(bits, i) === 1);
	put(8, 7, getBit(bits, 6) === 1);
	put(8, 8, getBit(bits, 7) === 1);
	put(7, 8, getBit(bits, 8) === 1);
	for (let i = 9; i < 15; i += 1) put(14 - i, 8, getBit(bits, i) === 1);

	for (let i = 0; i < 8; i += 1) put(size - 1 - i, 8, getBit(bits, i) === 1);
	for (let i = 8; i < 15; i += 1) put(8, size - 15 + i, getBit(bits, i) === 1);
	put(8, size - 8, true); // always-dark module
}

/* -------------------------------------------------------------------------- */
/* Mask selection                                                             */
/* -------------------------------------------------------------------------- */

function penaltyScore(modules) {
	const size = modules.length;
	let penalty = 0;

	// Rule 1: runs of five or more same-coloured modules along a line.
	const scanLine = (get) => {
		let run = 1;
		for (let i = 1; i < size; i += 1) {
			if (get(i) === get(i - 1)) {
				run += 1;
			} else {
				if (run >= 5) penalty += run - 2;
				run = 1;
			}
		}
		if (run >= 5) penalty += run - 2;
	};
	for (let y = 0; y < size; y += 1) scanLine((i) => modules[y][i]);
	for (let x = 0; x < size; x += 1) scanLine((i) => modules[i][x]);

	// Rule 2: 2x2 blocks of one colour.
	for (let y = 0; y < size - 1; y += 1) {
		for (let x = 0; x < size - 1; x += 1) {
			const v = modules[y][x];
			if (v === modules[y][x + 1] && v === modules[y + 1][x] && v === modules[y + 1][x + 1]) penalty += 3;
		}
	}

	// Rule 3: finder-like 1:1:3:1:1 patterns.
	const pattern = [true, false, true, true, true, false, true, false, false, false, false];
	const reversed = pattern.slice().reverse();
	const matchesWith = (get, target) => {
		for (let i = 0; i < 11; i += 1) if (get(i) !== target[i]) return false;
		return true;
	};
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x + 11 <= size; x += 1) {
			const rowGet = (i) => modules[y][x + i];
			if (matchesWith(rowGet, pattern) || matchesWith(rowGet, reversed)) penalty += 40;
		}
	}
	for (let x = 0; x < size; x += 1) {
		for (let y = 0; y + 11 <= size; y += 1) {
			const colGet = (i) => modules[y + i][x];
			if (matchesWith(colGet, pattern) || matchesWith(colGet, reversed)) penalty += 40;
		}
	}

	// Rule 4: deviation from a 50% dark ratio.
	let darkCount = 0;
	for (const row of modules) for (const cell of row) if (cell) darkCount += 1;
	const percent = (darkCount * 100) / (size * size);
	penalty += Math.floor(Math.abs(percent - 50) / 5) * 10;

	return penalty;
}

function chooseMask(bytes, version) {
	let best = { mask: 0, penalty: Infinity, modules: null };
	for (let mask = 0; mask < 8; mask += 1) {
		const modules = buildMatrix(bytes, version, mask);
		const penalty = penaltyScore(modules);
		if (penalty < best.penalty) best = { mask, penalty, modules };
	}
	return best;
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Encode `text` and return the module matrix.
 * @param {string} text
 * @returns {{size: number, version: number, mask: number, modules: boolean[][]}}
 */
export function encodeQr(text) {
	const bytes = new TextEncoder().encode(String(text));
	if (!bytes.length) throw new Error("qrcode: empty input");
	const version = pickVersion(bytes.length);
	const best = chooseMask(bytes, version);
	return { size: best.modules.length, version, mask: best.mask, modules: best.modules };
}

/** Draw into a canvas that is exactly `size * scale` pixels big. */
export function drawQrToCanvas(canvas, text, { margin = 4, scale = 8, dark = "#101828", light = "#ffffff" } = {}) {
	const { size, modules } = encodeQr(text);
	const total = (size + margin * 2) * scale;
	canvas.width = total;
	canvas.height = total;

	const ctx = canvas.getContext("2d");
	ctx.fillStyle = light;
	ctx.fillRect(0, 0, total, total);
	ctx.fillStyle = dark;
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			if (!modules[y][x]) continue;
			ctx.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
		}
	}
	return canvas;
}

/** Convenience wrapper: encode `text` and return a PNG data URL. */
export function qrDataUrl(text, options) {
	const canvas = document.createElement("canvas");
	drawQrToCanvas(canvas, text, options);
	return canvas.toDataURL("image/png");
}

/**
 * True when a value looks like something an <img> can load, as opposed to QR
 * *content*. bilibili returns the latter, but being lenient here means a
 * server that hands back an image (like the offline mock) keeps working.
 */
export function looksLikeImageSource(value) {
	const text = String(value || "").trim();
	if (!text) return false;
	if (text.startsWith("data:image/")) return true;
	if (!/^https?:\/\//i.test(text)) return false;
	if (!/\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(text)) return false;
	// A payload containing a query string of its own is a login URL, not an image.
	return !/qrcode_key=|oauthKey=/.test(text);
}
