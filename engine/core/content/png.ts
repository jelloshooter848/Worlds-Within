/**
 * PNG and binary asset helpers (Engine 0.16 T10). A game's `assets/` files reach the content
 * loader as strings like every other file: text files (`.md`, `.txt`, `.json`) as their text,
 * every other file as a base64 `data:` URL (`assetDataUrl`), so Node tools, the build's
 * `virtual:game-files` module and the screenshot page all hand the same `{ path: text }` pairs
 * around. Pure: no Node or DOM APIs (base64 is decoded here).
 */

/** The eight bytes every PNG file starts with. */
export const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The folder of a game that holds binary asset packs, one sub-folder per pack. */
export const ASSETS_DIR = 'assets';

/** The credits file every `assets/` folder needs. */
export const CREDITS_FILE = `${ASSETS_DIR}/CREDITS.md`;

/** Asset files read as text; every other asset file is a `data:` URL. */
const TEXT_ASSET = /\.(md|txt|json)$/i;

/** The media type of an asset file by its extension. */
const MEDIA_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  gltf: 'model/gltf+json',
  glb: 'model/gltf-binary',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
};

/** Whether `path` (relative to the game folder) is in its `assets/` folder. */
export function isAssetPath(path: string): boolean {
  return path.replace(/^\.\//, '').startsWith(`${ASSETS_DIR}/`);
}

/** Whether an asset file is read as text (else it travels as a `data:` URL). */
export function isTextAsset(path: string): boolean {
  return TEXT_ASSET.test(path);
}

/** The `data:` URL of a binary asset file from its base64 bytes. */
export function assetDataUrl(path: string, base64: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return `data:${MEDIA_TYPES[ext] ?? 'application/octet-stream'};base64,${base64}`;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** Each base64 character's 6-bit value, by char code (a table, so a large model decodes quickly). */
const B64_VALUES = new Uint8Array(128);
for (let i = 0; i < B64.length; i++) B64_VALUES[B64.charCodeAt(i)] = i;

/** The bytes of a base64 `data:` URL, or null when it is not one. */
export function dataUrlBytes(url: string): Uint8Array | null {
  const m = /^data:[^,;]*;base64,([A-Za-z0-9+/]*={0,2})$/.exec(url);
  if (!m) return null;
  const text = m[1]!.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    value = ((value << 6) | B64_VALUES[text.charCodeAt(i)]!) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (value >> bits) & 0xff;
    }
  }
  return out;
}

/**
 * A PNG's width and height from its header (the signature, then the `IHDR` chunk first, as the
 * format requires), or null when the bytes are not a PNG. Reads 24 bytes; decodes no pixels.
 */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
  const type = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (type !== 'IHDR') return null;
  const u32 = (at: number) =>
    ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
  const width = u32(16);
  const height = u32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

// ---- Writing (asset tooling: a game's script that makes an original PNG sheet) ----

let crcTable: Uint32Array | null = null;

/** CRC-32 (the PNG chunk checksum, polynomial 0xEDB88320) of `bytes`. */
export function crc32(bytes: Uint8Array): number {
  if (crcTable === null) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A PNG of `width` x `height` RGBA pixels (row-major, 4 bytes each), 8-bit truecolour with alpha,
 * no filtering, its zlib stream made of stored (uncompressed) deflate blocks. Not small, but the
 * same bytes on every machine and Node version (no zlib build in the loop), so a generated sheet
 * can be checked against the committed one. For small original sheets made by a script.
 */
export function encodePng(width: number, height: number, rgba: Uint8Array | Uint8ClampedArray): Uint8Array {
  if (rgba.length !== width * height * 4) throw new Error(`expected ${width * height * 4} bytes of RGBA`);
  // Each row: filter byte 0, then the row's pixels.
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  // zlib: header, stored blocks of at most 65535 bytes, Adler-32.
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const z = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  z[0] = 0x78;
  z[1] = 0x01;
  let at = 2;
  for (let i = 0; i < blocks; i++) {
    const part = raw.subarray(i * 65535, Math.min(raw.length, (i + 1) * 65535));
    z[at++] = i === blocks - 1 ? 1 : 0;
    z[at++] = part.length & 0xff;
    z[at++] = part.length >> 8;
    z[at++] = ~part.length & 0xff;
    z[at++] = (~part.length >> 8) & 0xff;
    z.set(part, at);
    at += part.length;
  }
  let a = 1;
  let b = 0;
  for (const byte of raw) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  writeU32(z, at, ((b << 16) | a) >>> 0);
  const ihdr = new Uint8Array(13);
  writeU32(ihdr, 0, width);
  writeU32(ihdr, 4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [
    Uint8Array.from(PNG_SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', z),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function writeU32(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = (value >>> 24) & 0xff;
  bytes[at + 1] = (value >>> 16) & 0xff;
  bytes[at + 2] = (value >>> 8) & 0xff;
  bytes[at + 3] = value & 0xff;
}

/** One PNG chunk: length, type, data, CRC of type and data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  writeU32(out, 0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  writeU32(out, 8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
