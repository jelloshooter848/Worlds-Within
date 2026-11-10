import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHADOW,
  DEFAULT_SUN_DIRECTION,
  labelBar,
  labelValue,
  resolveScene3d,
  skinLabels,
  timerText,
  type SkinLabel,
} from './scene3d';
import { checkSkinRefs, skinSchema } from './skin';
import type { PresentEntity } from './types';

// The 3D scene look in skins (Engine 0.16 T12): `scene3d`, a kind's `light`, `receiveShadow` and
// world-anchored `labels`. The 3D backend's use of them is in engine/backends/three/lighting.test.ts.

const three = (over: Record<string, unknown> = {}) => ({
  backend: 'three',
  kinds: { hero: { mesh: 'box', color: '#d82800' } },
  ...over,
});

const issues = (skin: unknown) => {
  const r = skinSchema.safeParse(skin);
  return r.success
    ? []
    : r.error.issues.map((i) => ({
        path: i.path.join('.'),
        code: (i as { params?: { code?: string } }).params?.code ?? i.code,
      }));
};

describe('scene3d in skins', () => {
  it('takes the scene look, lights, shadow flags and labels on a 3D skin', () => {
    expect(
      issues(
        three({
          scene3d: {
            sun: {
              color: '#ffffff',
              intensity: 1.2,
              direction: { x: 1, y: 2, z: 1 },
              shadow: { mapSize: 2048 },
            },
            ambient: { intensity: 0.2 },
            hemisphere: { sky: '#a4e4fc', ground: '#503000' },
            fog: { kind: 'exp2', color: '#a4e4fc', density: 0.002 },
            toneMapping: { kind: 'agx', exposure: 0.9 },
            colorSpace: 'srgb',
          },
          kinds: {
            hero: {
              mesh: 'box',
              color: '#d82800',
              receiveShadow: true,
              light: { kind: 'point', color: '#f8b800', intensity: 3, distance: 48, flicker: 0.2 },
            },
          },
          tiles: { '#': { mesh: 'box', color: '#c84c0c', castShadow: true, receiveShadow: true } },
          labels: {
            hero: [
              { from: 'id', as: 'text', font: 'f' },
              { from: { tag: 'hp:' }, as: 'bar', max: 5 },
              { from: { status: 'left' }, as: 'timer', font: 'f', anchor: 'bottom', offset: { x: 0, y: 2 } },
            ],
            coin: { as: 'text', format: 'Gold', font: 'f' },
          },
        }),
      ),
    ).toEqual([]);
  });

  it('refuses them on a 2D skin and bad values at their field', () => {
    const flat = {
      backend: 'canvas2d',
      sheets: { sheet: 's', fallbackColor: '#000000' },
      kinds: { hero: { frames: { idle: 'a' }, receiveShadow: true } },
      scene3d: {},
      labels: { hero: { as: 'text', format: 'x' } },
    };
    expect(issues(flat)).toEqual(
      expect.arrayContaining([
        { path: 'scene3d', code: 'wrong_backend_field' },
        { path: 'labels', code: 'wrong_backend_field' },
        { path: 'kinds.hero.receiveShadow', code: 'wrong_backend_field' },
      ]),
    );
    expect(issues(three({ scene3d: { fog: { kind: 'mist', color: '#000000' } } }))[0]!.path).toBe(
      'scene3d.fog.kind',
    );
    expect(issues(three({ scene3d: { toneMapping: { kind: 'reinhard' } } }))[0]!.path).toBe(
      'scene3d.toneMapping.kind',
    );
    expect(issues(three({ scene3d: { sun: { shadow: { mapSize: 10 } } } }))[0]!.path).toBe(
      'scene3d.sun.shadow.mapSize',
    );
    expect(
      issues(
        three({
          kinds: { hero: { mesh: 'box', color: '#d82800', light: { kind: 'point', color: '#fff' } } },
        }),
      )[0]!.path,
    ).toBe('kinds.hero.light.intensity');
    expect(issues(three({ labels: { hero: { as: 'name' } } }))[0]!.path).toMatch(/^labels\.hero/);
  });

  it('fills every default: a skin without scene3d is lit as before', () => {
    const look = resolveScene3d(undefined, { ambient: 0.6, directional: 0.8 });
    expect(look).toEqual({
      sun: { color: '#ffffff', intensity: 0.8, direction: { ...DEFAULT_SUN_DIRECTION }, shadow: null },
      ambient: { color: '#ffffff', intensity: 0.6 },
      hemisphere: null,
      fog: null,
      toneMapping: { kind: 'none', exposure: 1 },
      colorSpace: 'srgb',
    });
    const lit = resolveScene3d(
      {
        sun: { shadow: {} },
        fog: { kind: 'linear', color: '#000' },
        hemisphere: { sky: '#fff', ground: '#000' },
      },
      { ambient: 0.6, directional: 0.8 },
    );
    expect(lit.sun.shadow).toEqual({ ...DEFAULT_SHADOW });
    expect(lit.fog).toEqual({ kind: 'linear', color: '#000', near: 0, far: 1000 });
    expect(lit.hemisphere).toEqual({ sky: '#fff', ground: '#000', intensity: 1 });
    expect(
      resolveScene3d({ fog: { kind: 'exp2', color: '#000' } }, { ambient: 0, directional: 0 }).fog,
    ).toEqual({
      kind: 'exp2',
      color: '#000',
      density: 0.001,
    });
  });

  it("checks a label's font and its format's glyphs across files", () => {
    const fonts = [{ name: 'f', value: { glyphs: { G: {}, o: {}, l: {}, d: {} } } }];
    const others = (kind: string) => (kind === 'font' ? fonts : []);
    const skin = skinSchema.parse(
      three({
        labels: {
          hero: [
            { as: 'text', format: 'Gold', font: 'f' },
            { as: 'text', format: 'Gems', font: 'f' },
            { as: 'text', from: 'id', font: 'nope' },
          ],
          coin: { as: 'timer', font: 'f', format: 'x{value}' },
        },
      }),
    );
    expect(checkSkinRefs('three', skin, others).map((i) => [i.path.join('.'), i.code])).toEqual([
      ['labels.hero.1.format', 'missing_glyph'],
      ['labels.hero.2.font', 'missing_ref'],
      ['labels.coin.format', 'missing_glyph'],
    ]);
  });
});

