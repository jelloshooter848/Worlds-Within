import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { assetDataUrl, crc32, dataUrlBytes, encodePng, isAssetPath, isTextAsset, readPngSize } from './png';

/** A 3 x 2 RGBA image: red, green, blue on top, then three greys. */
const PIXELS = Uint8Array.from([
  255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 10, 10, 10, 255, 20, 20, 20, 128, 30, 30, 30, 0,
]);

describe('PNG header reader', () => {
  it('reads the width and height from the IHDR chunk', () => {
    expect(readPngSize(encodePng(3, 2, PIXELS))).toEqual({ width: 3, height: 2 });
  });

  it('refuses what is not a PNG', () => {
    const png = encodePng(3, 2, PIXELS);
    expect(readPngSize(png.subarray(0, 20))).toBeNull();
    const badSignature = Uint8Array.from(png);
    badSignature[1] = 0x51;
    expect(readPngSize(badSignature)).toBeNull();
    const notIhdr = Uint8Array.from(png);
    notIhdr[12] = 0x58;
    expect(readPngSize(notIhdr)).toBeNull();
    expect(readPngSize(new TextEncoder().encode('# not an image, just some text here'))).toBeNull();
  });

  it('reads sizes past 16 bits', () => {
    const header = Uint8Array.from(encodePng(3, 2, PIXELS).subarray(0, 24));
    header.set([0, 1, 0, 0], 16); // width 65536
    header.set([0x80, 0, 0, 1], 20); // height 2^31 + 1
    expect(readPngSize(header)).toEqual({ width: 65536, height: 2 ** 31 + 1 });
  });
});

describe('PNG writer', () => {
  it('computes the standard CRC-32 check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes a PNG whose stream inflates back to the pixels, row by row', () => {
    const png = encodePng(3, 2, PIXELS);
    const idat = png.indexOf(0x49, 33); // 'I' of IDAT after the IHDR chunk
    const length = new DataView(png.buffer).getUint32(idat - 4);
    const raw = inflateSync(png.subarray(idat + 4, idat + 4 + length));
    expect([...raw]).toEqual([0, ...PIXELS.subarray(0, 12), 0, ...PIXELS.subarray(12)]);
    expect(Buffer.from(png.subarray(png.length - 12, png.length - 8)).toString('latin1')).toBe('\0\0\0\0');
  });

  it('gives the same bytes every time and refuses a wrong pixel count', () => {
    expect(encodePng(3, 2, PIXELS)).toEqual(encodePng(3, 2, PIXELS));
    expect(() => encodePng(2, 2, PIXELS)).toThrow(/16 bytes/);
  });
});

describe('asset files as strings', () => {
  it('tells asset paths and text assets apart', () => {
    expect(isAssetPath('assets/pack/a.png')).toBe(true);
    expect(isAssetPath('./assets/CREDITS.md')).toBe(true);
    expect(isAssetPath('content/assets/a.png')).toBe(false);
    expect(isTextAsset('assets/CREDITS.md')).toBe(true);
    expect(isTextAsset('assets/pack/a.png')).toBe(false);
  });

  it('round-trips bytes through a data URL', () => {
    const png = encodePng(3, 2, PIXELS);
    const url = assetDataUrl('assets/p/a.png', Buffer.from(png).toString('base64'));
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    expect(dataUrlBytes(url)).toEqual(png);
    for (const n of [1, 2, 3, 4]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => 250 - i);
      expect(dataUrlBytes(assetDataUrl('x.bin', Buffer.from(bytes).toString('base64')))).toEqual(bytes);
    }
    expect(assetDataUrl('a.glb', '')).toBe('data:model/gltf-binary;base64,');
    expect(dataUrlBytes('# Credits')).toBeNull();
  });

  it('decodes every byte value, and a large file, as Node does', () => {
    const every = Uint8Array.from({ length: 256 * 3 }, (_, i) => (i * 7) % 256);
    expect(dataUrlBytes(assetDataUrl('x.bin', Buffer.from(every).toString('base64')))).toEqual(every);
    const large = Uint8Array.from({ length: 200_001 }, (_, i) => (i * 31 + (i >> 8)) % 256);
    expect(dataUrlBytes(assetDataUrl('x.glb', Buffer.from(large).toString('base64')))).toEqual(large);
  });
});
