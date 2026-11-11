import { describe, expect, it } from 'vitest';
import type { Container } from 'pixi.js';
import { Sprite, Texture } from 'pixi.js';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { SpriteSheet } from '@engine/core/gfx/spritesheet';
import { SkinnedPresenter } from '@engine/core/draw';
import { freezeFrame, type PresentFrame, type PresentMap, type SkinFile } from '@engine/core/present';
import { buildFont, type FontLookup } from '@engine/core/ui';
import { PixiPresenter, type PixiPresenterOptions } from './presenter';
import { glowHalo, PixiRenderer, TintedImage } from './renderer';
import { skinSetPixiPresenter } from './skin-set';
import { PixiSurfaces } from './surface';
import { PixiUiPainter } from './ui-painter';

// The PixiJS presenter (Engine 0.16 T13b-3): the shared skinned walk on a PixiRenderer, checked
// through the display list it leaves on `stage` (pixi.js builds it in Node; nothing renders).
// Fixture skins and sheets are inline: backends never import a kit or a game skin.

/** Each frame at its own x, so a sprite's texture frame tells which frame it is. */
const HERO: SpriteSheet = {
  id: 'hero',
  image: null,
  frames: new Map([
    ['down-0', { x: 0, y: 0, w: 16, h: 16 }],
    ['side-0', { x: 16, y: 0, w: 16, h: 16 }],
    ['run-1', { x: 32, y: 0, w: 16, h: 16 }],
    ['hill', { x: 48, y: 0, w: 16, h: 8 }],
  ]),
};
const WALLS: SpriteSheet = {
  id: 'walls',
  image: null,
  frames: new Map([['wall', { x: 0, y: 0, w: 16, h: 16 }]]),
};
const SHEETS: Record<string, SpriteSheet> = { hero: HERO, walls: WALLS };
const lookup = (id: string) => SHEETS[id] ?? null;

const MAP: PresentMap = { id: 'room', version: 0, tileSize: 16, cols: 3, rows: 2, tiles: ['#..', '...'] };
const BIG: PresentMap = { ...MAP, id: 'big', cols: 20, rows: 10, tiles: Array(10).fill('.'.repeat(20)) };

const SKIN: SkinFile = {
  backend: 'canvas2d',
  sheets: { sheet: 'hero', fallbackColor: '#00a800' },
  camera: { follow: 'hero' },
  kinds: {
    hero: {
      frames: {
        idle: { down: 'down-0', right: 'side-0' },
        run: { frames: ['down-0', 'run-1'], ticks: [2, 3], events: { 1: 'footstep' } },
      },
      spawnTween: { prop: 'scale', from: 2, to: 1, frames: 2 },
    },
    torch: { frames: { idle: 'down-0' }, blend: 'add', glow: { color: '#f8b800', radius: 4 } },
  },
  tiles: { '#': { sheet: 'walls', frame: 'wall' } },
  emitters: {
    sparks: { burst: 3, life: 4, speed: 1, angle: [180, 360], blend: 'add', glow: 3, color: '#fcd800' },
  },
  events: {
    footstep: { sound: 'step' },
    burst: { emit: ['sparks'] },
    stomp: { sound: 'thud', emit: ['sparks'], shake: { amount: 6, ticks: 8 }, hitPause: { ticks: 4 } },
    hurt: { flash: { color: '#d82800', alpha: 0.8, ticks: 4 } },
    zap: { effect: { kind: 'tint', color: '#0000fc', ticks: 4 } },
  },
  parallax: [
    { gradient: ['#3cbcfc', '#a4e4fc'], bands: 2, factor: 0 },
    { frame: 'hill', factor: { x: 0.5, y: 0 }, y: 10 },
  ],
};

function frame(over: Partial<PresentFrame> = {}): PresentFrame {
  return {
    frame: 0,
    size: { width: 48, height: 32 },
    entities: [],
    map: MAP,
    events: [],
    status: {},
    ...over,
  };
}

const hero = (over: Partial<PresentFrame['entities'][number]> = {}): PresentFrame['entities'][number] => ({
  id: 'hero',
  kind: 'hero',
  x: 0,
  y: 0,
  w: 16,
  h: 16,
  facing: 'down',
  anim: { state: 'idle', t: 0 },
  tags: [],
  ...over,
});
const torch = hero({ id: 'torch', kind: 'torch', x: 20, y: 8, w: 8, h: 8 });

