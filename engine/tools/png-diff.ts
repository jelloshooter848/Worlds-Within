import { inflateSync } from 'node:zlib';
import { readPngSize } from '@engine/core/content/png';

/**
 * Comparing two pictures pixel by pixel (Engine 0.16 T13b-5): the PixiJS/Canvas2D parity test
 * (`tests/browser/pixi-parity.test.ts`) reads both backends' PNGs of the same tick with
 * `decodePng` and checks them with `pixelDiff` against a stated tolerance. Node only.
 */

/** A decoded picture: `width` x `height` RGBA pixels, row-major, 4 bytes each. */
export interface RgbaPicture {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/**
 * Decodes an 8-bit, non-interlaced RGB or RGBA PNG (what Chromium's `toDataURL` and the core's
 * `encodePng` write), every row filter (none, sub, up, average, Paeth) included. Throws on
 * anything else (palette or 16-bit colour, interlacing, not a PNG).
 */
export function decodePng(png: Uint8Array): RgbaPicture {
  const size = readPngSize(png);
  if (size === null) throw new Error('not a PNG');
  const { width, height } = size;
  const bytes = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  const depth = bytes[24];
  const colour = bytes[25];
  const interlace = bytes[28];
  if (depth !== 8 || (colour !== 2 && colour !== 6) || interlace !== 0)
    throw new Error(`unsupported PNG (bit depth ${depth}, colour type ${colour}, interlace ${interlace})`);
  const channels = colour === 6 ? 4 : 3;
  const idat: Buffer[] = [];
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at);
    if (bytes.toString('latin1', at + 4, at + 8) === 'IDAT')
      idat.push(bytes.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
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
      const add = [0, a, b, (a + b) >> 1, paeth][filter];
      if (add === undefined) throw new Error(`bad PNG row filter ${filter}`);
      rows[y * stride + i] = (x + add) & 0xff;
    }
  }
  if (channels === 4) return { width, height, rgba: rows };
  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    rgba.set(rows.subarray(p * 3, p * 3 + 3), p * 4);
    rgba[p * 4 + 3] = 255;
  }
  return { width, height, rgba };
}

/** A rectangle of the picture, in pixels. */
export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How two pictures differ. */
export interface PixelDiff {
  /** Pixels compared (the whole picture, or the region). */
  pixels: number;
  /** Pixels where some channel (R, G or B) differs by more than the threshold. */
  differing: number;
  /** `differing / pixels`. */
  share: number;
  /** The largest difference of any channel of any pixel (0-255). */
  maxChannel: number;
  /** The bounding box of the differing pixels, or null when none differ. */
  box: PixelRect | null;
}

/**
 * Compares `a` and `b` (the same size) pixel by pixel: a pixel differs when any of its R, G or B
 * channels differs by more than `threshold` (alpha is ignored: both pictures are opaque).
 * `region` limits the comparison to a rectangle (clipped to the picture); `skip` leaves out
 * rectangles inside it (where a looser bound is checked on its own).
 */
export function pixelDiff(
  a: RgbaPicture,
  b: RgbaPicture,
  opts: { threshold: number; region?: PixelRect; skip?: readonly PixelRect[] },
): PixelDiff {
  if (a.width !== b.width || a.height !== b.height)
    throw new Error(`the pictures differ in size: ${a.width}x${a.height} and ${b.width}x${b.height}`);
  const r = opts.region ?? { x: 0, y: 0, w: a.width, h: a.height };
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(a.width, r.x + r.w);
  const y1 = Math.min(a.height, r.y + r.h);
  const skipped = (x: number, y: number) =>
    (opts.skip ?? []).some((s) => x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h);
  let pixels = 0;
  let differing = 0;
  let maxChannel = 0;
  let box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (skipped(x, y)) continue;
      pixels++;
      const at = (y * a.width + x) * 4;
      let worst = 0;
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(a.rgba[at + c]! - b.rgba[at + c]!));
      maxChannel = Math.max(maxChannel, worst);
      if (worst <= opts.threshold) continue;
      differing++;
      box =
        box === null
          ? { x0: x, y0: y, x1: x + 1, y1: y + 1 }
          : {
              x0: Math.min(box.x0, x),
              y0: Math.min(box.y0, y),
              x1: Math.max(box.x1, x + 1),
              y1: Math.max(box.y1, y + 1),
            };
    }
  }
  return {
    pixels,
    differing,
    share: pixels === 0 ? 0 : differing / pixels,
    maxChannel,
    box: box === null ? null : { x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0 },
  };
}
