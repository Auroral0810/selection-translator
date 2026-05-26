export async function sha256Hex(input: string): Promise<string> {
	const data = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest("SHA-256", data);
	return bytesToHex(new Uint8Array(digest));
}

export function md5(input: string): string {
	const data = utf8Encode(input);
	const bitLength = data.length * 8;
	const bytes = [...data, 0x80];

	while (bytes.length % 64 !== 56) {
		bytes.push(0);
	}

	for (let i = 0; i < 8; i++) {
		bytes.push((bitLength >>> (8 * i)) & 0xff);
	}

	let a = 0x67452301;
	let b = 0xefcdab89;
	let c = 0x98badcfe;
	let d = 0x10325476;

	const s = [
		7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
		5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
		4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
		6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
	];

	const k = Array.from({length: 64}, (_value, index) =>
		Math.floor(Math.abs(Math.sin(index + 1)) * 2 ** 32));

	for (let chunk = 0; chunk < bytes.length; chunk += 64) {
		const m = new Array<number>(16);
		for (let i = 0; i < 16; i++) {
			m[i] = getByte(bytes, chunk + i * 4)
				| (getByte(bytes, chunk + i * 4 + 1) << 8)
				| (getByte(bytes, chunk + i * 4 + 2) << 16)
				| (getByte(bytes, chunk + i * 4 + 3) << 24);
		}

		let aa = a;
		let bb = b;
		let cc = c;
		let dd = d;

		for (let i = 0; i < 64; i++) {
			let f: number;
			let g: number;

			if (i < 16) {
				f = (bb & cc) | (~bb & dd);
				g = i;
			} else if (i < 32) {
				f = (dd & bb) | (~dd & cc);
				g = (5 * i + 1) % 16;
			} else if (i < 48) {
				f = bb ^ cc ^ dd;
				g = (3 * i + 5) % 16;
			} else {
				f = cc ^ (bb | ~dd);
				g = (7 * i) % 16;
			}

			const temp = dd;
			dd = cc;
			cc = bb;
			bb = add32(bb, leftRotate(add32(add32(aa, f), add32(k[i] ?? 0, m[g] ?? 0)), s[i] ?? 0));
			aa = temp;
		}

		a = add32(a, aa);
		b = add32(b, bb);
		c = add32(c, cc);
		d = add32(d, dd);
	}

	return [a, b, c, d].map(wordToHex).join("");
}

function getByte(bytes: number[], index: number): number {
	return bytes[index] ?? 0;
}

function utf8Encode(input: string): number[] {
	return Array.from(new TextEncoder().encode(input));
}

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function wordToHex(word: number): string {
	let output = "";
	for (let i = 0; i < 4; i++) {
		output += ((word >>> (8 * i)) & 0xff).toString(16).padStart(2, "0");
	}
	return output;
}

function add32(a: number, b: number): number {
	return (a + b) >>> 0;
}

function leftRotate(value: number, shift: number): number {
	return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}