describe('label values', () => {
  const e: PresentEntity = {
    id: 'p1',
    kind: 'hero',
    x: 0,
    y: 0,
    w: 8,
    h: 8,
    facing: 'right',
    anim: { state: 'idle', t: 0 },
    tags: ['name:Pip', 'hp:3/5', 'progress:40'],
  };
  const label = (over: Partial<SkinLabel>): SkinLabel => ({ as: 'text', ...over });

  it('reads the id, kind, a tag prefix or a status field', () => {
    expect(labelValue(label({ from: 'id' }), e, {})).toBe('p1');
    expect(labelValue(label({ from: 'kind' }), e, {})).toBe('hero');
    expect(labelValue(label({ from: { tag: 'name:' } }), e, {})).toBe('Pip');
    expect(labelValue(label({ from: { tag: 'gone:' } }), e, {})).toBeUndefined();
    expect(labelValue(label({ from: { status: 'left' } }), e, { left: 90 })).toBe(90);
    expect(labelValue(label({ from: { status: 'left' } }), e, {})).toBeUndefined();
    expect(labelValue(label({}), e, {})).toBeUndefined();
  });

  it('reads a bar from a number, a tag n/m or a status max', () => {
    expect(labelBar(label({ as: 'bar' }), '3/5', {})).toEqual({ value: 3, max: 5 });
    expect(labelBar(label({ as: 'bar', max: 'maxHp' }), '3/5', { maxHp: 8 })).toEqual({ value: 3, max: 8 });
    expect(labelBar(label({ as: 'bar' }), '40', {})).toEqual({ value: 40, max: 100 });
    expect(labelBar(label({ as: 'bar', max: 4 }), 2, {})).toEqual({ value: 2, max: 4 });
    expect(labelBar(label({ as: 'bar' }), 'Pip', {})).toBeNull();
    expect(labelBar(label({ as: 'bar' }), undefined, {})).toBeNull();
  });

  it('writes ticks as m:ss, rounding up', () => {
    expect(timerText(0)).toBe('0:00');
    expect(timerText(1)).toBe('0:01');
    expect(timerText(60)).toBe('0:01');
    expect(timerText(61)).toBe('0:02');
    expect(timerText(60 * 75)).toBe('1:15');
    expect(timerText(-5)).toBe('0:00');
  });

  it('lists a kind’s labels', () => {
    const one = { as: 'text', format: 'x' } as const;
    expect(skinLabels({ hero: one }, 'hero')).toEqual([one]);
    expect(skinLabels({ hero: [one, one] }, 'hero')).toHaveLength(2);
    expect(skinLabels({ hero: one }, 'coin')).toEqual([]);
    expect(skinLabels(undefined, 'hero')).toEqual([]);
  });
});
