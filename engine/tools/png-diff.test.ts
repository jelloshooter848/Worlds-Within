import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { encodePng } from '@engine/core/content/png';
import { decodePng, pixelDiff, type RgbaPicture } from './png-diff';

/** A `w` x `h` picture of one colour. */
function plain(w: number, h: number, rgb: [number, number, number]): RgbaPicture {
  const rgba = new Uint8Array(w * h * 4);
  for (let p = 0; p < w * h; p++) rgba.set([...rgb, 255], p * 4);
  return { width: w, height: h, rgba };
}

/** Sets one pixel's colour. */
function put(pic: RgbaPicture, x: number, y: number, rgb: [number, number, number]): void {
  pic.rgba.set(rgb, (y * pic.width + x) * 4);
}

/** A minimal PNG chunk (the CRC is not checked by the reader). */
function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, Buffer.from(data), Buffer.alloc(4)]);
}

describe('decodePng', () => {
  it('reads back what encodePng writes', () => {
    const pic = plain(5, 3, [10, 20, 30]);
    put(pic, 4, 2, [250, 0, 128]);
    const back = decodePng(encodePng(5, 3, pic.rgba));
    expect(back.width).toBe(5);
    expect(back.height).toBe(3);
    expect([...back.rgba]).toEqual([...pic.rgba]);
  });

  it('reads RGB rows with the sub, up, average and Paeth filters', () => {
    // 2x4 RGB, one row per filter; each row's raw bytes are chosen so the decoded pixels are known.
    const want = [
      [1, 2, 3, 4, 5, 6],
      [7, 8, 9, 10, 11, 12],
      [13, 14, 15, 16, 17, 18],
      [19, 20, 21, 22, 23, 24],
    ];
    const rows: number[] = [];
    const filtered = (f: number, y: number) =>
      want[y]!.map((v, i) => {
        const a = i >= 3 ? want[y]![i - 3]! : 0;
        const b = y > 0 ? want[y - 1]![i]! : 0;
        const c = i >= 3 && y > 0 ? want[y - 1]![i - 3]! : 0;
        const p = a + b - c;
        const paeth =
          Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c)
            ? a
            : Math.abs(p - b) <= Math.abs(p - c)
              ? b
              : c;
        return (v - [0, a, b, (a + b) >> 1, paeth][f]! + 256) & 0xff;
      });
    [1, 2, 3, 4].forEach((f, y) => rows.push(f, ...filtered(f, y)));
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(2, 0);
    ihdr.writeUInt32BE(4, 4);
    ihdr.set([8, 2, 0, 0, 0], 8);
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(Buffer.from(rows))),
      chunk('IEND', new Uint8Array()),
    ]);
    const pic = decodePng(png);
    expect([...pic.rgba.subarray(0, 8)]).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
    expect([...pic.rgba.subarray(24, 32)]).toEqual([19, 20, 21, 255, 22, 23, 24, 255]);
  });

  it('refuses what is not a PNG', () => {
    expect(() => decodePng(new Uint8Array(40))).toThrow('not a PNG');
  });
});

describe('pixelDiff', () => {
  it('counts pixels past the per-channel threshold, their share and their box', () => {
    const a = plain(10, 10, [100, 100, 100]);
    const b = plain(10, 10, [100, 100, 100]);
    put(b, 2, 3, [110, 100, 100]);
    put(b, 7, 8, [100, 160, 100]);
    expect(pixelDiff(a, a, { threshold: 0 })).toEqual({
      pixels: 100,
      differing: 0,
      share: 0,
      maxChannel: 0,
      box: null,
    });
    expect(pixelDiff(a, b, { threshold: 8 })).toEqual({
      pixels: 100,
      differing: 2,
      share: 0.02,
      maxChannel: 60,
      box: { x: 2, y: 3, w: 6, h: 6 },
    });
    expect(pixelDiff(a, b, { threshold: 10 }).differing).toBe(1);
  });

  it('compares a region, leaving out skipped rectangles', () => {
    const a = plain(10, 10, [0, 0, 0]);
    const b = plain(10, 10, [0, 0, 0]);
    put(b, 1, 1, [255, 255, 255]);
    put(b, 6, 6, [255, 255, 255]);
    const top = pixelDiff(a, b, { threshold: 0, region: { x: 0, y: 0, w: 10, h: 5 } });
    expect(top).toMatchObject({ pixels: 50, differing: 1 });
    const skip = pixelDiff(a, b, { threshold: 0, skip: [{ x: 5, y: 5, w: 5, h: 5 }] });
    expect(skip).toMatchObject({ pixels: 75, differing: 1 });
  });

  it('refuses pictures of different sizes', () => {
    expect(() => pixelDiff(plain(2, 2, [0, 0, 0]), plain(3, 2, [0, 0, 0]), { threshold: 0 })).toThrow(
      /differ in size/,
    );
  });
});
