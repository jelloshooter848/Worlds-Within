import { describe, expect, it } from 'vitest';
import type { Renderer } from '../gfx/renderer';
import type { SpriteSheet } from '../gfx/spritesheet';
import { freezeFrame, type PresentFrame, type Presenter, type SkinFile } from '../present';
import { buildFont, type FontLookup } from '../ui';
import { RendererUiPainter, SkinnedPresenter, skinSetPresenter, type SkinnedPresenterOptions } from '.';

// The shared 2D presenter walk (Engine 0.16 T13b). Its full behaviour is tested through Canvas2D's
// thin wrapper in engine/backends/canvas2d (presenter.test.ts, ui-painter.test.ts and others);
// these check what the core adds: no surfaces by default, and the skin set's factory.

function recorder() {
  const calls: string[] = [];
  const r: Renderer = {
    clear: (c) => calls.push(`clear ${c}`),
    rect: (x, y, w, h, c) => calls.push(`rect ${x},${y} ${w}x${h} ${c}`),
    sprite: (s, f, x, y) => calls.push(`sprite ${s.id}:${f} ${x},${y}`),
    text: () => {},
    debugText: () => {},
    line: () => {},
  };
  return { r, calls };
}

const WALLS: SpriteSheet = {
  id: 'walls',
  image: null,
  frames: new Map([['wall', { x: 0, y: 0, w: 8, h: 8 }]]),
};
const lookup = (id: string) => (id === 'walls' ? WALLS : null);
const SKIN: SkinFile = {
  backend: 'canvas2d',
  background: '#123',
  kinds: {},
  tiles: { '#': { sheet: 'walls', frame: 'wall' } },
};

function frame(over: Partial<PresentFrame> = {}): PresentFrame {
  return {
    frame: 0,
    size: { width: 16, height: 8 },
    entities: [],
    map: { id: 'room', version: 0, tileSize: 8, cols: 2, rows: 1, tiles: ['#.'] },
    events: [],
    status: {},
    ...over,
  };
}

describe('SkinnedPresenter (Engine 0.16 T13b)', () => {
  it('draws the tiles every frame without a map surface, and copies a cached map with one', () => {
    const plain = recorder();
    const p = new SkinnedPresenter(plain.r, SKIN, lookup);
    p.present(freezeFrame(frame()));
    p.present(freezeFrame(frame({ frame: 1 })));
    expect(plain.calls).toEqual([
      'clear #123',
      'sprite walls:wall 0,0',
      'clear #123',
      'sprite walls:wall 0,0',
    ]);

    const screen = recorder();
    const cache = recorder();
    const cached = new SkinnedPresenter(screen.r, SKIN, lookup, {
      mapSurface: () => ({ renderer: cache.r, image: null }),
    });
    cached.present(freezeFrame(frame()));
    cached.present(freezeFrame(frame({ frame: 1 })));
    expect(cache.calls).toEqual(['sprite walls:wall 0,0']);
    expect(screen.calls).toEqual([
      'clear #123',
      'sprite map:room@0:map 0,0',
      'clear #123',
      'sprite map:room@0:map 0,0',
    ]);
  });
});

