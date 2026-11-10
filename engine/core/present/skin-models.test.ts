import { describe, expect, it } from 'vitest';
import { validate } from '../content/validate';
import {
  MODEL_TICKS_PER_SECOND,
  modelClipFor,
  resolveSkinModel,
  resolveTileModel,
  skinModelUses,
  skinSchema,
  type SkinFile,
} from './skin';

const torch = {
  mesh: 'box',
  color: '#503000',
  model: 'assets/pack/brazier.glb',
  scale: 18,
  anchor: 'bottom',
  rotate: { y: 30 },
  clip: { idle: 'flicker', walk: 'sway' },
  castShadow: true,
  offset: { x: 1, y: -2 },
  z: 3,
};
const SKIN = {
  backend: 'three',
  kinds: { torch, crate: { mesh: 'box', color: '#808080', model: 'assets/pack/crate.gltf', clip: 'creak' } },
  tiles: { '#': { mesh: 'box', color: '#c84c0c', model: 'assets/pack/block.glb', scale: 2, clip: 'shine' } },
};
const skin = skinSchema.parse(SKIN) as SkinFile;
const entity = (kind: string, state: string, t: number) => ({
  id: 'e',
  kind,
  tags: [],
  facing: 'right' as const,
  anim: { state, t },
});
const issues = (value: unknown) => {
  const r = validate('three.json', value, skinSchema);
  return r.ok ? [] : r.errors.map((e) => [e.path, e.code]);
};

describe('skin models (Engine 0.16 T11)', () => {
  it('takes model, scale, anchor, rotate, clip and castShadow on 3D kinds and tiles', () => {
    expect(issues(SKIN)).toEqual([]);
    expect(issues({ ...SKIN, kinds: { t: { ...torch, anchor: { x: 0, y: -0.5, z: 0 } } } })).toEqual([]);
  });

  it('refuses a path outside a pack folder or not a glTF, and bad anchors', () => {
    expect(issues({ backend: 'three', kinds: { t: { ...torch, model: 'brazier.glb' } } })).toEqual([
      ['kinds.t.model', 'invalid_format'],
    ]);
    expect(issues({ backend: 'three', kinds: { t: { ...torch, model: 'assets/pack/b.obj' } } })).toEqual([
      ['kinds.t.model', 'invalid_format'],
    ]);
    expect(issues({ backend: 'three', kinds: { t: { ...torch, anchor: 'top' } } }).map((i) => i[0])).toEqual([
      'kinds.t.anchor',
    ]);
  });

  it('needs a model for anchor, rotate and clip (missing_field), and keeps them off 2D skins', () => {
    expect(
      issues({ backend: 'three', kinds: { t: { mesh: 'box', color: '#000', clip: 'x', rotate: { y: 9 } } } }),
    ).toEqual([
      ['kinds.t.rotate', 'missing_field'],
      ['kinds.t.clip', 'missing_field'],
    ]);
    expect(
      issues({
        backend: 'canvas2d',
        sheets: { sheet: 's', fallbackColor: '#000' },
        kinds: { t: { frames: { idle: 'a' }, model: 'assets/p/m.glb' } },
      }),
    ).toEqual([['kinds.t.model', 'wrong_backend_field']]);
  });

  it('maps an animation state to its clip: one name for all, the state, else idle, else none', () => {
    expect(modelClipFor(undefined, 'walk')).toBeNull();
    expect(modelClipFor('spin', 'walk')).toBe('spin');
    expect(modelClipFor({ idle: 'rest', walk: 'stride' }, 'walk')).toBe('stride');
    expect(modelClipFor({ idle: 'rest', walk: 'stride' }, 'jump')).toBe('rest');
    expect(modelClipFor({ walk: 'stride' }, 'jump')).toBeNull();
  });

  it("resolves an entity's model with its clip and the clip time from anim.t", () => {
    expect(resolveSkinModel(skin, entity('torch', 'walk', 30))).toEqual({
      model: 'assets/pack/brazier.glb',
      scale: 18,
      anchor: 'bottom',
      rotate: { x: 0, y: 30, z: 0 },
      castShadow: true,
      clip: 'sway',
      time: 30 / MODEL_TICKS_PER_SECOND,
      offset: { x: 1, y: -2, z: 3 },
    });
    expect(resolveSkinModel(skin, entity('torch', 'fall', 6))).toMatchObject({ clip: 'flicker', time: 0.1 });
    expect(resolveSkinModel(skin, entity('crate', 'idle', 0))).toMatchObject({
      anchor: 'bottom',
      scale: 1,
      castShadow: false,
      clip: 'creak',
    });
    expect(resolveSkinModel(skin, entity('ghost', 'idle', 0))).toBeUndefined();
    const plain = skinSchema.parse({ backend: 'three', kinds: { a: { mesh: 'box', color: '#000' } } });
    expect(resolveSkinModel(plain, entity('a', 'idle', 0))).toBeUndefined();
  });

  it('plays a tile model on the frame clock and lists every model use with its clips', () => {
    expect(resolveTileModel(skin.tiles!['#']!, 120)).toMatchObject({ scale: 2, clip: 'shine', time: 2 });
    expect(skinModelUses(skin)).toEqual([
      {
        path: ['kinds', 'torch'],
        model: 'assets/pack/brazier.glb',
        clips: [
          { path: ['kinds', 'torch', 'clip', 'idle'], clip: 'flicker' },
          { path: ['kinds', 'torch', 'clip', 'walk'], clip: 'sway' },
        ],
      },
      {
        path: ['kinds', 'crate'],
        model: 'assets/pack/crate.gltf',
        clips: [{ path: ['kinds', 'crate', 'clip'], clip: 'creak' }],
      },
      {
        path: ['tiles', '#'],
        model: 'assets/pack/block.glb',
        clips: [{ path: ['tiles', '#', 'clip'], clip: 'shine' }],
      },
    ]);
  });
});
