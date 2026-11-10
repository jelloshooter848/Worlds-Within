import { inflateSync } from 'node:zlib';
import { dataUrlBytes } from '@engine/core/content/png';
import type { DecodedImage, ImageDecoder } from '@engine/core/assets/content-images';

/**
 * A test-only PNG decoder for Node (Engine 0.16 part B, T6): what `withContentImages` asks the
 * browser for, so tests that build a game's 3D scene can upload its skins' PNG sheets (the HUD's
 * hearts and icons) as the page does. 8-bit, not interlaced: RGB (2), palette (3, with `tRNS`
 * alpha) or RGBA (6), every filter. No canvas image (`image` null).
 */
export function decodePng(bytes: Uint8Array): DecodedImage {
  const png = Buffer.from(bytes);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const depth = png[24]!;
  const type = png[25]!;
  if (depth !== 8 || png[28] !== 0 || ![2, 3, 6].includes(type))
    throw new Error(`decodePng: depth ${depth}, colour type ${type}, interlace ${png[28]} not read`);
  const idat: Buffer[] = [];
  let palette: Buffer | null = null;
  let alpha: Buffer | null = null;
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    const kind = png.toString('latin1', at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (kind === 'IDAT') idat.push(body);
    else if (kind === 'PLTE') palette = body;
    else if (kind === 'tRNS') alpha = body;
    at += 12 + length;
  }
  const channels = type === 6 ? 4 : type === 2 ? 3 : 1;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i]!;
      const a = i >= channels ? rows[y * stride + i - channels]! : 0;
      const b = y > 0 ? rows[(y - 1) * stride + i]! : 0;
      const c = i >= channels && y > 0 ? rows[(y - 1) * stride + i - channels]! : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      rows[y * stride + i] = (x + [0, a, b, (a + b) >> 1, paeth][filter]!) & 0xff;
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    if (type === 3) {
      const index = rows[p]!;
      data.set([palette![index * 3]!, palette![index * 3 + 1]!, palette![index * 3 + 2]!], p * 4);
      data[p * 4 + 3] = alpha !== null && index < alpha.length ? alpha[index]! : 255;
    } else {
      for (let ch = 0; ch < 3; ch++) data[p * 4 + ch] = rows[p * channels + ch]!;
      data[p * 4 + 3] = type === 6 ? rows[p * 4 + 3]! : 255;
    }
  }
  return { image: null, width, height, data };
}

/** `decodePng` as `withContentImages`'s decoder (a skin image's `data:` URL). */
export const nodeImageDecoder: ImageDecoder = (url) => Promise.resolve(decodePng(dataUrlBytes(url)!));