describe('RendererUiPainter (Engine 0.16 T13b)', () => {
  const FONT = buildFont('f', { cell: { w: 2, h: 2 }, baseline: 2, glyphs: { L: { rows: ['#.', '##'] } } });
  const fonts: FontLookup = (id) => (id === 'f' ? FONT : null);
  const glyph = { kind: 'glyph', font: 'f', ch: 'L', x: 4, y: 5, color: '#fff' } as const;

  it("draws a glyph's ink runs without a glyph surface", () => {
    const { r, calls } = recorder();
    new RendererUiPainter(r, lookup, fonts).glyph(glyph);
    expect(calls).toEqual(['rect 4,5 1x1 #fff', 'rect 4,6 2x1 #fff']);
  });

  it("copies a glyph from its colour's strip, drawn once on the surface given", () => {
    const { r, calls } = recorder();
    const strip = recorder();
    let made = 0;
    const p = new RendererUiPainter(r, lookup, fonts, {
      glyphSurface: () => (made++, { renderer: strip.r, image: null }),
    });
    p.glyph(glyph);
    p.glyph({ ...glyph, x: 9 });
    expect(made).toBe(1);
    expect(strip.calls).toEqual(['rect 0,0 1x1 #fff', 'rect 0,1 2x1 #fff']);
    expect(calls).toEqual(['sprite font:f##fff:L 4,5', 'sprite font:f##fff:L 9,5']);
  });

  it('with tintGlyphs draws one white strip per font and tints it per colour', () => {
    const { r } = recorder();
    const strip = recorder();
    const drawn: [string, unknown][] = [];
    let made = 0;
    const white = { white: true } as unknown as SpriteSheet['image'];
    const p = new RendererUiPainter(
      { ...r, sprite: (s, f, x, y) => void drawn.push([`${s.id}:${f} ${x},${y}`, s.image]) },
      lookup,
      fonts,
      {
        glyphSurface: () => (made++, { renderer: strip.r, image: white }),
        tintGlyphs: (image, color) => ({ image, color }) as unknown as SpriteSheet['image'],
      },
    );
    p.glyph({ ...glyph, color: '#f00' });
    p.glyph({ ...glyph, color: '#0f0', x: 9 });
    p.glyph({ ...glyph, color: '#f00', x: 12 });
    expect(made).toBe(1);
    expect(strip.calls).toEqual(['rect 0,0 1x1 #ffffff', 'rect 0,1 2x1 #ffffff']);
    expect(drawn).toEqual([
      ['font:f##f00:L 4,5', { image: white, color: '#f00' }],
      ['font:f##0f0:L 9,5', { image: white, color: '#0f0' }],
      ['font:f##f00:L 12,5', { image: white, color: '#f00' }],
    ]);
  });
});

describe('skinSetPresenter (Engine 0.16 T13b)', () => {
  it("makes one presenter per skin through the factory and shows each round's frames on its own", () => {
    const made: { skin: string; opts: SkinnedPresenterOptions }[] = [];
    const shown: string[] = [];
    const settings: string[] = [];
    const round: SkinFile = { ...SKIN, background: '#456' };
    const set = skinSetPresenter(
      {
        skin: SKIN,
        rounds: { duel: round },
        sheet: lookup,
        screen: { width: 16, height: 8 },
        background: '#000',
      },
      (skin, _sheet, opts): Presenter & { effectSettings(): void } => {
        const name = skin === SKIN ? 'main' : 'duel';
        made.push({ skin: name, opts });
        return { present: () => shown.push(name), effectSettings: () => settings.push(name) };
      },
    );
    expect(made).toEqual([
      { skin: 'main', opts: { size: { width: 16, height: 8 }, background: '#000' } },
      { skin: 'duel', opts: { size: { width: 16, height: 8 } } },
    ]);
    set.present(freezeFrame(frame()));
    set.present(freezeFrame(frame({ status: { miniGame: 'duel' } })));
    expect(shown).toEqual(['main', 'duel']);
    set.effectSettings({ shakeScale: 0 });
    expect(settings).toEqual(['main', 'duel']);
  });
});

