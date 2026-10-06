/**
 * MD5 (RFC 1321) — needed by bilibili's `wbi` request signing.
 *
 * WebCrypto deliberately omits MD5, and the project forbids third-party
 * libraries, so here it is. Only used for signing request parameters; nothing
 * security sensitive depends on it.
 */

const SHIFTS = [
	7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
	5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
	4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
	6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

// K[i] = floor(abs(sin(i + 1)) * 2^32), straight from the RFC.
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0);

function wordToHexLE(word) {
	let out = "";
	for (let i = 0; i < 4; i += 1) out += ((word >>> (i * 8)) & 0xff).toString(16).padStart(2, "0");
	return out;
}

function rotateLeft(value, amount) {
	return ((value << amount) | (value >>> (32 - amount))) >>> 0;
}

/**
 * @param {string|Uint8Array} input
 * @returns {string} lowercase hex digest
 */
export function md5Hex(input) {
	const message = typeof input === "string" ? new TextEncoder().encode(input) : input;
	const length = message.length;

	// Pad: 0x80, then zeros, until (length % 64) === 56, then the 64-bit length.
	const paddedLength = (((length + 8) >> 6) + 1) << 6;
	const buffer = new Uint8Array(paddedLength);
	buffer.set(message);
	buffer[length] = 0x80;

	const view = new DataView(buffer.buffer);
	const bitLength = length * 8;
	view.setUint32(paddedLength - 8, bitLength >>> 0, true);
	view.setUint32(paddedLength - 4, Math.floor(bitLength / 4294967296), true);

	let a0 = 0x67452301;
	let b0 = 0xefcdab89;
	let c0 = 0x98badcfe;
	let d0 = 0x10325476;

	const words = new Uint32Array(16);
	for (let offset = 0; offset < paddedLength; offset += 64) {
		for (let i = 0; i < 16; i += 1) words[i] = view.getUint32(offset + i * 4, true);

		let a = a0;
		let b = b0;
		let c = c0;
		let d = d0;

		for (let i = 0; i < 64; i += 1) {
			let f;
			let g;
			if (i < 16) {
				f = (b & c) | (~b & d);
				g = i;
			} else if (i < 32) {
				f = (d & b) | (~d & c);
				g = (5 * i + 1) % 16;
			} else if (i < 48) {
				f = b ^ c ^ d;
				g = (3 * i + 5) % 16;
			} else {
				f = c ^ (b | ~d);
				g = (7 * i) % 16;
			}

			f = (f + a + K[i] + words[g]) >>> 0;
			a = d;
			d = c;
			c = b;
			b = (b + rotateLeft(f, SHIFTS[i])) >>> 0;
		}

		a0 = (a0 + a) >>> 0;
		b0 = (b0 + b) >>> 0;
		c0 = (c0 + c) >>> 0;
		d0 = (d0 + d) >>> 0;
	}

	return wordToHexLE(a0) + wordToHexLE(b0) + wordToHexLE(c0) + wordToHexLE(d0);
}
