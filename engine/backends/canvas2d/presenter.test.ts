import { describe, expect, it } from 'vitest';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { SpriteSheet } from '@engine/core/gfx/spritesheet';
import { freezeFrame, type PresentFrame, type PresentMap, type SkinFile } from '@engine/core/present';
import { SkinnedCanvasPresenter, type MapSurface } from './presenter';

/** A renderer that records every call as a line of text; `transform` records and draws locally. */
function recorder(withTransform = true) {
  const calls: string[] = [];
  const r: Renderer = {
    clear: (c) => calls.push(`clear ${c}`),
    rect: (x, y, w, h, c) => calls.push(`rect ${x},${y} ${w}x${h} ${c}`),
    sprite: (s, f, x, y, flipX) => calls.push(`sprite ${s.id}:${f} ${x},${y}${flipX ? ' flip' : ''}`),
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

  it('draws the tiles every frame when there is no surface to cache them on', () => {
    const { r, calls } = recorder();
    const p = new SkinnedCanvasPresenter(r, SKIN, lookup, { mapSurface: () => null });
    p.present(frame());
    p.present(frame({ frame: 1, map: { id: 'room', version: 0 } }));
    expect(calls.filter((c) => c.startsWith('sprite walls:wall'))).toHaveLength(2);
  });

  it('draws entities by layer, then y, keeping list order on ties', () => {
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
      '3,10',
      '4,10',
      '2,20',
      '1,30',
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

  it('ends an effect after its ticks', () => {
    const s = setup();
    s.p.present(frame({ events: [{ type: 'hit' }] }));
    s.p.present(frame({ frame: 2 }));
    expect(s.screen.filter((c) => c === 'rect 0,0 48x32 #fff')).toHaveLength(1);
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
