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
