import { describe, expect, it } from 'vitest';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { SpriteSheet } from '@engine/core/gfx/spritesheet';
import { freezeFrame, type PresentFrame, type PresentMap, type SkinFile } from '@engine/core/present';
import { SkinnedCanvasPresenter, type MapSurface } from './presenter';
import { skinSetCanvasPresenter } from './skin-set';

/** A renderer that records every call as a line of text; `transform` records and draws locally. */
function recorder(withTransform = true) {
  const calls: string[] = [];
  const r: Renderer = {
    clear: (c) => calls.push(`clear ${c}`),
    rect: (x, y, w, h, c) => calls.push(`rect ${x},${y} ${w}x${h} ${c}`),
    sprite: (s, f, x, y, flipX, _flipY, _rotate, scale) =>
      calls.push(
        `sprite ${s.id}:${f} ${x},${y}${flipX ? ' flip' : ''}${scale !== undefined && scale !== 1 ? ` x${scale}` : ''}`,
      ),
    text: (font, str, x, y) => calls.push(`text ${font.id} "${str}" ${x},${y}`),
    debugText: () => {},
    line: () => {},
  };
  if (withTransform) {
    r.transform = (x, y, angle, sx, sy, draw) => {
      calls.push(`transform ${x},${y} ${angle} ${sx},${sy}`);
      draw(r);
      calls.push('end');
    };
  }
  return { r, calls };
}

function sheet(id: string, frames: Record<string, [number, number]>): SpriteSheet {
  return {
    id,
    image: null,
    frames: new Map(Object.entries(frames).map(([k, [w, h]]) => [k, { x: 0, y: 0, w, h }])),
  };
}

const SHEETS: Record<string, SpriteSheet> = {
  hero: sheet('hero', { 'down-0': [16, 16], 'side-0': [16, 16], heart: [7, 7] }),
  walls: sheet('walls', { wall: [16, 16] }),
  font: sheet('font', { '0': [8, 8] }),
};
const lookup = (id: string) => SHEETS[id] ?? null;

/** A fixture skin (inline: backends never import kits or games). */
const SKIN: SkinFile = {
  backend: 'canvas2d',
  sheets: { sheet: 'hero', fallbackColor: '#00a800' },
  kinds: {
    hero: { frames: { idle: { down: 'down-0', right: 'side-0' } }, flipFacing: true },
    ghost: { frames: { idle: 'not-drawn-yet' }, fallbackColor: '#f00' },
  },
  tiles: {
    '#': { sheet: 'walls', frame: 'wall', fallbackColor: '#777' },
    '+': { frame: 'missing', fallbackColor: '#00f' },
  },
  events: { hit: { sound: 'hurt', effect: { kind: 'flash', color: '#fff', ticks: 2 } }, step: {} },
  hud: [
    { status: 'health', as: 'hearts', x: 8, y: 8, frame: 'heart' },
    { status: 'score', as: 'number', x: 200, y: 8 },
  ],
};

const MAP: PresentMap = { id: 'room', version: 0, tileSize: 16, cols: 3, rows: 2, tiles: ['#+.', '...'] };

