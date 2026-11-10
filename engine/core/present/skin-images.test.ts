import { describe, expect, it } from 'vitest';
import { checkSkinRefs, skinSchema } from './skin';

// PNG sheets in skins (Engine 0.16 T10): `images` names a skin's image sheets; entries use the
// id as a `sheet` and its frames like a text sprite's. The PNG itself (file, size, credits) is
// checked by the content loader (`content/assets.test.ts`).

const sprites = [{ name: 'hero', value: { frames: { 'down-0': [] } } }];
const others = (kind: string) => (kind === 'sprite' ? sprites : []);
const skin = (over: Record<string, unknown> = {}) =>
  skinSchema.parse({
    backend: 'canvas2d',
    sheets: { sheet: 'hero', fallbackColor: '#00a800' },
    images: {
      torch: {
        image: 'assets/lab/torch.png',
        frameSize: { w: 16, h: 24 },
        grid: { cols: 2, rows: 1 },
        names: ['lit-0', 'lit-1'],
        frames: { unlit: { x: 0, y: 26, w: 16, h: 24 } },
        anchor: 'bottom',
      },
    },
    kinds: {
      hero: { frames: { idle: 'down-0' } },
      torch: { sheet: 'torch', frames: { idle: { frames: ['lit-0', 'lit-1'], ticks: 6 }, off: 'unlit' } },
    },
    ...over,
  });

describe('skin images', () => {
  it('takes an image sheet as a sheet, on 2D and 3D skins', () => {
    expect(checkSkinRefs('canvas2d', skin(), others)).toEqual([]);
    expect(skinSchema.safeParse({ backend: 'three', images: skin().images, kinds: {} }).success).toBe(true);
  });

  it('reports a frame the image does not have, naming the image', () => {
    const bad = skin({
      kinds: { torch: { sheet: 'torch', frames: { idle: 'lit-2' } } },
      hud: [{ as: 'icon', status: 'lit', x: 0, y: 0, sheet: 'torch', frame: 'nope' }],
    });
    expect(checkSkinRefs('canvas2d', bad, others)).toEqual([
      expect.objectContaining({
        path: ['kinds', 'torch', 'frames', 'idle'],
        code: 'missing_frame',
        message: 'image "torch" has no frame "lit-2"',
      }),
      expect.objectContaining({ path: ['hud', 0, 'frame'], code: 'missing_frame' }),
    ]);
  });

  it('refuses an image id a sprite file already has', () => {
    const clash = skin({
      images: { hero: skin().images!['torch'] },
      kinds: { hero: { frames: { idle: 'down-0' } } },
    });
    expect(checkSkinRefs('canvas2d', clash, others)).toEqual([
      expect.objectContaining({ path: ['images', 'hero'], code: 'duplicate_name' }),
    ]);
  });

  it('reports a bad image entry at its field', () => {
    const result = skinSchema.safeParse({
      backend: 'canvas2d',
      sheets: { fallbackColor: '#000' },
      images: { t: { image: 'assets/lab/t.png', grid: { cols: 1, rows: 1 } } },
      kinds: {},
    });
    expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual(['images.t.frameSize']);
  });
});