function setup(skin: SkinFile = SKIN, opts: PixiPresenterOptions = {}) {
  const r = new PixiRenderer({ size: { width: 48, height: 32 } });
  const p = new PixiPresenter(r, skin, lookup, { size: { width: 48, height: 32 }, ...opts });
  return { r, p };
}

/** Every display object under `root`, depth first, with the containers it sits in. */
function flat(root: Container): { obj: Container; parents: Container[] }[] {
  const out: { obj: Container; parents: Container[] }[] = [];
  const walk = (c: Container, parents: Container[]) => {
    for (const child of c.children) {
      out.push({ obj: child, parents });
      walk(child, [...parents, child]);
    }
  };
  walk(root, []);
  return out;
}

const sprites = (root: Container) =>
  flat(root).filter((e): e is { obj: Sprite; parents: Container[] } => e.obj instanceof Sprite);
const boxes = (root: Container) => sprites(root).filter((e) => e.obj.texture === Texture.WHITE);
const halos = (root: Container) => sprites(root).filter((e) => e.obj.texture === glowHalo());
/** Sprites cut from `sheet` (by its frames' x), as `frameX@x,y`. */
const sheetSprites = (root: Container, source: unknown) =>
  sprites(root).filter((e) => e.obj.texture.source === source);
/** The hero's sprites (sheet `hero`, not the parallax hill). */
const heroSprites = (r: PixiRenderer) =>
  sheetSprites(r.stage, r.sourceOf(HERO)).filter((e) => e.obj.texture.frame.x !== 48);
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