describe('top-down looks (Engine 0.16 F8): turnToFacing, ring and 2D labels', () => {
  const UNIT: SpriteSheet = {
    id: 'unit',
    image: null,
    frames: new Map([['tank', { x: 0, y: 0, w: 8, h: 8 }]]),
  };
  const sheets = (id: string) => (id === 'unit' ? UNIT : null);
  const entity = (
    over: Partial<PresentFrame['entities'][number]> = {},
  ): PresentFrame['entities'][number] => ({
    id: 'e1',
    kind: 'tank',
    x: 8,
    y: 0,
    w: 8,
    h: 8,
    facing: 'down',
    anim: { state: 'idle', t: 0 },
    tags: [],
    ...over,
  });
  const at = (over: Partial<PresentFrame> = {}) =>
    freezeFrame(frame({ size: { width: 32, height: 16 }, map: undefined, ...over } as Partial<PresentFrame>));

  it('turns top-down art to the facing about the box centre, never mirroring it', () => {
    const turns: string[] = [];
    const { r } = recorder();
    r.transform = (x, y, angle, _sx, _sy, draw) => {
      turns.push(`${x},${y} ${Math.round((angle * 180) / Math.PI)}`);
      draw(r);
    };
    const skin: SkinFile = {
      backend: 'canvas2d',
      kinds: { tank: { sheet: 'unit', frames: { idle: 'tank' }, turnToFacing: true, fallbackColor: '#000' } },
    };
    const p = new SkinnedPresenter(r, skin, sheets, { clamp: false });
    for (const facing of ['right', 'down', 'up-left'] as const)
      p.present(at({ entities: [entity({ facing })], camera: { x: 16, y: 8 } }));
    expect(turns).toEqual(['12,4 0', '12,4 90', '12,4 225']);
  });

  it('draws a ring as rows of a disc under the sprite, its rim opaque', () => {
    const { r, calls } = recorder();
    const skin: SkinFile = {
      backend: 'canvas2d',
      kinds: {
        tank: {
          sheet: 'unit',
          frames: { idle: 'tank' },
          ring: { radius: 2, color: '#0f0', edge: '#fff' },
          fallbackColor: '#000',
        },
      },
    };
    new SkinnedPresenter(r, skin, sheets, { clamp: false }).present(
      at({ entities: [entity()], camera: { x: 16, y: 8 } }),
    );
    const fill = calls.filter((c) => c.endsWith('#0f0'));
    // Five rows, centred on the box's centre (12, 4): widths 2, 4, 4, 4, 2.
    expect(fill).toEqual([
      'rect 11,2 2x1 #0f0',
      'rect 10,3 4x1 #0f0',
      'rect 10,4 4x1 #0f0',
      'rect 10,5 4x1 #0f0',
      'rect 11,6 2x1 #0f0',
    ]);
    expect(calls.filter((c) => c.endsWith('#fff')).length).toBeGreaterThan(0);
    // The ring is under the sprite.
    expect(calls.findIndex((c) => c.startsWith('sprite unit:tank'))).toBeGreaterThan(
      calls.lastIndexOf('rect 11,6 2x1 #0f0'),
    );
  });

  it("draws a 2D skin's labels over the entities: a health bar from the hp tag", () => {
    const { r, calls } = recorder();
    const skin: SkinFile = {
      backend: 'canvas2d',
      kinds: { tank: { sheet: 'unit', frames: { idle: 'tank' }, fallbackColor: '#000' } },
      labels: { tank: { from: { tag: 'hp:' }, as: 'bar', max: 4, w: 8, h: 2, color: '#f00', back: '#111' } },
    };
    new SkinnedPresenter(r, skin, sheets, { clamp: false }).present(
      at({ entities: [entity({ tags: ['hp:2'], y: 6 })], camera: { x: 16, y: 8 } }),
    );
    const sprite = calls.findIndex((c) => c.startsWith('sprite unit:tank'));
    const back = calls.findIndex((c) => c.endsWith('#111'));
    const bar = calls.findIndex((c) => c.endsWith('#f00'));
    expect(sprite).toBeGreaterThanOrEqual(0);
    expect(back).toBeGreaterThan(sprite);
    // Half full: 4 px of 8, just above the box (top at y 6, 2 px up, 2 px high).
    expect(calls[bar]).toBe('rect 8,2 4x2 #f00');
  });

  it('keeps a 2D label inside the picture when its anchor is near an edge (polish P6, M45)', () => {
    const { r, calls } = recorder();
    const skin: SkinFile = {
      backend: 'canvas2d',
      kinds: { tank: { sheet: 'unit', frames: { idle: 'tank' }, fallbackColor: '#000' } },
      labels: { tank: { from: { tag: 'hp:' }, as: 'bar', max: 4, w: 12, h: 2, color: '#f00', back: '#111' } },
    };
    new SkinnedPresenter(r, skin, sheets, { clamp: false }).present(
      at({
        entities: [
          entity({ id: 'a', tags: ['hp:2'], x: 0, y: 6 }), // anchor x 4: the bar would start at -2
          entity({ id: 'b', tags: ['hp:2'], x: 24, y: 6 }), // anchor x 28: it would end at 34
          entity({ id: 'c', tags: ['hp:2'], x: 30, y: 6 }), // anchor x 34: off the picture, hidden
        ],
        camera: { x: 16, y: 8 },
      }),
    );
    // The 32 px picture keeps 2 px clear: the bars start at 2 and end at 30.
    expect(calls.filter((c) => c.endsWith('#111'))).toEqual(['rect 2,2 12x2 #111', 'rect 18,2 12x2 #111']);
    expect(calls.filter((c) => c.endsWith('#f00'))).toEqual(['rect 2,2 6x2 #f00', 'rect 18,2 6x2 #f00']);
  });
});

