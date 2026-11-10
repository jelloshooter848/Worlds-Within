import { describe, expect, it } from 'vitest';
import { skinSchema, type SkinFile } from '../present/skin';
import type { PresentEntity, PresentMap } from '../present/types';
import {
  ambientFor,
  blendedDarkness,
  flickered,
  flickerNoise,
  lightStops,
  mapParts,
  SkinLighting,
} from './lighting';
import { lightingSchema, type LightingSpec } from './schema';
import { SkinParticles } from './skin-particles';

const MAP: PresentMap = {
  id: 'hall',
  version: 1,
  tileSize: 16,
  cols: 4,
  rows: 2,
  tiles: ['#E..', '....'],
  tags: ['dark'],
};

const ent = (over: Partial<PresentEntity> = {}): PresentEntity => ({
  id: 'hero',
  kind: 'hero',
  x: 16,
  y: 16,
  w: 16,
  h: 16,
  facing: 'down',
  anim: { state: 'idle', t: 0 },
  tags: [],
  ...over,
});

function skin(lighting: LightingSpec, extra: Partial<SkinFile> = {}): SkinFile {
  return {
    backend: 'canvas2d',
    sheets: { sheet: 's', fallbackColor: '#f0f' },
    kinds: { hero: { frames: { idle: 'a' } }, torch: { frames: { lit: 'a', off: 'a' } } },
    tiles: { E: { frame: 'e' }, '#': { frame: 'w' } },
    lighting,
    ...extra,
  };
}

const VIEW = { x: 0, y: 0, zoom: 1 };
const SIZE = { width: 64, height: 32 };

describe('light falloff', () => {
  it('is smooth from the intensity at the centre to 0 at the radius', () => {
    const stops = lightStops(0.8);
    expect(stops[0]).toEqual({ at: 0, alpha: 0.8 });
    expect(stops.at(-1)).toEqual({ at: 1, alpha: 0 });
    for (let i = 1; i < stops.length; i++) expect(stops[i]!.alpha).toBeLessThanOrEqual(stops[i - 1]!.alpha);
  });

  it('comes in flat bands with hard edges, then nothing past the radius', () => {
    const stops = lightStops(1, 3);
    expect(stops.map((s) => s.at)).toEqual([0, 1 / 3, 1 / 3, 2 / 3, 2 / 3, 1, 1]);
    expect(stops[0]!.alpha).toBe(1);
    expect(stops[1]!.alpha).toBe(1);
    expect(stops[2]!.alpha).toBeCloseTo(stops[3]!.alpha);
    expect(stops[2]!.alpha).toBeLessThan(1);
    expect(stops.at(-1)!.alpha).toBe(0);
  });
});

describe('flicker', () => {
  it('is the same for the same seed, key and step, in [-1, 1], and eased between its keys', () => {
    const a = Array.from({ length: 30 }, (_, i) => flickerNoise(7, 'torch:0', i, 6));
    expect(Array.from({ length: 30 }, (_, i) => flickerNoise(7, 'torch:0', i, 6))).toEqual(a);
    for (const v of a) expect(Math.abs(v)).toBeLessThanOrEqual(1);
    // On a key step the value is the key's own draw; the next key's is reached at the next key.
    expect(flickerNoise(7, 'torch:0', 6, 6)).toBe(flickerNoise(7, 'torch:0', 6, 6));
    expect(Math.abs(a[1]! - a[0]!)).toBeLessThan(Math.abs(a[6]! - a[0]!) + 1);
  });

  it('differs with another seed or another light', () => {
    const run = (seed: number, key: string) =>
      Array.from({ length: 12 }, (_, i) => flickerNoise(seed, key, i));
    expect(run(1, 'a')).not.toEqual(run(2, 'a'));
    expect(run(1, 'a')).not.toEqual(run(1, 'b'));
  });

  it('scales radius, intensity and glow by its amount, and nothing without one', () => {
    const base = { radius: 40, intensity: 0.8, glow: 0.2 };
    expect(flickered(base, undefined, 1)).toBe(base);
    const up = flickered(base, { amount: 0.25 }, 1);
    expect(up.radius).toBe(50);
    expect(up.intensity).toBeCloseTo(0.9);
    expect(up.glow).toBeCloseTo(0.25);
    expect(flickered(base, { amount: 0.25 }, -1, 0.5).radius).toBe(35);
  });
});