/** A frame on the fixture map; `noMap` leaves the map out. */
function frame(over: Partial<PresentFrame> & { noMap?: boolean } = {}): PresentFrame {
  const { noMap, ...rest } = over;
  const f: PresentFrame = {
    frame: 0,
    size: { width: 48, height: 32 },
    entities: [],
    map: MAP,
    events: [],
    status: {},
    ...rest,
  };
  if (noMap) delete f.map;
  return f;
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

/** A presenter whose map cache is a second recording renderer. */
function setup(opts: { onSound?: (id: string) => void; withTransform?: boolean } = {}) {
  const screen = recorder(opts.withTransform);
  const cache = recorder();
  let surfaces = 0;
  const mapSurface = (): MapSurface => {
    surfaces++;
    return { renderer: cache.r, image: null };
  };
  const p = new SkinnedCanvasPresenter(screen.r, SKIN, lookup, { mapSurface, ...opts });
  return { p, screen: screen.calls, cache: cache.calls, surfaces: () => surfaces };
}

describe('SkinnedCanvasPresenter', () => {
  it('draws the map tiles once per version and copies the cache every frame', () => {
    const s = setup();
    s.p.present(frame());
    expect(s.cache).toEqual(['sprite walls:wall 0,0', 'rect 16,0 16x16 #00f']);
    s.p.present(frame({ frame: 1, map: { id: 'room', version: 0 } }));
    s.p.present(frame({ frame: 2, map: MAP }));
    expect(s.surfaces()).toBe(1);
    expect(s.screen.filter((c) => c.startsWith('sprite map:'))).toEqual([
      'sprite map:room@0:map 0,0',
      'sprite map:room@0:map 0,0',
      'sprite map:room@0:map 0,0',
    ]);
    s.p.present(frame({ frame: 3, map: { ...MAP, version: 1, tiles: ['...', '..#'] } }));
    expect(s.surfaces()).toBe(2);
    expect(s.cache.at(-1)).toBe('sprite walls:wall 32,16');
    expect(s.screen.at(-1)).toBe('sprite map:room@1:map 0,0');
  });

  it("places a layer tile's anchored frame on its cell, and draws terrain tiles at their corner (0.16 part C T1)", () => {
    const props: SpriteSheet = {
      id: 'props',
      image: null,
      frames: new Map([
        ['bush', { x: 0, y: 0, w: 32, h: 24, anchor: 'bottom' as const }],
        ['tuft', { x: 0, y: 0, w: 16, h: 16 }],
      ]),
    };
    const skin: SkinFile = {
      ...SKIN,
      tiles: { ...SKIN.tiles, b: { sheet: 'props', frame: 'bush' }, t: { sheet: 'props', frame: 'tuft' } },
    };
    const cache = recorder();
    const p = new SkinnedCanvasPresenter(recorder().r, skin, (id) => (id === 'props' ? props : lookup(id)), {
      mapSurface: () => ({ renderer: cache.r, image: null }),
    });
    p.present(frame({ map: { ...MAP, layers: [{ name: 'decor', tiles: ['...', 'b.t'] }] } }));
    // The 32x24 bush stands on cell (0, 1)'s bottom centre; the tuft has no anchor.
    expect(cache.calls.slice(-2)).toEqual(['sprite props:bush -8,8', 'sprite props:tuft 32,16']);
  });

  it("draws a frame by tag for an entity with that tag, and the kind's frame otherwise (G30)", () => {
    const skin: SkinFile = {
      ...SKIN,
      kinds: {
        ...SKIN.kinds,
        hero: {
          ...SKIN.kinds['hero']!,
          byTag: [
            { tag: 'burnt', sheet: 'walls', frames: { idle: 'wall' } },
            { tag: 'ghostly', fallbackColor: '#0ff', frames: { idle: 'missing' } },
          ],
        },
      },
    };
    const { r, calls } = recorder();
    const p = new SkinnedCanvasPresenter(r, skin, lookup, { mapSurface: () => null });
    p.present(
      freezeFrame(
        frame({
          noMap: true,
          entities: [
            hero({ id: 'a' }),
            hero({ id: 'b', x: 16, tags: ['armed', 'burnt'] }),
            hero({ id: 'c', x: 32, tags: ['ghostly'] }),
            hero({ id: 'd', x: 48, tags: ['armed'], facing: 'left' }),
          ],
        }),
      ),
    );
    expect(calls.filter((c) => c.startsWith('sprite') || c.startsWith('rect'))).toEqual([
      'sprite hero:down-0 0,0',
      'sprite walls:wall 16,0',
      'rect 32,0 16x16 #0ff',
      'sprite hero:side-0 48,0 flip',
    ]);
  });

  it('draws the tiles every frame when there is no surface to cache them on', () => {
    const { r, calls } = recorder();
    const p = new SkinnedCanvasPresenter(r, SKIN, lookup, { mapSurface: () => null });
    p.present(frame());
    p.present(frame({ frame: 1, map: { id: 'room', version: 0 } }));
    expect(calls.filter((c) => c.startsWith('sprite walls:wall'))).toHaveLength(2);
  });

  it('draws entities by layer, keeping list order on ties (no y-sort)', () => {
    const s = setup();
    const ent = (id: string, y: number, layer?: number) => ({
      ...hero({ id, kind: 'ghost', x: id.length, y }),
      ...(layer === undefined ? {} : { layer }),
    });
    s.p.present(
      frame({
        noMap: true,
        entities: [ent('a', 30, 1), ent('bb', 20), ent('ccc', 10), ent('dddd', 10), ent('eeeee', 0, -1)],
      }),
    );
    expect(s.screen.filter((c) => c.startsWith('rect')).map((c) => c.split(' ')[1])).toEqual([
      '5,0',
      '2,20',
      '3,10',
      '4,10',
      '1,30',
    ]);
  });

  it('draws a 16x16 pickup a boomerang carries over the boomerang, though its y is smaller', () => {
    const s = setup();
    // As the top-down kit emits it: the boomerang (8x8 at y 40), then the carried pickup centred
    // on it at y 40 + 4 - 8 = 36, both at layer 20.
    s.p.present(
      frame({
        noMap: true,
        entities: [
          hero({ id: 'boom', kind: 'ghost', x: 1, y: 40, w: 8, h: 8, layer: 20 }),
          hero({ id: 'heart', kind: 'ghost', x: 2, y: 36, w: 16, h: 16, layer: 20, tags: ['carried'] }),
        ],
      }),
    );
    expect(s.screen.filter((c) => c.startsWith('rect')).map((c) => c.split(' ')[1])).toEqual([
      '1,40',
      '2,36',
    ]);
  });

  it('flips the side frame for a left-facing entity', () => {
    const s = setup();
    s.p.present(
      frame({
        noMap: true,
        entities: [hero({ facing: 'left' }), hero({ id: 'h2', facing: 'right', x: 20 })],
      }),
    );
    expect(s.screen).toContain('sprite hero:side-0 0,0 flip');
    expect(s.screen).toContain('sprite hero:side-0 20,0');
  });

  it('draws a fallback box when the frame or the kind is missing', () => {
    const s = setup();
    s.p.present(
      frame({
        noMap: true,
        entities: [hero({ kind: 'ghost', x: 4, y: 6, w: 10, h: 12 }), hero({ kind: 'bat', x: 30 })],
      }),
    );
    expect(s.screen).toContain('rect 4,6 10x12 #f00');
    expect(s.screen).toContain('rect 30,0 16x16 #00a800');
  });

  it('draws the HUD from status', () => {
    const s = setup();
    s.p.present(frame({ status: { health: 3, score: 120 } }));
    expect(s.screen.slice(-4)).toEqual([
      'sprite hero:heart 8,8',
      'sprite hero:heart 16,8',
      'sprite hero:heart 24,8',
      'text font "120" 200,8',
    ]);
    const t = setup();
    t.p.present(frame({ status: {} }));
    expect(t.screen.some((c) => c.includes('heart') || c.startsWith('text'))).toBe(false);
  });

  it('draws no HUD while showHud is off (Engine 0.16 part C T1: under the title), and again once on', () => {
    const s = setup();
    s.p.showHud(false);
    s.p.present(frame({ status: { health: 3, score: 120 } }));
    expect(s.screen.some((c) => c.includes('heart') || c.startsWith('text'))).toBe(false);
    s.p.showHud(true);
    s.p.present(frame({ frame: 1, status: { health: 3, score: 120 } }));
    expect(s.screen.slice(-1)).toEqual(['text font "120" 200,8']);
  });

  it('frames the camera: follows the hint, clamps into the map and centres a small map', () => {
    const big: PresentMap = { ...MAP, id: 'big', cols: 10, rows: 10, tiles: Array(10).fill('.'.repeat(10)) };
    const s = setup();
    s.p.present(frame({ map: big, entities: [hero({ x: 80, y: 80 })], camera: { x: 88, y: 88 } }));
    expect(s.screen).toContain('sprite map:big@0:map -64,-72');
    expect(s.screen).toContain('sprite hero:down-0 16,8');
    // Clamped at the map's far corner (160 - 48, 160 - 32).
    s.p.present(frame({ frame: 1, map: big, camera: { x: 500, y: 500 } }));
    expect(s.screen).toContain('sprite map:big@0:map -112,-128');
    // A map smaller than the picture is centred: 32x16 in 48x32.
    const small: PresentMap = { ...MAP, id: 'small', cols: 2, rows: 1, tiles: ['..'] };
    s.p.present(frame({ frame: 2, map: small, camera: { x: 0, y: 0 } }));
    expect(s.screen).toContain('sprite map:small@0:map 8,8');
  });

  it("follows the skin's camera entity when the frame gives no hint", () => {
    const { r, calls } = recorder();
    const skin: SkinFile = { ...SKIN, camera: { follow: 'hero' } };
    const p = new SkinnedCanvasPresenter(r, skin, lookup, { mapSurface: () => null, clamp: false });
    p.present(frame({ noMap: true, entities: [hero({ x: 100, y: 50 })] }));
    expect(calls).toContain('sprite hero:down-0 16,8');
  });

  describe('camera', () => {
    /** 20x10 tiles of 16 px: 320x160, in a 48x32 picture. */
    const BIG: PresentMap = { ...MAP, id: 'big', cols: 20, rows: 10, tiles: Array(10).fill('.'.repeat(20)) };

    /** A presenter on `skin`'s camera; `show` presents one frame and gives the camera's top-left. */
    function cam(camera: SkinFile['camera'], opts: { clamp?: boolean } = {}) {
      const { r, calls } = recorder();
      const skin: SkinFile = { ...SKIN, ...(camera ? { camera } : {}) };
      const p = new SkinnedCanvasPresenter(r, skin, lookup, {
        mapSurface: () => ({ renderer: recorder().r, image: null }),
        ...opts,
      });
      let n = 0;
      const show = (over: Partial<PresentFrame> = {}): [number, number] => {
        calls.length = 0;
        p.present(frame({ frame: n++, map: BIG, ...over }));
        const copy = calls.find((c) => c.startsWith('sprite map:'))!;
        const [x, y] = copy.split(' ')[2]!.split(',').map(Number);
        return [0 - x!, 0 - y!];
      };
      return { show, calls };
    }
    /** The hero with its centre at (cx, cy). */
    const at = (cx: number, cy: number) => [hero({ x: cx - 8, y: cy - 8 })];

    it("gives the followed entity on screen as its focus, the iris transition's centre (Engine 0.16 T5)", () => {
      const skin: SkinFile = { ...SKIN, camera: { follow: 'hero', lerp: 1 } };
      const p = new SkinnedCanvasPresenter(recorder().r, skin, lookup, {
        mapSurface: () => ({ renderer: recorder().r, image: null }),
      });
      expect(p.focus()).toBeNull();
      // Scrolled: the camera's top-left at (200, 100) puts the hero's centre (224, 116) at (24, 16).
      p.present(frame({ map: BIG, entities: at(224, 116) }));
      expect(p.focus()).toEqual({ x: 24, y: 16 });
      // Clamped at the map's corner, the hero sits off the picture's centre.
      p.present(frame({ frame: 1, map: BIG, entities: at(10, 12) }));
      expect(p.focus()).toEqual({ x: 10, y: 12 });
      p.present(frame({ frame: 2, map: BIG, entities: [] }));
      expect(p.focus()).toBeNull();
    });

    it('follows with a deadzone: no scroll inside the box, scrolling past its edge', () => {
      const c = cam({ follow: 'hero', deadzone: { w: 16, h: 8 } });
      // Centred at first: (100 - 24, 80 - 16).
      expect(c.show({ entities: at(100, 80) })).toEqual([76, 64]);
      // Inside the box (8 px each side across, 4 up and down): still.
      expect(c.show({ entities: at(108, 76) })).toEqual([76, 64]);
      expect(c.show({ entities: at(92, 84) })).toEqual([76, 64]);
      // One pixel past its edge: the camera moves one pixel.
      expect(c.show({ entities: at(109, 85) })).toEqual([77, 65]);
      // Back inside the moved box: still.
      expect(c.show({ entities: at(101, 81) })).toEqual([77, 65]);
      expect(c.show({ entities: at(80, 81) })).toEqual([64, 65]);
    });

    it('lerps toward the target deterministically, arriving exactly', () => {
      const c = cam({ follow: 'hero', lerp: 0.25 });
      expect(c.show({ entities: at(24, 16) })).toEqual([0, 0]);
      const xs: number[] = [];
      for (let i = 0; i < 40; i++) xs.push(c.show({ entities: at(124, 16) })[0]);
      // A quarter of the gap each frame, in whole pixels, then at least 1 px.
      expect(xs.slice(0, 6)).toEqual([25, 43, 57, 67, 75, 81]);
      expect(xs.every((x, i) => i === 0 || x >= xs[i - 1]!)).toBe(true);
      expect(xs.at(-1)).toBe(100);
      const again = cam({ follow: 'hero', lerp: 0.25 });
      again.show({ entities: at(24, 16) });
      const ys: number[] = [];
      for (let i = 0; i < 40; i++) ys.push(again.show({ entities: at(124, 16) })[0]);
      expect(ys).toEqual(xs);
    });

    it('snaps with lerp 1, and on the first frame of any lerp', () => {
      const c = cam({ follow: 'hero', lerp: 1 });
      expect(c.show({ entities: at(24, 16) })).toEqual([0, 0]);
      expect(c.show({ entities: at(224, 116) })).toEqual([200, 100]);
      expect(cam({ follow: 'hero', lerp: 0.1 }).show({ entities: at(224, 116) })).toEqual([200, 100]);
    });

    it("lets the hint's follow, deadzone and lerp override the skin's", () => {
      const c = cam({ follow: 'hero', lerp: 1 });
      const other = hero({ id: 'other', x: 192, y: 92 });
      const hint = { x: 0, y: 0, follow: 'other', lerp: 0.5 };
      expect(c.show({ entities: [...at(24, 16), other], camera: hint })).toEqual([176, 84]);
      const moved = hero({ id: 'other', x: 92, y: 92 });
      expect(c.show({ entities: [...at(24, 16), moved], camera: hint })).toEqual([126, 84]);
      // A follow id not in the frame falls back to the hint's point.
      expect(c.show({ entities: [], camera: { x: 124, y: 16, lerp: 1 } })).toEqual([100, 0]);
    });

    it('does not move again when the same frame is shown twice', () => {
      const { r } = recorder();
      const calls: string[] = [];
      const rec = { ...r, sprite: (...a: Parameters<Renderer['sprite']>) => calls.push(`${a[2]},${a[3]}`) };
      const skin: SkinFile = { ...SKIN, kinds: {}, camera: { follow: 'hero', lerp: 0.5 } };
      const p = new SkinnedCanvasPresenter(rec, skin, lookup, {
        mapSurface: () => ({ renderer: r, image: null }),
      });
      p.present(frame({ frame: 0, map: BIG, entities: at(24, 16) }));
      p.present(frame({ frame: 1, map: BIG, entities: at(124, 16) }));
      p.present(frame({ frame: 1, map: BIG, entities: at(124, 16) }));
      expect(calls).toEqual(['0,0', '-50,0', '-50,0']);
    });

    it('clamps at the map edges and centres a map smaller than the picture', () => {
      const c = cam({ follow: 'hero' });
      expect(c.show({ entities: at(2, 3) })).toEqual([0, 0]);
      expect(c.show({ entities: at(319, 159) })).toEqual([272, 128]);
      // Lerping toward a clamped spot stops at the edge.
      const l = cam({ follow: 'hero', lerp: 0.5 });
      l.show({ entities: at(200, 80) });
      for (let i = 0; i < 20; i++) l.show({ entities: at(400, 80) });
      expect(l.show({ entities: at(400, 80) })).toEqual([272, 64]);
      // 32x16 in 48x32: centred, whatever the target.
      const small: PresentMap = { ...MAP, id: 'small', cols: 2, rows: 1, tiles: ['..'] };
      expect(c.show({ map: small, entities: at(300, 300) })).toEqual([-8, -8]);
    });

    it("keeps the view inside the hint's bounds, and clamp:false turns clamping off", () => {
      const c = cam({ follow: 'hero' });
      const bounds = { x: 32, y: 0, w: 96, h: 160 };
      expect(c.show({ entities: at(10, 16), camera: { x: 10, y: 16, follow: 'hero', bounds } })).toEqual([
        32, 0,
      ]);
      expect(c.show({ entities: at(300, 16), camera: { x: 0, y: 0, follow: 'hero', bounds } })).toEqual([
        80, 0,
      ]);
      const free = cam({ follow: 'hero' }, { clamp: false });
      expect(free.show({ entities: at(2, 3) })).toEqual([-22, -13]);
    });

    it("takes clamp from the skin's camera, which the option overrides (gap G29)", () => {
      const fromSkin = cam({ follow: 'hero', clamp: false });
      expect(fromSkin.show({ entities: at(2, 3) })).toEqual([-22, -13]);
      const overridden = cam({ follow: 'hero', clamp: false }, { clamp: true });
      expect(overridden.show({ entities: at(2, 3) })).toEqual([0, 0]);
    });

    it('records the same draw calls for the same frame sequence on two runs', () => {
      const run = () => {
        const c = cam({ follow: 'hero', deadzone: { w: 12, h: 6 }, lerp: 0.3 });
        const out: string[] = [];
        for (let i = 0; i < 60; i++) {
          c.show({ entities: at(20 + ((i * 37) % 290), 10 + ((i * 13) % 150)) });
          out.push(...c.calls);
        }
        return out;
      };
      const first = run();
      expect(first.length).toBeGreaterThan(60);
      expect(run()).toEqual(first);
    });
  });

  describe('zoom', () => {
    /** 20x10 tiles of 16 px: 320x160, in a 48x32 picture. */
    const BIG: PresentMap = { ...MAP, id: 'big', cols: 20, rows: 10, tiles: Array(10).fill('.'.repeat(20)) };

    function draw(
      zoom: number | undefined,
      over: Partial<PresentFrame> & { noMap?: boolean } = {},
      skinZoom?: number,
    ) {
      const skin: SkinFile = skinZoom === undefined ? SKIN : { ...SKIN, camera: { zoom: skinZoom } };
      const screen = recorder();
      const p = new SkinnedCanvasPresenter(screen.r, skin, lookup, {
        mapSurface: () => ({ renderer: recorder().r, image: null }),
      });
      const camera = zoom === undefined ? {} : { camera: { x: 0, y: 0, zoom } };
      p.present(frame({ ...camera, ...over }));
      return screen.calls;
    }

    it('scales the map copy and the sprites by the zoom: 0.5, 1 and 2', () => {
      const entities = [hero({ x: 8, y: 4 }), hero({ id: 'g', kind: 'ghost', x: 20, y: 6 })];
      // Zoom 1 (no hint): drawn as before, no scale passed.
      expect(draw(undefined, { entities }).filter((c) => !c.startsWith('clear'))).toEqual([
        'sprite map:room@0:map 0,0',
        'sprite hero:down-0 8,4',
        'rect 20,6 16x16 #f00',
      ]);
      // Zoom 2: the view is 24x16 world px inside the 48x32 map, so (0, 0) clamps to the top-left.
      expect(draw(2, { entities }).filter((c) => !c.startsWith('clear'))).toEqual([
        'sprite map:room@0:map 0,0 x2',
        'sprite hero:down-0 16,8 x2',
        'rect 40,12 32x32 #f00',
      ]);
      // Zoom 0.5: the 48x32 map is centred in the 96x64 world view (24x16 on screen, at 12,8).
      expect(draw(0.5, { entities }).filter((c) => !c.startsWith('clear'))).toEqual([
        'sprite map:room@0:map 12,8 x0.5',
        'sprite hero:down-0 16,10 x0.5',
        'rect 22,11 8x8 #f00',
      ]);
    });

    it("takes the skin's zoom when the hint gives none", () => {
      expect(draw(undefined, { noMap: true, entities: [hero({ x: 8, y: 4 })] }, 2)).toContain(
        'sprite hero:down-0 16,8 x2',
      );
    });

    it('clamps using the zoomed picture size', () => {
      const corner = { map: BIG, camera: { x: 1000, y: 1000 } };
      // Zoom 1: the view is 48x32 world px, so the top-left clamps to (272, 128).
      expect(draw(undefined, corner).find((c) => c.startsWith('sprite map:'))).toBe(
        'sprite map:big@0:map -272,-128',
      );
      // Zoom 2: the view is 24x16 world px, top-left (296, 144), which is (592, 288) on screen.
      expect(
        draw(2, { ...corner, camera: { ...corner.camera, zoom: 2 } }).find((c) =>
          c.startsWith('sprite map:'),
        ),
      ).toBe('sprite map:big@0:map -592,-288 x2');
      // Zoom 0.5: the view is 96x64 world px, top-left (224, 96), which is (112, 48) on screen.
      expect(
        draw(0.5, { ...corner, camera: { ...corner.camera, zoom: 0.5 } }).find((c) =>
          c.startsWith('sprite map:'),
        ),
      ).toBe('sprite map:big@0:map -112,-48 x0.5');
    });

    it('draws uncached tiles scaled and gap-free at zoom 2', () => {
      const { r, calls } = recorder();
      const p = new SkinnedCanvasPresenter(r, SKIN, lookup, { mapSurface: () => null });
      p.present(frame({ camera: { x: 0, y: 0, zoom: 2 } }));
      expect(calls.filter((c) => !c.startsWith('clear'))).toEqual([
        'sprite walls:wall 0,0 x2',
        'rect 32,0 32x32 #00f',
      ]);
    });

    it('scales a squashed sprite about its zoomed bottom centre', () => {
      const s = recorder();
      const p = new SkinnedCanvasPresenter(s.r, SKIN, lookup, { mapSurface: () => null });
      p.present(
        frame({
          noMap: true,
          camera: { x: 0, y: 0, zoom: 2 },
          entities: [hero({ x: 10, y: 4, fx: { squashX: 1.5, squashY: 0.5 } })],
        }),
      );
      // Centred on (0, 0): the camera's top-left is (-24, -16) on screen; the 32x32 box at (44, 24).
      const at = s.calls.indexOf('transform 60,56 0 1.5,0.5');
      expect(at).toBeGreaterThan(-1);
      expect(s.calls[at + 1]).toBe('sprite hero:down-0 -16,-32 x2');
    });
  });

  it('squashes and stretches through the renderer transform, about the bottom centre', () => {
    const s = setup();
    s.p.present(
      frame({ noMap: true, entities: [hero({ x: 10, y: 4, fx: { squashX: 1.5, squashY: 0.5 } })] }),
    );
    const at = s.screen.indexOf('transform 18,20 0 1.5,0.5');
    expect(at).toBeGreaterThan(-1);
    expect(s.screen[at + 1]).toBe('sprite hero:down-0 -8,-16');
    // Without transform support it is still drawn, moved to the pivot.
    const t = setup({ withTransform: false });
    t.p.present(frame({ noMap: true, entities: [hero({ x: 10, y: 4, fx: { squashX: 2 } })] }));
    expect(t.screen).toContain('sprite hero:down-0 10,4');
  });

  it('calls onSound once per event occurrence and draws its effect', () => {
    const sounds: string[] = [];
    const s = setup({ onSound: (id) => sounds.push(id) });
    const hit = { type: 'hit', x: 4, y: 4 };
    s.p.present(frame({ events: [hit, hit, { type: 'step' }, { type: 'unknown' }] }));
    expect(sounds).toEqual(['hurt', 'hurt']);
    // The same frame shown again does not play again; a later frame with the event does.
    s.p.present(frame({ events: [hit] }));
    expect(sounds).toEqual(['hurt', 'hurt']);
    s.p.present(frame({ frame: 1, events: [hit] }));
    expect(sounds).toEqual(['hurt', 'hurt', 'hurt']);
    expect(s.screen).toContain('rect 0,0 48x32 #fff');
  });

  it("plays an event's sound by its result field, falling back to the bare type (G28)", () => {
    const sounds: string[] = [];
    const skin: SkinFile = {
      ...SKIN,
      events: {
        end: { sound: 'door' },
        'end:pass': { sound: 'pass' },
        'end:fail': { sound: 'fail', effect: { kind: 'flash', color: '#f00' } },
      },
    };
    const p = new SkinnedCanvasPresenter(recorder().r, skin, lookup, {
      mapSurface: () => null,
      onSound: (id) => sounds.push(id),
    });
    const ends = ['pass', 'fail', 'quit'].map((result) => ({ type: 'end', result }));
    p.present(frame({ events: [...ends, { type: 'end' }] }));
    expect(sounds).toEqual(['pass', 'fail', 'door', 'door']);
  });

  it('ends an effect after its ticks', () => {
    const s = setup();
    s.p.present(frame({ events: [{ type: 'hit' }] }));
    s.p.present(frame({ frame: 2 }));
    expect(s.screen.filter((c) => c === 'rect 0,0 48x32 #fff')).toHaveLength(1);
  });

  describe('tweens (Engine 0.16 T1)', () => {
    const tweenSkin: SkinFile = {
      ...SKIN,
      kinds: {
        ...SKIN.kinds,
        hero: { ...SKIN.kinds['hero']!, spawnTween: { prop: 'y', from: -4, to: 0, frames: 4 } },
      },
      events: {
        hit: {
          tween: [
            { prop: 'x', from: 8, to: 0, frames: 2 },
            { prop: 'color', from: '#ffffff', to: '#ff0000', frames: 2, amount: 0.5 },
          ],
        },
        squash: { tween: { prop: 'scale', from: 2, to: 1, frames: 2 } },
      },
    };
    const make = () => {
      const s = recorder();
      s.r.alpha = (a, draw) => {
        s.calls.push(`alpha ${a}`);
        draw();
      };
      const p = new SkinnedCanvasPresenter(s.r, tweenSkin, lookup, { mapSurface: () => null });
      return { p, calls: s.calls };
    };
    const sprites = (calls: string[]) => calls.filter((c) => c.startsWith('sprite hero'));

    it("starts a kind's spawnTween the first frame an entity shows, then rests", () => {
      const { p, calls } = make();
      for (let f = 0; f <= 4; f++)
        p.present(frame({ frame: f, noMap: true, entities: [hero({ x: 10, y: 10 })] }));
      expect(sprites(calls)).toEqual([6, 7, 8, 9, 10].map((y) => `sprite hero:down-0 10,${y}`));
    });

    it("starts an event's tween on its entity, with the colour overlay over its box", () => {
      const { p, calls } = make();
      p.present(frame({ frame: 0, noMap: true, entities: [hero({ id: 'a', x: 10 })] }));
      calls.length = 0;
      p.present(
        frame({
          frame: 4,
          noMap: true,
          entities: [hero({ id: 'a', x: 10 })],
          events: [{ type: 'hit', entity: 'a' }],
        }),
      );
      expect(calls).toContain('sprite hero:down-0 18,0');
      expect(calls).toContain('alpha 0.5');
      expect(calls).toContain('rect 18,0 16x16 #ffffff');
      calls.length = 0;
      p.present(frame({ frame: 5, noMap: true, entities: [hero({ id: 'a', x: 10 })] }));
      expect(calls).toContain('rect 14,0 16x16 #ff8080');
      calls.length = 0;
      p.present(frame({ frame: 6, noMap: true, entities: [hero({ id: 'a', x: 10 })] }));
      expect(sprites(calls)).toEqual(['sprite hero:down-0 10,0']);
      expect(calls.some((c) => c.startsWith('rect'))).toBe(false);
    });

    it('lays a scale tween over the frame fx, about the bottom centre', () => {
      const { p, calls } = make();
      p.present(frame({ frame: 0, noMap: true, entities: [hero({ id: 'a' })] }));
      p.present(
        frame({
          frame: 9,
          noMap: true,
          entities: [hero({ id: 'a', x: 10, y: 4, fx: { squashX: 1.5 } })],
          events: [{ type: 'squash', entity: 'a' }],
        }),
      );
      expect(calls).toContain('transform 18,20 0 3,2');
    });

    it('ignores a tween event with no entity and forgets entities that leave', () => {
      const { p, calls } = make();
      p.present(
        frame({
          frame: 0,
          noMap: true,
          entities: [hero({ id: 'a', x: 10, y: 10 })],
          events: [{ type: 'hit' }],
        }),
      );
      p.present(frame({ frame: 1, noMap: true, entities: [] }));
      calls.length = 0;
      // Back again: a new spawn tween from its start.
      p.present(frame({ frame: 2, noMap: true, entities: [hero({ id: 'a', x: 10, y: 10 })] }));
      expect(sprites(calls)).toEqual(['sprite hero:down-0 10,6']);
    });

    it('drops tweens when the frame number goes back (a new level) and replays spawn tweens', () => {
      const { p, calls } = make();
      p.present(frame({ frame: 0, noMap: true, entities: [hero({ id: 'a', x: 10, y: 10 })] }));
      p.present(frame({ frame: 499, noMap: true, entities: [hero({ id: 'a', x: 10, y: 10 })] }));
      p.present(
        frame({
          frame: 500,
          noMap: true,
          entities: [hero({ id: 'a', x: 10, y: 10 })],
          events: [{ type: 'hit', entity: 'a' }],
        }),
      );
      calls.length = 0;
      // The next level starts at frame 0 with the same id: no frozen hit tween, a fresh spawn tween.
      p.present(frame({ frame: 0, noMap: true, entities: [hero({ id: 'a', x: 10, y: 10 })] }));
      expect(sprites(calls)).toEqual(['sprite hero:down-0 10,6']);
      expect(calls.some((c) => c.startsWith('rect'))).toBe(false);
      calls.length = 0;
      for (let f = 1; f <= 4; f++)
        p.present(frame({ frame: f, noMap: true, entities: [hero({ id: 'a', x: 10, y: 10 })] }));
      expect(sprites(calls).at(-1)).toBe('sprite hero:down-0 10,10');
    });

    it('gives the same drawing for the same frames, and never changes a frozen frame or skin', () => {
      const run = () => {
        const s = recorder();
        const p = new SkinnedCanvasPresenter(s.r, freezeFrame(structuredClone(tweenSkin)), lookup, {
          mapSurface: () => null,
        });
        for (let f = 0; f < 6; f++)
          p.present(
            freezeFrame(
              frame({
                frame: f,
                entities: [hero({ id: 'a', x: f })],
                events: f === 1 ? [{ type: 'hit', entity: 'a' }] : [],
              }),
            ),
          );
        return s.calls;
      };
      expect(run()).toEqual(run());
    });
  });

  it('never changes a frozen frame or skin', () => {
    const { r } = recorder();
    const skin = freezeFrame(structuredClone(SKIN));
    const p = new SkinnedCanvasPresenter(r, skin, lookup, { mapSurface: () => null, onSound: () => {} });
    const f = freezeFrame(
      frame({
        entities: [
          hero({ layer: 2, fx: { squashX: 1.2, alpha: 0.5 } }),
          hero({ id: 'g', kind: 'ghost', y: -4 }),
        ],
        events: [{ type: 'hit', entity: 'hero' }],
        status: { health: 2, score: 5 },
        camera: { x: 0, y: 0, shake: 2 },
      }),
    );
    expect(() => {
      p.present(f);
      p.present(f);
      p.resize({ width: 64, height: 64 });
      p.present(freezeFrame(frame({ frame: 1, map: { id: 'room', version: 0 } })));
    }).not.toThrow();
  });
});

describe('skinSetCanvasPresenter (gap G34)', () => {
  it("draws a mini game's frames through its skin, the rest through the game's", () => {
    const { r, calls } = recorder();
    const round: SkinFile = { ...SKIN, kinds: { hero: { frames: { idle: 'side-0' } } } };
    const p = skinSetCanvasPresenter(r, {
      skin: SKIN,
      rounds: { vault: round },
      sheet: lookup,
      screen: { width: 48, height: 32 },
    });
    p.present(frame({ noMap: true, entities: [hero({ x: 16, y: 8 })] }));
    p.present(
      frame({ frame: 1, noMap: true, entities: [hero({ x: 16, y: 8 })], status: { miniGame: 'vault' } }),
    );
    const heroes = calls.filter((c) => c.startsWith('sprite hero:'));
    expect(heroes.map((c) => c.split(' ')[1])).toEqual(['hero:down-0', 'hero:side-0']);
  });

  it("clears each skin's frames to that skin's background, black without one, the option first (G36)", () => {
    const { r, calls } = recorder();
    const p = skinSetCanvasPresenter(r, {
      skin: { ...SKIN, background: '#5c94fc' },
      rounds: { vault: { ...SKIN, background: '#123' }, plain: SKIN },
      sheet: lookup,
      screen: { width: 48, height: 32 },
    });
    p.present(frame({ noMap: true }));
    p.present(frame({ frame: 1, noMap: true, status: { miniGame: 'vault' } }));
    p.present(frame({ frame: 2, noMap: true, status: { miniGame: 'plain' } }));
    expect(calls.filter((c) => c.startsWith('clear'))).toEqual(['clear #5c94fc', 'clear #123', 'clear #000']);
    const over = recorder();
    const q = new SkinnedCanvasPresenter(over.r, { ...SKIN, background: '#5c94fc' }, lookup, {
      background: '#fff',
    });
    q.present(frame({ noMap: true }));
    expect(over.calls[0]).toBe('clear #fff');
  });
});

describe('frame events and per-frame timing (Engine 0.16 T2)', () => {
  const skin: SkinFile = {
    backend: 'canvas2d',
    sheets: { sheet: 'hero', fallbackColor: '#00a800' },
    kinds: {
      hero: {
        frames: {
          run: { frames: ['down-0', 'side-0'], ticks: [2, 3], events: { 1: 'footstep' } },
          idle: 'down-0',
        },
      },
    },
    events: { footstep: { sound: 'step', effect: { kind: 'particles', count: 2, ticks: 3 } } },
  };

  it('plays a frame event through the skin events, once per frame started, never into the frame', () => {
    const { r, calls } = recorder();
    const sounds: string[] = [];
    const p = new SkinnedCanvasPresenter(r, skin, lookup, {
      mapSurface: () => null,
      onSound: (id) => sounds.push(id),
    });
    const at: number[] = [];
    for (let t = 0; t < 12; t++) {
      const f = freezeFrame(frame({ frame: t, entities: [hero({ anim: { state: 'run', t } })] }));
      const before = sounds.length;
      p.present(f);
      // A frame shown twice does not replay its frame events.
      p.present(f);
      if (sounds.length > before) at.push(t);
      expect(f.events).toEqual([]);
    }
    // The run cycle is 5 ticks; frame 1 starts at 2, 7.
    expect(at).toEqual([2, 7]);
    expect(sounds).toEqual(['step', 'step']);
    // Its particles were drawn, and the cycle's frames by their own ticks.
    expect(calls.filter((c) => c.startsWith('rect') && c.endsWith('#fcfcfc')).length).toBeGreaterThan(0);
    expect(calls.filter((c) => c.startsWith('sprite hero:side-0')).length).toBe(2 * 2 * 3);
  });

  it('gives a state its first frame event when it begins, not before', () => {
    const s: SkinFile = structuredClone(skin);
    (s.kinds['hero']!.frames!['run'] as { events: Record<string, string> }).events = { 0: 'footstep' };
    const sounds: string[] = [];
    const p = new SkinnedCanvasPresenter(recorder().r, s, lookup, {
      mapSurface: () => null,
      onSound: (id) => sounds.push(id),
    });
    p.present(frame({ frame: 0, entities: [hero()] }));
    p.present(frame({ frame: 1, entities: [hero({ anim: { state: 'run', t: 0 } })] }));
    expect(sounds).toEqual(['step']);
  });
});

describe('particles, blending and glow (Engine 0.16 T3)', () => {
  /** The recorder, plus `blend`, `glow` and `alpha` scopes written as `<blend add>` ... `</blend>`. */
  function scoped() {
    const { r, calls } = recorder();
    r.blend = (mode, draw) => {
      calls.push(`<blend ${mode}>`);
      draw();
      calls.push('</blend>');
    };
    r.glow = (color, radius, draw) => {
      calls.push(`<glow ${color} ${radius}>`);
      draw();
      calls.push('</glow>');
    };
    r.alpha = (a, draw) => {
      calls.push(`<alpha ${a}>`);
      draw();
      calls.push('</alpha>');
    };
    return { r, calls };
  }

  const skin: SkinFile = {
    ...SKIN,
    kinds: {
      ...SKIN.kinds,
      torch: {
        frames: { idle: 'down-0' },
        emit: 'smoke',
        blend: 'add',
        glow: { color: '#f8b800', radius: 4 },
      },
    },
    emitters: {
      sparks: { burst: 3, life: 4, speed: 1, angle: [180, 360], blend: 'add', glow: 3, color: '#fcd800' },
      smoke: {
        rate: 0.5,
        life: 6,
        speed: 0.25,
        angle: 270,
        size: [2, 4],
        alpha: [0.8, 0],
        color: '#bcbcbc',
        anchor: 'top',
      },
    },
    events: {
      ...SKIN.events,
      stomp: { emit: ['sparks'] },
      old: { effect: { kind: 'particles', count: 4, size: 1 } },
    },
  };
  const torch = hero({ id: 'torch', kind: 'torch', x: 20, y: 8, w: 8, h: 8 });

  it('starts event emitters at the event, drawn after the entities, additive and glowing', () => {
    const { r, calls } = scoped();
    const p = new SkinnedCanvasPresenter(r, skin, lookup, { mapSurface: () => null });
    p.present(freezeFrame(frame({ entities: [hero()], events: [{ type: 'stomp', x: 10, y: 10 }] })));
    const at = calls.indexOf('<blend add>');
    expect(at).toBeGreaterThan(calls.findIndex((c) => c.startsWith('sprite hero:')));
    const sparks = calls.slice(at, calls.indexOf('</blend>', at));
    expect(sparks.filter((c) => c === '<glow #fcd800 3>')).toHaveLength(3);
    expect(sparks.filter((c) => c === 'rect 10,10 1x1 #fcd800')).toHaveLength(3);
  });

  it('draws the same particles for the same seed, frame by frame', () => {
    const run = (seed: number) => {
      const { r, calls } = scoped();
      const p = new SkinnedCanvasPresenter(r, skin, lookup, { mapSurface: () => null, seed });
      for (let f = 0; f < 10; f++)
        p.present(
          frame({ frame: f, entities: [torch], events: f === 2 ? [{ type: 'stomp', x: 30, y: 10 }] : [] }),
        );
      return calls;
    };
    expect(run(5)).toEqual(run(5));
    expect(run(5)).not.toEqual(run(6));
  });

  it('counts live particles and caps them at maxParticles', () => {
    const run = (maxParticles?: number) => {
      const { r } = scoped();
      const p = new SkinnedCanvasPresenter(r, skin, lookup, {
        mapSurface: () => null,
        ...(maxParticles !== undefined && { maxParticles }),
      });
      expect(p.particleCount).toBe(0);
      for (let f = 0; f < 8; f++) p.present(frame({ frame: f, entities: [torch] }));
      return p.particleCount;
    };
    expect(run()).toBe(3);
    expect(run(2)).toBe(2);
  });

  it("runs a kind's emitter while the entity shows, and draws the kind with its blend and glow", () => {
    const { r, calls } = scoped();
    const p = new SkinnedCanvasPresenter(r, skin, lookup, { mapSurface: () => null });
    for (let f = 0; f < 8; f++) p.present(frame({ frame: f, entities: [torch] }));
    const last = calls.slice(calls.lastIndexOf('clear #000'));
    // The torch sprite: additive, glowing.
    const sprite = last.findIndex((c) => c.startsWith('sprite hero:down-0'));
    expect(last.slice(sprite - 2, sprite)).toEqual(['<blend add>', '<glow #f8b800 4>']);
    // Smoke from the torch's top: rate 0.5, life 6 => 3 alive, translucent and growing.
    const smoke = last.filter((c) => c.startsWith('rect') && c.endsWith('#bcbcbc'));
    expect(smoke).toHaveLength(3);
    expect(last.filter((c) => c.startsWith('<alpha 0.')).length).toBeGreaterThanOrEqual(2);
    // The torch gone: its smoke fades out and nothing new is made.
    for (let f = 8; f < 16; f++) p.present(frame({ frame: f }));
    const after = calls.slice(calls.lastIndexOf('clear #000'));
    expect(after.filter((c) => c.endsWith('#bcbcbc'))).toEqual([]);
  });

  it('still draws an old particles effect as a ring flying out 1 px a frame', () => {
    const { r, calls } = recorder();
    const p = new SkinnedCanvasPresenter(r, skin, lookup, { mapSurface: () => null });
    p.present(frame({ frame: 0, events: [{ type: 'old', x: 20, y: 10 }] }));
    calls.length = 0;
    p.present(frame({ frame: 2 }));
    expect(
      calls.filter((c) => c.startsWith('rect') && c.endsWith('#fcfcfc')).map((c) => c.split(' ')[1]),
    ).toEqual(['22,10', '20,12', '18,10', '20,8']);
  });

  it('draws bright particles without additive blending or glow, and dimmer, under reduced flashing', () => {
    const { r, calls } = scoped();
    const p = new SkinnedCanvasPresenter(r, skin, lookup, { mapSurface: () => null, reduceFlashing: true });
    p.present(frame({ events: [{ type: 'stomp', x: 10, y: 10 }] }));
    expect(calls.some((c) => c.startsWith('<glow #fcd800'))).toBe(false);
    expect(calls.filter((c) => c === '<alpha 0.5>')).toHaveLength(3);
    expect(calls.filter((c) => c === '<blend add>')).toHaveLength(0);
  });
});

describe('camera effects and parallax (Engine 0.16 T4)', () => {
  /** 20x10 tiles of 16 px: 320x160, in a 48x32 picture. */
  const BIG: PresentMap = { ...MAP, id: 'big', cols: 20, rows: 10, tiles: Array(10).fill('.'.repeat(20)) };
  const skin: SkinFile = {
    ...SKIN,
    camera: { follow: 'hero' },
    events: {
      stomp: { shake: { amount: 6, ticks: 8 }, hitPause: { ticks: 4 } },
      hurt: { flash: { color: '#d82800', alpha: 0.8, ticks: 4 } },
      door: { zoom: { to: 2, ticks: 2, hold: 2 } },
    },
    parallax: [
      { gradient: ['#3cbcfc', '#a4e4fc'], bands: 2, factor: 0 },
      { frame: 'side-0', factor: { x: 0.5, y: 0 }, y: 10 },
    ],
  };

  function setupFx(opts: { reduceFlashing?: boolean; shakeScale?: number } = {}) {
    const { r, calls } = recorder();
    r.alpha = (a, draw) => {
      calls.push(`<alpha ${a}>`);
      draw();
      calls.push('</alpha>');
    };
    const paused: number[] = [];
    const p = new SkinnedCanvasPresenter(r, skin, lookup, {
      mapSurface: () => ({ renderer: recorder().r, image: null }),
      onHitPause: (t) => paused.push(t),
      seed: 3,
      ...opts,
    });
    const show = (n: number, events: PresentFrame['events'] = [], x = 152) => {
      calls.length = 0;
      p.present(frame({ frame: n, map: BIG, entities: [hero({ x, y: 72 })], events }));
      const copy = calls.find((c) => c.startsWith('sprite map:'))!;
      const [mx, my] = copy.split(' ')[2]!.split(',').map(Number);
      return { cam: [0 - mx!, 0 - my!], scale: copy.split(' ')[3], calls: [...calls] };
    };
    return { p, show, paused };
  }

  it('shakes on both axes from a stomp, decaying back to the framed camera, the same each time', () => {
    const run = () => {
      const s = setupFx();
      const out = [s.show(0).cam, s.show(1, [{ type: 'stomp' }]).cam];
      for (let n = 2; n <= 10; n++) out.push(s.show(n).cam);
      return out;
    };
    const cams = run();
    expect(cams[0]).toEqual([136, 64]);
    const offsets = cams.slice(1, 9).map(([x, y]) => [x! - 136, y! - 64]);
    expect(offsets.some(([dx]) => dx !== 0)).toBe(true);
    expect(offsets.some(([, dy]) => dy !== 0)).toBe(true);
    expect(offsets.flat().every((v) => Math.abs(v) <= 6)).toBe(true);
    // Eight ticks later it has decayed to nothing.
    expect(cams.slice(9)).toEqual([
      [136, 64],
      [136, 64],
    ]);
    expect(run()).toEqual(cams);
  });

  it('asks the shell for a hit-pause once per event, and the shake scale turns shaking down', () => {
    const s = setupFx({ shakeScale: 0 });
    s.show(0);
    expect(s.show(1, [{ type: 'stomp' }]).cam).toEqual([136, 64]);
    s.show(1, [{ type: 'stomp' }]);
    expect(s.paused).toEqual([4]);
    expect(s.show(2).cam).toEqual([136, 64]);
    // A settings screen turns it back on.
    s.p.effectSettings({ shakeScale: 1 });
    s.show(3, [{ type: 'stomp' }]);
    const shaken = [4, 5, 6].map((n) => s.show(n).cam);
    expect(shaken.some(([x, y]) => x !== 136 || y !== 64)).toBe(true);
  });

  it('flashes over the picture, fading, and reduced flashing skips them', () => {
    const s = setupFx();
    s.show(0);
    const flashed = s.show(1, [{ type: 'hurt' }]).calls;
    expect(flashed.slice(flashed.indexOf('<alpha 0.8>'), flashed.indexOf('<alpha 0.8>') + 2)).toEqual([
      '<alpha 0.8>',
      'rect 0,0 48x32 #d82800',
    ]);
    expect(s.show(2).calls).toContain('<alpha 0.6000000000000001>');
    s.show(3);
    s.show(4);
    // Four presented frames after it started, it has faded out.
    expect(s.show(5).calls.some((c) => c.includes('#d82800'))).toBe(false);
    const calm = setupFx({ reduceFlashing: true });
    calm.show(0);
    expect(calm.show(1, [{ type: 'hurt' }]).calls.some((c) => c.includes('#d82800'))).toBe(false);
  });

  it('punches the zoom about the view centre and back', () => {
    const s = setupFx();
    s.show(0);
    const steps = [s.show(1, [{ type: 'door' }])];
    for (let n = 2; n <= 7; n++) steps.push(s.show(n));
    // Zoom 1 -> 1.5 -> 2 (held two frames) -> 1.5 -> 1: the map copy is scaled and recentred.
    expect(steps.map((st) => st.scale ?? 'x1')).toEqual(['x1', 'x1.5', 'x2', 'x2', 'x2', 'x1.5', 'x1']);
    // At zoom 2 the 24x16 world view round the centre (160, 80): top-left (148, 72), in picture px.
    expect(steps[2]!.cam).toEqual([296, 144]);
    expect(steps[6]!.cam).toEqual([136, 64]);
  });

  it('draws the parallax layers behind the map, each moving at its own rate', () => {
    const s = setupFx();
    const layers = (calls: string[]) =>
      calls.slice(
        1,
        calls.findIndex((c) => c.startsWith('sprite map:')),
      );
    const a = layers(s.show(0, [], 152).calls);
    // The sky in two bands, then the hills (16 px wide) repeated from -(136 * 0.5) mod 16.
    expect(a).toEqual([
      'rect 0,0 48x16 #3cbcfc',
      'rect 0,16 48x16 #a4e4fc',
      'sprite hero:side-0 -4,10',
      'sprite hero:side-0 12,10',
      'sprite hero:side-0 28,10',
      'sprite hero:side-0 44,10',
    ]);
    // 10 px right: the map moves 10, the hills 5, the sky not at all.
    const b = layers(s.show(1, [], 162).calls);
    expect(b.slice(0, 2)).toEqual(a.slice(0, 2));
    expect(b.slice(2)).toEqual([
      'sprite hero:side-0 -9,10',
      'sprite hero:side-0 7,10',
      'sprite hero:side-0 23,10',
      'sprite hero:side-0 39,10',
    ]);
  });
});

describe('per-map looks (Engine 0.16 part B, T7)', () => {
  const skin: SkinFile = {
    ...SKIN,
    background: '#5c94fc',
    parallax: [{ gradient: ['#3cbcfc'], bands: 1, height: 8, factor: 0 }],
    themes: {
      dusk: {
        background: '#201030',
        parallax: [{ gradient: ['#f08040'], bands: 1, height: 8, factor: 0 }],
        tiles: { '#': { sheet: 'hero', frame: 'side-0', fallbackColor: '#777' } },
      },
    },
  };

  it("draws a themed map with its own sky, parallax and tiles, any other map with the skin's", () => {
    const { r, calls } = recorder();
    const p = new SkinnedCanvasPresenter(r, skin, lookup);
    const drawn = (n: number, map: PresentMap) => {
      calls.length = 0;
      p.present(frame({ frame: n, map }));
      return calls.filter((c) => c.startsWith('clear') || c.startsWith('rect 0,0') || c.includes(':'));
    };
    const room = drawn(0, MAP);
    expect(room.slice(0, 3)).toEqual(['clear #5c94fc', 'rect 0,0 48x8 #3cbcfc', 'sprite walls:wall 0,0']);
    const dusk = drawn(1, { ...MAP, id: 'dusk' });
    expect(dusk.slice(0, 3)).toEqual(['clear #201030', 'rect 0,0 48x8 #f08040', 'sprite hero:side-0 0,0']);
    // Back on the first map: the skin's own look again, and the skin was never changed.
    expect(drawn(2, MAP).slice(0, 3)).toEqual(room.slice(0, 3));
    expect(skin.background).toBe('#5c94fc');
    expect(skin.tiles!['#']!.frame).toBe('wall');
  });
});

describe('PNG sheet frames with anchors (Engine 0.16 T10)', () => {
  /** A PNG sheet as `withContentImages` gives it: 16x24 frames anchored on the box's bottom centre. */
  const png: SpriteSheet = {
    id: 'torch',
    image: null,
    frames: new Map([
      ['lit', { x: 1, y: 1, w: 16, h: 24, anchor: 'bottom' as const }],
      ['held', { x: 19, y: 1, w: 16, h: 24, anchor: { x: 4, y: 22 } }],
    ]),
  };
  const sheets = (id: string) => (id === 'torch' ? png : (SHEETS[id] ?? null));
  const skin: SkinFile = {
    ...SKIN,
    kinds: {
      ...SKIN.kinds,
      torch: { sheet: 'torch', frames: { idle: 'lit', walk: 'held' }, flipFacing: true },
    },
  };
  const draw = (entity: PresentFrame['entities'][number], zoom?: number) => {
    const screen = recorder();
    const p = new SkinnedCanvasPresenter(screen.r, skin, sheets, {
      mapSurface: () => ({ renderer: recorder().r, image: null }),
    });
    p.present(
      frame({ entities: [entity], noMap: true, ...(zoom !== undefined && { camera: { x: 0, y: 0, zoom } }) }),
    );
    return screen.calls.filter((c) => c.startsWith('sprite'));
  };
  const torch = (over: Partial<PresentFrame['entities'][number]> = {}) =>
    hero({ id: 't', kind: 'torch', x: 16, y: 8, ...over });

  it('draws a bottom-anchored frame standing on the box, taller than it', () => {
    expect(draw(torch())).toEqual(['sprite torch:lit 16,0']);
  });

  it('puts a pixel anchor on the bottom centre, mirrored when the frame flips', () => {
    expect(draw(torch({ anim: { state: 'walk', t: 0 }, facing: 'right' }))).toEqual([
      'sprite torch:held 20,2',
    ]);
    expect(draw(torch({ anim: { state: 'walk', t: 0 }, facing: 'left' }))).toEqual([
      'sprite torch:held 12,2 flip',
    ]);
  });

  it('scales the anchor offset with the zoom', () => {
    // The frame's top is 8 world px above the box (16 picture px at zoom 2): where a text
    // sprite at y 0 draws.
    expect(draw(torch({ x: 0, y: 8 }), 2)).toEqual(['sprite torch:lit 24,16 x2']);
    expect(draw(hero({ x: 0, y: 0 }), 2)).toEqual(['sprite hero:down-0 24,16 x2']);
  });

  it('leaves text sprites (no anchor) at the box corner, as before', () => {
    expect(draw(hero({ x: 16, y: 8 }))).toEqual(['sprite hero:down-0 16,8']);
  });
});

describe('neighbour-based tile frames and per-cycle sheets (Engine 0.16 part B, T6)', () => {
  const ground = sheet('ground', { fill: [16, 16], top: [16, 16], 'top-left': [16, 16], left: [16, 16] });
  const jump = sheet('jump', { up: [16, 16] });
  const sheets = (id: string) => ({ ground, jump })[id as 'ground'] ?? SHEETS[id] ?? null;
  const skin: SkinFile = {
    ...SKIN,
    kinds: { ...SKIN.kinds, hero: { frames: { idle: 'down-0', jump: { frames: ['up'], sheet: 'jump' } } } },
    tiles: {
      '#': {
        sheet: 'ground',
        frame: 'fill',
        fallbackColor: '#777',
        join: { frames: { top: 'top', 'top left': 'top-left', left: 'left' } },
      },
    },
  };
  const present = (f: PresentFrame) => {
    const screen = recorder();
    const p = new SkinnedCanvasPresenter(screen.r, skin, sheets, { mapSurface: () => null });
    p.present(f);
    return screen.calls.filter((c) => c.startsWith('sprite'));
  };

  it('draws each tile with the frame its neighbours pick', () => {
    const map: PresentMap = {
      id: 'block',
      version: 0,
      tileSize: 16,
      cols: 3,
      rows: 3,
      tiles: ['...', '.##', '.##'],
    };
    // The map's edges count as joined: the right column and the bottom row have no edge.
    expect(present(frame({ map }))).toEqual([
      'sprite ground:top-left 16,16',
      'sprite ground:top 32,16',
      'sprite ground:left 16,32',
      'sprite ground:fill 32,32',
    ]);
  });

  it("draws a state from its cycle's own sheet", () => {
    const entities = [hero({ anim: { state: 'jump', t: 0 } }), hero({ id: 'h2', x: 16 })];
    expect(present(frame({ noMap: true, entities }))).toEqual([
      'sprite jump:up 0,0',
      'sprite hero:down-0 16,0',
    ]);
  });
});