describe('PixiPresenter (Engine 0.16 T13b-3)', () => {
  it('caches the map on a RenderTexture surface once per version and copies it as one sprite', () => {
    const { r, p } = setup();
    p.present(freezeFrame(frame({ frame: 0, map: MAP })));
    expect(p.surfaces.waiting).toHaveLength(1);
    const surface = p.surfaces.waiting[0]!;
    // The wall tile drawn on the surface's own display list, from the main renderer's source.
    const tiles = sprites(surface.renderer.stage);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]!.obj.texture.source).toBe(r.sourceOf(WALLS));
    const copies = sheetSprites(r.stage, surface.texture.source);
    expect(copies).toHaveLength(1);
    // A 48x32 map in a 48x32 picture: copied at 0,0, the whole surface.
    expect([copies[0]!.obj.texture.frame.width, copies[0]!.obj.texture.frame.height]).toEqual([48, 32]);
    p.present(freezeFrame(frame({ frame: 1, map: { id: 'room', version: 0 } })));
    expect(p.surfaces.waiting).toHaveLength(1);
    expect(sheetSprites(r.stage, surface.texture.source)).toHaveLength(1);
    // Flushed: rendered into the texture once and let go.
    const rendered: unknown[] = [];
    p.surfaces.flush({ render: (o) => void rendered.push(o.target) });
    expect(rendered).toEqual([surface.texture]);
    expect(p.surfaces.waiting).toHaveLength(0);
  });

  it("draws an animation's frames by their own ticks", () => {
    const { r, p } = setup();
    const shown: number[] = [];
    for (let t = 0; t < 6; t++) {
      p.present(freezeFrame(frame({ frame: t, entities: [hero({ anim: { state: 'run', t } })] })));
      shown.push(heroSprites(r)[0]!.obj.texture.frame.x);
    }
    // down-0 two ticks, run-1 three, then down-0 again.
    expect(shown).toEqual([0, 0, 32, 32, 32, 0]);
  });

  it('plays sounds once per frame number, asks for hit-pauses and counts particles like the canvas', () => {
    const run = (make: (opts: PixiPresenterOptions) => SkinnedPresenter) => {
      const sounds: string[] = [];
      const paused: number[] = [];
      const p = make({ onSound: (id) => sounds.push(id), onHitPause: (t) => paused.push(t), seed: 2 });
      const counts: unknown[] = [];
      for (let t = 0; t < 8; t++) {
        const f = freezeFrame(
          frame({
            frame: t,
            map: BIG,
            entities: [hero({ x: 100, y: 60, anim: { state: 'run', t } })],
            events: t === 3 ? [{ type: 'stomp', x: 104, y: 70 }] : [],
          }),
        );
        p.present(f);
        p.present(f);
        counts.push([p.particleCount, p.focus()]);
      }
      return { sounds, paused, counts };
    };
    const size = { width: 48, height: 32 };
    const pixi = run((o) => new PixiPresenter(new PixiRenderer({ size }), SKIN, lookup, { size, ...o }));
    const noop: Renderer = { clear() {}, rect() {}, sprite() {}, text() {}, debugText() {}, line() {} };
    const canvas = run((o) => new SkinnedPresenter(noop, SKIN, lookup, { size, ...o }));
    expect(pixi.sounds).toEqual(['step', 'thud', 'step']);
    expect(pixi.paused).toEqual([4]);
    expect(pixi).toEqual(canvas);
  });

  it('draws additive, glowing particles after the entities, each with a halo behind it', () => {
    const { r, p } = setup();
    p.present(freezeFrame(frame({ entities: [hero()], events: [{ type: 'burst', x: 10, y: 10 }] })));
    const list = flat(r.stage).map((e) => e.obj);
    // Additive: the blend mode is on each sprite (no container per particle, T13b-7).
    const add = list.findIndex((o) => o.blendMode === 'add');
    expect(add).toBeGreaterThan(
      list.findIndex((o) => o instanceof Sprite && o.texture.source === r.sourceOf(HERO)),
    );
    const sparks = boxes(r.stage).filter((e) => e.obj.tint === 0xfcd800);
    expect(sparks.map((e) => [e.obj.x, e.obj.y, e.obj.scale.x, e.obj.blendMode])).toEqual([
      [10, 10, 1, 'add'],
      [10, 10, 1, 'add'],
      [10, 10, 1, 'add'],
    ]);
    const glow = halos(r.stage);
    expect(glow.every((e) => e.obj.blendMode === 'add')).toBe(true);
    expect(glow.map((e) => hex(e.obj.tint))).toEqual(['#fcd800', '#fcd800', '#fcd800']);
    // Each halo is just behind its spark: the 1 px box grown by 3 on every side.
    for (const h of glow) {
      const siblings = h.obj.parent!.children;
      expect(siblings[siblings.indexOf(h.obj) + 1]).toBeInstanceOf(Sprite);
      expect([h.obj.x, h.obj.y]).toEqual([7, 7]);
    }
  });

  it("draws a kind's blend and glow as add sprites, a tinted halo behind the sprite", () => {
    const { r, p } = setup();
    p.present(freezeFrame(frame({ entities: [torch] })));
    const inside = sprites(r.stage).filter((e) => e.obj.blendMode === 'add');
    expect(inside.map((e) => (e.obj.texture === glowHalo() ? `halo ${hex(e.obj.tint)}` : 'torch'))).toEqual([
      'halo #f8b800',
      'torch',
    ]);
    // The halo spans the 16x16 sprite at (20, 8) grown by 4.
    const halo = inside[0]!.obj;
    expect([halo.x, halo.y, halo.width, halo.height]).toEqual([16, 4, 24, 24]);
  });

  it('draws the parallax layers, then the map copy, then the entities', () => {
    const { r, p } = setup();
    p.present(freezeFrame(frame({ map: BIG, entities: [hero({ x: 152, y: 72 })] })));
    const order = sprites(r.stage).map(({ obj }) => {
      if (obj.texture === Texture.WHITE) return `box ${hex(obj.tint)}`;
      if (obj.texture.source === r.sourceOf(HERO)) return obj.texture.frame.x === 48 ? 'hill' : 'hero';
      return 'map';
    });
    expect(order.slice(0, 3)).toEqual(['box #000000', 'box #3cbcfc', 'box #a4e4fc']);
    const firstMap = order.indexOf('map');
    expect(order.slice(3, firstMap).every((o) => o === 'hill')).toBe(true);
    expect(order.slice(firstMap + 1)).toEqual(['hero']);
  });

  it('lays a spawn tween over the sprite as a transform container', () => {
    const { r, p } = setup();
    p.present(freezeFrame(frame({ entities: [hero({ x: 10, y: 4 })] })));
    const heroAt = heroSprites(r)[0]!;
    // Scaled 2x about the bottom centre (18, 20).
    const t = heroAt.parents[heroAt.parents.length - 1]!;
    expect([t.x, t.y, t.scale.x, t.scale.y]).toEqual([18, 20, 2, 2]);
    p.present(freezeFrame(frame({ frame: 2, entities: [hero({ x: 10, y: 4 })] })));
    expect(heroSprites(r)[0]!.parents).toEqual([]);
  });

  it('draws flash and tint overlays over the picture as translucent boxes', () => {
    const { r, p } = setup();
    p.present(freezeFrame(frame({ frame: 0, entities: [hero()] })));
    p.present(
      freezeFrame(frame({ frame: 1, entities: [hero()], events: [{ type: 'hurt' }, { type: 'zap' }] })),
    );
    const overlays = boxes(r.stage)
      .filter((e) => e.obj.tint === 0xd82800 || e.obj.tint === 0x0000fc)
      .map((e) => [hex(e.obj.tint), e.obj.scale.x, e.obj.scale.y, e.obj.alpha, e.parents.length]);
    expect(overlays).toEqual([
      ['#0000fc', 48, 32, 0.4, 0],
      ['#d82800', 48, 32, 0.8, 0],
    ]);
    // Both after the hero.
    const list = flat(r.stage).map((e) => e.obj);
    const heroAt = list.findIndex((o) => o instanceof Sprite && o.texture.source === r.sourceOf(HERO));
    expect(list.findIndex((o) => o instanceof Sprite && o.tint === 0xd82800)).toBeGreaterThan(heroAt);
    // Reduced flashing skips the flash.
    const calm = setup(SKIN, { reduceFlashing: true });
    calm.p.present(freezeFrame(frame({ frame: 0 })));
    calm.p.present(freezeFrame(frame({ frame: 1, events: [{ type: 'hurt' }] })));
    expect(boxes(calm.r.stage).some((e) => e.obj.tint === 0xd82800)).toBe(false);
  });

  it('gives the same display list for the same frames on two runs', () => {
    const run = () => {
      const { r, p } = setup(SKIN, { seed: 4 });
      const out: unknown[] = [];
      for (let t = 0; t < 6; t++) {
        p.present(
          freezeFrame(
            frame({
              frame: t,
              map: BIG,
              entities: [hero({ x: 100 + t, y: 60 }), torch],
              events: t === 1 ? [{ type: 'stomp', x: 100, y: 70 }] : [],
            }),
          ),
        );
        out.push(
          sprites(r.stage).map(({ obj }) => [obj.x, obj.y, obj.tint, obj.alpha, obj.scale.x, obj.scale.y]),
        );
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});

describe('PixiPresenter: the UI kit HUD and glyph tint (Engine 0.16 T13b-3)', () => {
  const FONT = buildFont('f', { cell: { w: 2, h: 2 }, baseline: 2, glyphs: { L: { rows: ['#.', '##'] } } });
  const fonts: FontLookup = (id) => (id === 'f' ? FONT : null);
  const skin: SkinFile = {
    backend: 'canvas2d',
    sheets: { sheet: 'hero' },
    kinds: {},
    hud: [
      { status: 'hp', as: 'bar', x: 0, y: 0, w: 6, h: 3, max: 2, back: '#000' },
      { as: 'text', x: 10, y: 0, font: 'f', format: 'L', color: '#ff0' },
      { as: 'text', x: 20, y: 0, font: 'f', format: 'L', color: '#0f0' },
    ],
  };

  it('paints bars as boxes and text from one white glyph strip, tinted per colour', () => {
    const r = new PixiRenderer({ size: { width: 64, height: 32 } });
    const p = new PixiPresenter(r, skin, lookup, { fonts });
    p.present(
      freezeFrame({ frame: 0, size: { width: 64, height: 32 }, entities: [], events: [], status: { hp: 1 } }),
    );
    expect(
      boxes(r.stage).map((e) => [hex(e.obj.tint), e.obj.x, e.obj.y, e.obj.scale.x, e.obj.scale.y]),
    ).toEqual([
      ['#000000', 0, 0, 64, 32],
      ['#000000', 0, 0, 6, 3],
      ['#00a800', 0, 0, 3, 3],
    ]);
    // One strip, drawn in white once on a RenderTexture surface.
    expect(p.surfaces.waiting).toHaveLength(1);
    const strip = p.surfaces.waiting[0]!;
    expect(boxes(strip.renderer.stage).map((e) => hex(e.obj.tint))).toEqual(['#ffffff', '#ffffff']);
    const glyphs = sheetSprites(r.stage, strip.texture.source);
    expect(glyphs.map((e) => [hex(e.obj.tint), e.obj.x, e.obj.y])).toEqual([
      ['#ffff00', 11, 1],
      ['#00ff00', 21, 1],
    ]);
  });

  it('PixiUiPainter draws glyphs tinted from the shared surfaces', () => {
    const r = new PixiRenderer({ size: { width: 64, height: 32 } });
    const surfaces = new PixiSurfaces(r);
    const painter = new PixiUiPainter(r, lookup, fonts, surfaces);
    painter.glyph({ kind: 'glyph', font: 'f', ch: 'L', x: 4, y: 5, color: 'rgba(255, 0, 0, 0.5)' });
    painter.fill({ kind: 'fill', x: 1, y: 2, w: 3, h: 4, color: '#fff', alpha: 0.5 });
    const [glyph] = sprites(r.stage);
    expect(glyph!.obj.texture.source).toBe(surfaces.waiting[0]!.texture.source);
    expect([hex(glyph!.obj.tint), glyph!.obj.alpha]).toEqual(['#ff0000', 0.5]);
    const fill = boxes(r.stage)[0]!;
    expect([fill.obj.scale.x, fill.obj.alpha]).toEqual([3, 0.5]);
  });

  it('turns a TintedImage sheet into sprites of its texture with that tint', () => {
    const r = new PixiRenderer({ size: { width: 8, height: 8 } });
    const white = Texture.WHITE;
    const sheet: SpriteSheet = {
      id: 'tinted',
      image: new TintedImage(white, '#123456') as unknown as SpriteSheet['image'],
      frames: new Map([['a', { x: 0, y: 0, w: 1, h: 1 }]]),
    };
    r.sprite(sheet, 'a', 2, 3);
    const s = r.stage.children[0] as Sprite;
    expect([s.texture.source, s.tint]).toEqual([white.source, 0x123456]);
  });
});

describe('skinSetPixiPresenter', () => {
  it("draws a mini game's frames through its skin on the same renderer and surfaces", () => {
    const r = new PixiRenderer({ size: { width: 48, height: 32 } });
    const round: SkinFile = { ...SKIN, background: '#456' };
    const set = skinSetPixiPresenter(r, {
      skin: SKIN,
      rounds: { duel: round },
      sheet: lookup,
      screen: { width: 48, height: 32 },
    });
    set.present(freezeFrame(frame({ status: { miniGame: 'duel' } })));
    expect(hex((r.stage.children[0] as Sprite).tint)).toBe('#445566');
    set.present(freezeFrame(frame({ frame: 1 })));
    expect(hex((r.stage.children[0] as Sprite).tint)).toBe('#000000');
  });
});

describe('PixiPresenter lighting (Engine 0.16 part D, D1)', () => {
  it('draws the darkness on a live surface rendered every frame, the lights erased out of it', () => {
    const lit: SkinFile = {
      ...SKIN,
      lighting: { ambient: { color: '#000010', level: 0.8 }, kinds: { hero: { radius: 24 } } },
    };
    const { r, p } = setup(lit);
    const rendered: Texture[] = [];
    const gpu = { render: (o: { target: Texture }) => void rendered.push(o.target) };
    p.present(freezeFrame(frame({ frame: 0, map: MAP })));
    p.surfaces.flush(gpu);
    expect(rendered).toHaveLength(2); // the map once, the light map
    p.present(freezeFrame(frame({ frame: 1, map: { id: 'room', version: 0 } })));
    p.surfaces.flush(gpu);
    expect(rendered).toHaveLength(3); // the light map again, the map not
    // The light map is copied over the picture at the darkness level.
    const copy = sprites(r.stage).find((e) => e.obj.texture.source === rendered[1]!.source);
    expect(copy?.obj.alpha).toBeCloseTo(0.8);
  });
});