describe('darkness', () => {
  const lighting: LightingSpec = {
    ambient: { level: 0.3 },
    tags: { cold: { level: 0.5 }, dark: { color: '#102030', level: 0.9 } },
    maps: { crypt: { ambient: { level: 1 } }, store: { lights: [] } },
  };

  it("takes the map's own, else the first tag in file order, else the skin's", () => {
    expect(ambientFor(lighting, { id: 'crypt', tags: ['dark'] })?.level).toBe(1);
    expect(ambientFor(lighting, { id: 'hall', tags: ['dark', 'cold'] })?.level).toBe(0.5);
    expect(ambientFor(lighting, { id: 'store', tags: [] })?.level).toBe(0.3);
    expect(ambientFor({}, { id: 'x' })).toBeUndefined();
  });

  it("weights each part by how much of the view it covers (a room slide's two rooms)", () => {
    const slide: PresentMap = {
      ...MAP,
      id: 'a>b',
      cols: 8,
      tiles: ['........', '........'],
      parts: [
        { id: 'a', col: 0, row: 0, cols: 4, rows: 2, tags: [] },
        { id: 'b', col: 4, row: 0, cols: 4, rows: 2, tags: ['dark'] },
      ],
    };
    expect(blendedDarkness(lighting, slide, { x: 0, y: 0, w: 64, h: 32 })?.level).toBe(0.3);
    expect(blendedDarkness(lighting, slide, { x: 64, y: 0, w: 64, h: 32 })).toEqual({
      color: '#102030',
      level: 0.9,
    });
    const half = blendedDarkness(lighting, slide, { x: 32, y: 0, w: 64, h: 32 })!;
    expect(half.level).toBeCloseTo(0.6);
    expect(half.color).toBe('#081018');
    expect(blendedDarkness({}, slide, { x: 0, y: 0, w: 64, h: 32 })).toBeNull();
    expect(mapParts(MAP)).toEqual([{ id: 'hall', col: 0, row: 0, cols: 4, rows: 2, tags: ['dark'] }]);
  });
});

describe('SkinLighting', () => {
  it('lays out kind lights by state, tile lights and placed lights, in picture px', () => {
    const l = new SkinLighting(
      skin({
        kinds: { torch: [{ radius: 20, states: ['lit'], anchor: 'top', offset: { x: 0, y: 2 } }] },
        tiles: { E: { radius: 10, color: '#fff1c4' } },
        maps: { hall: { lights: [{ x: 20, y: 4, radius: 6, intensity: 0.5 }] } },
      }),
    );
    const torch = ent({ id: 't', kind: 'torch', anim: { state: 'lit', t: 0 } });
    const out = l.layout({
      frame: 0,
      entities: [torch, ent()],
      map: MAP,
      view: { x: 8, y: 0, zoom: 2 },
      size: SIZE,
    })!;
    expect(out.lights.map((d) => [d.key, d.x, d.y, d.radius, d.intensity])).toEqual([
      ['hall:0', 32, 8, 12, 0.5],
      ['tile:0:1,0', 40, 16, 20, 1],
      ['t:0', 40, 36, 40, 1],
    ]);
    expect(out.darkness).toBeNull();
    const off = l.layout({
      frame: 0,
      entities: [{ ...torch, anim: { state: 'off', t: 0 } }],
      map: null,
      view: VIEW,
      size: SIZE,
    })!;
    expect(off.lights).toEqual([]);
  });

  it('leaves out lights wholly off the picture', () => {
    const l = new SkinLighting(skin({ kinds: { hero: { radius: 8 } } }));
    const far = ent({ x: 200 });
    expect(l.layout({ frame: 0, entities: [far], map: null, view: VIEW, size: SIZE })!.lights).toEqual([]);
  });

  it("flashes an event's light, fading over its ticks, matched like the skin's events", () => {
    const l = new SkinLighting(
      skin({ events: { 'boom:big': { radius: 30, ticks: 4, glow: 0.4 }, boom: { radius: 10, ticks: 2 } } }),
    );
    l.event({ type: 'boom', result: 'big', x: 5, y: 6 }, [], 10);
    l.event({ type: 'boom', entity: 'hero' }, [ent()], 10);
    const at = (frame: number) =>
      l.layout({ frame, entities: [], map: null, view: VIEW, size: SIZE })!.lights;
    expect(at(10).map((d) => [d.x, d.y, d.radius, d.intensity, d.glow])).toEqual([
      [5, 6, 30, 1, 0.4],
      [24, 24, 10, 1, 0.2],
    ]);
    expect(at(12).map((d) => d.intensity)).toEqual([0.5]);
    expect(at(14)).toEqual([]);
    expect(l.flashesRunning).toBe(0);
  });

  it('flickers the same way for the same seed, another way for another', () => {
    const spec = skin({ kinds: { hero: { radius: 20, flicker: { amount: 0.3, rate: 3 } } } });
    const radii = (seed: number) => {
      const l = new SkinLighting(spec, { seed });
      return Array.from(
        { length: 10 },
        (_, f) =>
          l.layout({ frame: f, entities: [ent()], map: null, view: VIEW, size: SIZE })!.lights[0]!.radius,
      );
    };
    expect(radii(5)).toEqual(radii(5));
    expect(radii(5)).not.toEqual(radii(6));
    expect(new Set(radii(5)).size).toBeGreaterThan(1);
  });

  it('gives the vignette with its defaults, and none at strength 0', () => {
    const l = new SkinLighting(skin({ vignette: { strength: 0.4 }, bands: 4 }));
    const out = l.layout({ frame: 0, entities: [], map: null, view: VIEW, size: SIZE })!;
    expect(out.vignette).toEqual({ color: '#000000', strength: 0.4, inner: 0.45 });
    expect(out.bands).toBe(4);
    const none = new SkinLighting(skin({ vignette: { strength: 0 } }));
    expect(none.layout({ frame: 0, entities: [], map: null, view: VIEW, size: SIZE })!.vignette).toBeNull();
    expect(
      new SkinLighting({ backend: 'canvas2d', kinds: {} }).layout({
        frame: 0,
        entities: [],
        map: null,
        view: VIEW,
        size: SIZE,
      }),
    ).toBeNull();
  });

  it("cycles a placed light's sprite frames, at each part's place", () => {
    const sprite = { frames: ['f0', 'f1'], ticks: 3, x: 2, y: -2 };
    const l = new SkinLighting(skin({ maps: { a: { lights: [{ x: 0, y: 0, radius: 4, sprite }] } } }));
    const slide: PresentMap = { ...MAP, id: 'b>a', parts: [{ id: 'a', col: 4, row: 0, cols: 4, rows: 2 }] };
    expect(l.props(slide, 0)).toEqual([{ sheet: undefined, frame: 'f0', x: 66, y: -2 }]);
    expect(l.props(slide, 3)[0]!.frame).toBe('f1');
    expect(l.props(slide, 6)[0]!.frame).toBe('f0');
    expect(l.props(MAP, 0)).toEqual([]);
  });
});

