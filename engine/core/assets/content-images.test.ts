import { describe, expect, it } from 'vitest';
import { loadContent } from '../content/bundle';
import { kitContentKinds, mustLoad } from '../content/game-content';
import { assetDataUrl, encodePng } from '../content/png';
import { contentImageSpecs, withContentImages, type ImageDecoder } from './content-images';
import { contentPixelSheets, contentSheets } from './content-sheets';

// PNG sheets in skins (Engine 0.16 T10): decoded before the first frame, then given by the same
// sheet lookups as text sprites (2D) and as pixels (the 3D HUD). Node has no <img>, so a fake
// decoder stands in for the browser's.

const PNG = encodePng(4, 2, new Uint8Array(32).fill(200));
const skin = {
  backend: 'canvas2d',
  sheets: { sheet: 'dots', fallbackColor: '#ff00ff' },
  images: {
    gems: {
      image: 'assets/pack/gems.png',
      frameSize: { w: 2, h: 2 },
      grid: { cols: 2, rows: 1 },
      names: ['red', 'blue'],
      anchor: 'bottom',
    },
  },
  kinds: { gem: { sheet: 'gems', frames: { idle: 'red' } }, dot: { frames: { idle: 'dot' } } },
};
const files = {
  'game.json': JSON.stringify({
    id: 'g',
    kit: 'none',
    content: { sprite: ['s/*.txt'], palette: ['p/*.json'], skin: ['k/*.json'] },
    start: { seed: 1 },
    headless: 'h.ts',
  }),
  'p/pal.json': JSON.stringify({ id: 'pal', colors: ['#000000', '#fcfcfc'] }),
  's/dots.txt': 'palette pal\nlegend . clear\nlegend w 1\n\nframe dot\nw.\n',
  'k/canvas2d.json': JSON.stringify(skin),
  'assets/CREDITS.md': '## pack\n- Source: here\n- Author: us\n- Licence: CC0 1.0\n',
  'assets/pack/gems.png': assetDataUrl('gems.png', Buffer.from(PNG).toString('base64')),
};
const content = mustLoad(loadContent(files, kitContentKinds([])));

/** A fake decoder: a stand-in image object and 4x2 grey pixels; counts its calls. */
function fakeDecoder(): ImageDecoder & { calls: string[] } {
  const calls: string[] = [];
  const decode = (async (url: string) => {
    calls.push(url);
    return {
      image: { fake: url } as unknown as CanvasImageSource,
      width: 4,
      height: 2,
      data: new Uint8ClampedArray(32).fill(200),
    };
  }) as ImageDecoder & { calls: string[] };
  decode.calls = calls;
  return decode;
}

describe('content images (Engine 0.16 T10)', () => {
  it("keeps the assets beside the entries and lists the skins' image specs", () => {
    expect(Object.keys(content.assets ?? {})).toEqual(['assets/CREDITS.md', 'assets/pack/gems.png']);
    expect([...contentImageSpecs(content).keys()]).toEqual(['gems']);
  });

  it('decodes each PNG once and gives its sheet by id, frames and anchors from the skin', async () => {
    const decode = fakeDecoder();
    const loaded = await withContentImages(content, decode);
    expect(decode.calls).toEqual([files['assets/pack/gems.png']]);
    expect(content.images).toBeUndefined();
    const sheets = contentSheets(loaded);
    const gems = sheets('gems')!;
    expect(gems.image).toEqual({ fake: files['assets/pack/gems.png'] });
    expect(gems.frames.get('blue')).toEqual({ x: 2, y: 0, w: 2, h: 2, anchor: 'bottom' });
    // Text sprites keep working beside it.
    expect(sheets('dots')?.frames.has('dot')).toBe(true);
    expect(sheets('nope')).toBeNull();
  });

  it('gives the PNG pixels to the 3D HUD (contentPixelSheets)', async () => {
    const pixels = contentPixelSheets(await withContentImages(content, fakeDecoder()));
    const gems = pixels('gems')!;
    expect([gems.width, gems.height, gems.data.length]).toEqual([4, 2, 32]);
    expect(gems.frames.get('red')).toEqual({ x: 0, y: 0, w: 2, h: 2, anchor: 'bottom' });
    expect(pixels('dots')?.frames.has('dot')).toBe(true);
  });

  it('returns a bundle without image sheets as it is, and leaves out an image that will not decode', async () => {
    const plain = mustLoad(
      loadContent(
        {
          ...files,
          'k/canvas2d.json': JSON.stringify({ ...skin, images: undefined, kinds: { dot: skin.kinds.dot } }),
        },
        kitContentKinds([]),
      ),
    );
    expect(await withContentImages(plain, fakeDecoder())).toBe(plain);
    const broken = await withContentImages(content, () => Promise.reject(new Error('no')));
    expect(broken.images?.size).toBe(0);
    expect(contentSheets(broken)('gems')).toBeNull();
  });
});
