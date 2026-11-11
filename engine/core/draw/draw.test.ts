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