describe('hitFlash (Engine 0.16 F8)', () => {
  it('asks the sheet lookup for the colour as the palette while the tag lasts, blinking', () => {
    const asked: (string | undefined)[] = [];
    const UNIT: SpriteSheet = {
      id: 'unit',
      image: null,
      frames: new Map([['tank', { x: 0, y: 0, w: 8, h: 8 }]]),
    };
    const { r } = recorder();
    const skin: SkinFile = {
      backend: 'canvas2d',
      kinds: {
        tank: {
          sheet: 'unit',
          frames: { idle: 'tank' },
          hitFlash: { tag: 'hit', color: '#ffffff', blink: 2 },
          fallbackColor: '#000',
        },
      },
    };
    const p = new SkinnedPresenter(
      r,
      skin,
      (id, palette) => (asked.push(palette), id === 'unit' ? UNIT : null),
    );
    const e = (tags: string[]) => ({
      id: 'e',
      kind: 'tank',
      x: 0,
      y: 0,
      w: 8,
      h: 8,
      facing: 'down' as const,
      anim: { state: 'idle', t: 0 },
      tags,
    });
    for (let n = 0; n < 5; n++)
      p.present(
        freezeFrame({
          ...frame({ frame: n, entities: [e(n < 4 ? ['hit'] : [])] }),
          map: { id: 'room', version: 0 },
        }),
      );
    // Frames 0-1 on, 2-3 off (blink 2), then the tag is gone.
    expect(asked).toEqual(['#ffffff', '#ffffff', undefined, undefined, undefined]);
  });
});