describe('room-wide particles', () => {
  const s = skin(
    {
      particles: [
        { emit: 'dust', tags: ['dark'], prewarm: 60 },
        { emit: 'dust', maps: ['other'] },
      ],
    },
    { emitters: { dust: { rate: 0.5, life: 200, speed: 0, size: 1 } } },
  );

  it('fill the map from the first frame it shows, spread over its whole box, the same each time', () => {
    const run = () => {
      const p = new SkinParticles(s, { seed: 2 });
      p.update(100, [], MAP);
      return p.particles();
    };
    const first = run();
    expect(first.length).toBe(30);
    for (const v of first) {
      expect(v.x).toBeGreaterThanOrEqual(0);
      expect(v.x).toBeLessThanOrEqual(64);
      expect(v.y).toBeGreaterThanOrEqual(0);
      expect(v.y).toBeLessThanOrEqual(32);
    }
    expect(run()).toEqual(first);
  });

  it('only on maps the entry names by tag or id, and start afresh on another map', () => {
    const p = new SkinParticles(s, { seed: 2 });
    p.update(0, [], { ...MAP, tags: [] });
    expect(p.particles()).toEqual([]);
    p.update(1, [], MAP);
    expect(p.ambient.count).toBe(30);
    p.update(2, [], { ...MAP, id: 'other', tags: [] });
    expect(p.ambient.count).toBe(60);
    p.update(3, [], null);
    expect(p.ambient.count).toBe(0);
  });
});

describe('the lighting schema', () => {
  it('names a bad field', () => {
    const bad = lightingSchema.safeParse({ kinds: { hero: { radius: -1 } }, vignette: { strength: 2 } });
    expect(bad.success).toBe(false);
    expect(bad.error!.issues.map((i) => i.path.join('.'))).toEqual([
      'kinds.hero.radius',
      'vignette.strength',
    ]);
  });

  it("checks the skin's references: kinds, tiles, event keys, emitters, and 2D only", () => {
    const res = skinSchema.safeParse(
      skin({
        kinds: { ghost: { radius: 4 } },
        tiles: { Q: { radius: 4 } },
        events: { 'a:b:c=d': { radius: 4, ticks: 2 } },
        particles: [{ emit: ['nope'] }],
      }),
    );
    expect(res.success).toBe(false);
    const issues = res.error!.issues.map((i) => [
      i.path.join('.'),
      (i as { params?: { code?: string } }).params?.code,
    ]);
    expect(issues).toEqual([
      ['lighting.kinds.ghost', 'missing_ref'],
      ['lighting.tiles.Q', 'missing_ref'],
      ['lighting.events.a:b:c=d', 'bad_event_key'],
      ['lighting.particles.0.emit.0', 'missing_ref'],
    ]);
    const three = skinSchema.safeParse({
      backend: 'three',
      kinds: {},
      lighting: { ambient: { level: 0.5 } },
    });
    expect(three.error!.issues.map((i) => i.path.join('.'))).toEqual(['lighting']);
  });
});
