import { describe, expect, it } from 'vitest';
import { checkSkinRefs, resolveSkinFrame, skinSchema } from './skin';

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

// A cycle's own `sheet` (Engine 0.16 part B, T6): one kind drawing its states from several PNG
// sheets (a character pack ships one PNG per animation).
describe('a cycle on its own sheet', () => {
  const images = {
    run: { image: 'assets/lab/run.png', frameSize: { w: 32, h: 32 }, grid: { cols: 2, rows: 1 } },
    jump: { image: 'assets/lab/jump.png', frames: { up: { x: 0, y: 0, w: 32, h: 32 } } },
  };
  const frog = (frames: Record<string, unknown>) =>
    skin({
      images: { ...skin().images, ...images },
      kinds: { frog: { sheet: 'run', frames, flipFacing: true } },
    });
  const at = (s: ReturnType<typeof skin>, state: string, t = 0, facing = 'right') =>
    resolveSkinFrame(s, { kind: 'frog', facing: facing as 'right', anim: { state, t }, tags: [] });

  it("draws each state from its cycle's sheet, else the entry's", () => {
    const s = frog({
      run: { frames: ['0', '1'], ticks: 4 },
      jump: { frames: ['up'], sheet: 'jump' },
      hurt: { right: { frames: ['up'], sheet: 'jump' } },
    });
    expect(checkSkinRefs('canvas2d', s, others)).toEqual([]);
    expect(at(s, 'run', 4)).toMatchObject({ sheet: 'run', frame: '1' });
    expect(at(s, 'jump')).toMatchObject({ sheet: 'jump', frame: 'up' });
    expect(at(s, 'hurt', 0, 'left')).toMatchObject({ sheet: 'jump', frame: 'up', flipX: true });
  });

  it("checks a cycle's frames against its own sheet, and the sheet once", () => {
    const s = frog({
      jump: { frames: ['up', '0'], sheet: 'jump' },
      fall: { frames: ['a', 'b'], sheet: 'nope' },
    });
    expect(checkSkinRefs('canvas2d', s, others)).toEqual([
      expect.objectContaining({
        path: ['kinds', 'frog', 'frames', 'jump', 'frames', 1],
        code: 'missing_frame',
        message: 'image "jump" has no frame "0"',
      }),
      expect.objectContaining({ path: ['kinds', 'frog', 'frames', 'fall', 'sheet'], code: 'missing_ref' }),
    ]);
  });

  it('is a 2D field: a pose or a state without frames may not name one', () => {
    const three = skinSchema.safeParse({
      backend: 'three',
      kinds: { frog: { mesh: 'box', color: '#000', poses: { idle: { frames: ['box'], sheet: 'run' } } } },
    });
    expect(three.error?.issues.map((i) => [i.path.join('.'), (i as { params?: unknown }).params])).toEqual([
      ['kinds.frog.poses.idle.sheet', { code: 'wrong_backend_field' }],
    ]);
    const bare = skinSchema.safeParse({
      backend: 'canvas2d',
      sheets: { sheet: 'hero', fallbackColor: '#000' },
      kinds: { frog: { frames: { idle: { right: 'a', sheet: 'run' } } } },
    });
    expect(bare.error?.issues.map((i) => i.path.join('.'))).toEqual(['kinds.frog.frames.idle.sheet']);
  });
});