describe('tower-defense looks (Engine 0.16 E6)', () => {
  const SHOTS: SpriteSheet = {
    id: 'td',
    image: null,
    frames: new Map([
      ['arrow', { x: 0, y: 0, w: 4, h: 2 }],
      ['runner', { x: 0, y: 0, w: 8, h: 8 }],
    ]),
  };
  const tdLookup = (id: string) => (id === 'td' ? SHOTS : null);
  const ent = (id: string, kind: string, tags: string[], x = 16, y = 16) => ({
    id,
    kind,
    x,
    y,
    w: 16,
    h: 16,
    facing: 'down' as const,
    anim: { state: 'idle', t: 0 },
    tags,
  });
  const empty = (n: number, over: Partial<PresentFrame> = {}): PresentFrame => ({
    frame: n,
    size: { width: 64, height: 64 },
    entities: [],
    events: [],
    status: {},
    camera: { x: 32, y: 32 },
    ...over,
  });
  const shot = { type: 'td-shot', fromX: 8, fromY: 24, x: 48, y: 24 };

  function shooter(skin: Partial<SkinFile>, opts: SkinnedPresenterOptions = {}) {
    const { r, calls } = recorder();
    const s: SkinFile = {
      backend: 'canvas2d',
      background: '#000',
      sheets: { sheet: 'td' },
      kinds: {},
      ...skin,
    };
    return { p: new SkinnedPresenter(r, s, tdLookup, opts), calls };
  }

  it('flies a square from fromX/fromY to x/y over its ticks, then lands once with its impact', () => {
    const sounds: [string, number | undefined][] = [];
    const { p, calls } = shooter(
      {
        emitters: { dust: { burst: 3, life: 4, speed: 0 } },
        events: {
          'td-shot': {
            projectile: { ticks: 4, color: '#f00', size: 2, impact: { emit: 'dust', sound: 'thud' } },
          },
        },
      },
      { onSound: (id, cue) => sounds.push([id, cue?.frame]) },
    );
    const squares = () => {
      const out = calls.filter((c) => c.endsWith('#f00'));
      calls.length = 0;
      return out;
    };
    p.present(freezeFrame(empty(10, { events: [shot] })));
    expect(squares()).toEqual(['rect 7,23 2x2 #f00']);
    expect(p.projectileCount).toBe(1);
    p.present(freezeFrame(empty(11)));
    expect(squares()).toEqual(['rect 17,23 2x2 #f00']);
    p.present(freezeFrame(empty(13)));
    expect(squares()).toEqual(['rect 37,23 2x2 #f00']);
    expect(sounds).toEqual([]);
    // Landed on frame 14 (10 + 4 ticks): the sound once, the burst where it landed, no square.
    calls.length = 0;
    p.present(freezeFrame(empty(14)));
    expect(squares()).toEqual([]);
    expect(sounds).toEqual([['thud', 14]]);
    expect(p.projectileCount).toBe(0);
    expect(p.particleCount).toBe(3);
    p.present(freezeFrame(empty(14)));
    expect(sounds).toHaveLength(1);
  });

  it('lands a shot whose frame was skipped, and drops shots on a new level', () => {
    const sounds: number[] = [];
    const { p } = shooter(
      { events: { 'td-shot': { projectile: { ticks: 6, impact: { sound: 'thud' } } } } },
      { onSound: (_, cue) => sounds.push(cue!.frame) },
    );
    p.present(freezeFrame(empty(10, { events: [shot] })));
    p.present(freezeFrame(empty(30)));
    expect(sounds).toEqual([30]);
    p.present(freezeFrame(empty(40, { events: [shot] })));
    p.present(freezeFrame(empty(2)));
    expect(p.projectileCount).toBe(0);
    expect(sounds).toEqual([30]);
  });

  it('lands at once where an event gives no start, and draws a frame turned to its way', () => {
    const sounds: number[] = [];
    const { r, calls } = recorder();
    const turns: number[] = [];
    const turning: Renderer = {
      ...r,
      transform: (x, y, angle, _sx, _sy, draw) => {
        turns.push(Math.round((angle * 180) / Math.PI));
        calls.push(`turn ${x},${y}`);
        draw(r);
      },
    };
    const skin: SkinFile = {
      backend: 'canvas2d',
      sheets: { sheet: 'td' },
      kinds: {},
      events: {
        'td-shot': {
          projectile: { frame: 'arrow', ticks: 4, arc: 8, turn: true, impact: { sound: 'thud' } },
        },
      },
    };
    const p = new SkinnedPresenter(turning, skin, tdLookup, { onSound: (_, cue) => sounds.push(cue!.frame) });
    p.present(freezeFrame(empty(5, { events: [{ type: 'td-shot', x: 20, y: 20 }] })));
    expect(sounds).toEqual([5]);
    expect(p.projectileCount).toBe(0);
    calls.length = 0;
    p.present(freezeFrame(empty(6, { events: [shot] })));
    // Frame 0 of the flight: rising at the start, turned up from right about its centre.
    expect(calls.filter((c) => c.startsWith('turn') || c.includes('td:arrow'))).toEqual([
      'turn 8,24',
      'sprite td:arrow -2,-1',
    ]);
    expect(turns[0]).toBeLessThan(0);
    calls.length = 0;
    p.present(freezeFrame(empty(8)));
    // Mid-flight, at the top of its arc: level, so not turned.
    expect(calls.filter((c) => c.startsWith('turn') || c.includes('td:arrow'))).toEqual([
      'sprite td:arrow 26,15',
    ]);
  });

  it("draws a ring from the entity's range tag times the map's tile size, else its radius", () => {
    const { p, calls } = shooter({
      kinds: {
        tower: {
          frames: { idle: 'none' },
          fallbackColor: '#444',
          ring: { tag: 'range:', color: '#0f0', alpha: 1 },
        },
        ghost: {
          frames: { idle: 'none' },
          fallbackColor: '#444',
          ring: { tag: 'range:', per: 4, radius: 3, color: '#00f', alpha: 1 },
        },
      },
    });
    const widest = (color: string) =>
      Math.max(...calls.filter((c) => c.endsWith(color)).map((c) => Number(/ (\d+)x1 /.exec(c)?.[1] ?? 0)));
    const map = { id: 'm', version: 0, tileSize: 8, cols: 8, rows: 8, tiles: Array(8).fill('........') };
    p.present(
      freezeFrame(
        empty(0, { map, entities: [ent('t', 'tower', ['range:2']), ent('g', 'ghost', ['range:3'])] }),
      ),
    );
    // range 2 at 8 px a cell: radius 16, 32 px across; the ghost's 3 at `per` 4: 24 across.
    expect(widest('#0f0')).toBe(32);
    expect(widest('#00f')).toBe(24);
    calls.length = 0;
    p.present(freezeFrame(empty(1, { map: { id: 'm', version: 0 }, entities: [ent('g', 'ghost', [])] })));
    expect(widest('#00f')).toBe(6);
    calls.length = 0;
    p.present(freezeFrame(empty(2, { map: { id: 'm', version: 0 }, entities: [ent('t', 'tower', [])] })));
    expect(calls.some((c) => c.endsWith('#0f0'))).toBe(false);
  });

  it('draws only the rows of a ring on the picture, however large a zoom makes it', () => {
    const { p, calls } = shooter({
      kinds: {
        tower: {
          frames: { idle: 'none' },
          fallbackColor: '#444',
          ring: { radius: 4, color: '#0f0', edge: '#fff' },
        },
      },
    });
    p.present(
      freezeFrame(empty(0, { entities: [ent('t', 'tower', [])], camera: { x: 24, y: 24, zoom: 5000 } })),
    );
    expect(calls.filter((c) => c.endsWith('#0f0'))).toHaveLength(64);
    expect(calls.filter((c) => c.endsWith('#fff'))).toHaveLength(128);
  });

  it("fills a health bar against each enemy's own maxhp tag", () => {
    const { p, calls } = shooter({
      kinds: { enemy: { frames: { walk: 'runner' } } },
      labels: {
        enemy: {
          from: { tag: 'hp:' },
          as: 'bar',
          max: { tag: 'maxhp:' },
          w: 10,
          h: 1,
          color: '#0f0',
          back: '#300',
        },
      },
    });
    p.present(
      freezeFrame(
        empty(0, {
          entities: [
            ent('a', 'enemy', ['hp:5', 'maxhp:10'], 0, 20),
            ent('b', 'enemy', ['hp:5', 'maxhp:20'], 32, 20),
          ],
        }),
      ),
    );
    expect(calls.filter((c) => c.endsWith('#0f0'))).toEqual(['rect 3,17 5x1 #0f0', 'rect 35,17 3x1 #0f0']);
  });
});
