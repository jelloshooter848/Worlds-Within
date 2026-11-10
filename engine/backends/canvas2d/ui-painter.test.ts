import { describe, expect, it } from 'vitest';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { SpriteSheet } from '@engine/core/gfx/spritesheet';
import { freezeFrame, type PresentFrame, type SkinFile } from '@engine/core/present';
import { buildFont, type FontLookup } from '@engine/core/ui';
import { SkinnedCanvasPresenter } from './presenter';
import { CanvasUiPainter, type GlyphSurface } from './ui-painter';

/** A renderer that records its calls (a sprite as `sheet:frame x,y` and the frame's rect). */
function recorder() {
  const calls: string[] = [];
  const r: Renderer = {
    clear: (c) => calls.push(`clear ${c}`),
    rect: (x, y, w, h, c) => calls.push(`rect ${x},${y} ${w}x${h} ${c}`),
    sprite: (s, f, x, y) => {
      const rect = s.frames.get(f)!;
      calls.push(`sprite ${s.id.split(':')[0]}:${f} ${x},${y} [${rect.x},${rect.y} ${rect.w}x${rect.h}]`);
    },
    text: () => {},
    debugText: () => {},
    line: () => {},
    transform: (x, y, _a, sx, sy, draw) => {
      calls.push(`transform ${x},${y} ${sx},${sy}`);
      draw(r);
    },
    alpha: (a, draw) => {
      calls.push(`alpha ${a}`);
      draw();
    },
  };
  return { r, calls };
}

const PANEL: SpriteSheet = {
  id: 'ui',
  image: null,
  frames: new Map([['panel', { x: 10, y: 0, w: 3, h: 3 }]]),
};
const sheets = (id: string) => (id === 'ui' ? PANEL : null);
/** A font with one 2x2 glyph: an L of three pixels. */
const FONT = buildFont('f', { cell: { w: 2, h: 2 }, baseline: 2, glyphs: { L: { rows: ['#.', '##'] } } });
const fonts: FontLookup = (id) => (id === 'f' ? FONT : null);

describe('CanvasUiPainter (Engine 0.16 T6)', () => {
  it('fills boxes, translucent below alpha 1', () => {
    const { r, calls } = recorder();
    const p = new CanvasUiPainter(r, sheets, fonts);
    p.fill({ kind: 'fill', x: 1, y: 2, w: 3, h: 4, color: '#fff' });
    p.fill({ kind: 'fill', x: 1, y: 2, w: 3, h: 4, color: '#000', alpha: 0.5 });
    expect(calls).toEqual(['rect 1,2 3x4 #fff', 'alpha 0.5', 'rect 1,2 3x4 #000']);
  });

  it('draws a whole frame as a sprite and a part of one cut and scaled', () => {
    const { r, calls } = recorder();
    const p = new CanvasUiPainter(r, sheets, fonts);
    const base = { kind: 'image', sheet: 'ui', frame: 'panel' } as const;
    p.image({ ...base, sx: 0, sy: 0, sw: 3, sh: 3, x: 5, y: 6, w: 3, h: 3 });
    p.image({ ...base, sx: 1, sy: 0, sw: 1, sh: 1, x: 8, y: 6, w: 10, h: 1 });
    p.image({ ...base, frame: 'none', sx: 0, sy: 0, sw: 1, sh: 1, x: 0, y: 0, w: 1, h: 1 });
    expect(calls).toEqual([
      'sprite ui:panel 5,6 [10,0 3x3]',
      'transform 8,6 10,1',
      // A part is a sheet of its own (id `ui@#panel:1,0,1,1`) over the same image.
      'sprite ui@#panel:part 0,0 [11,0 1x1]',
    ]);
  });

  it('draws a glyph as its ink runs without a surface, and from a coloured strip with one', () => {
    const plain = recorder();
    new CanvasUiPainter(plain.r, sheets, fonts).glyph({
      kind: 'glyph',
      font: 'f',
      ch: 'L',
      x: 4,
      y: 5,
      color: '#f00',
    });
    expect(plain.calls).toEqual(['rect 4,5 1x1 #f00', 'rect 4,6 2x1 #f00']);
    const strip = recorder();
    const surface = recorder();
    const made: string[] = [];
    const glyphSurface = (w: number, h: number): GlyphSurface => {
      made.push(`${w}x${h}`);
      return { renderer: surface.r, image: null };
    };
    const p = new CanvasUiPainter(strip.r, sheets, fonts, { glyphSurface });
    p.glyph({ kind: 'glyph', font: 'f', ch: 'L', x: 4, y: 5, color: '#f00' });
    p.glyph({ kind: 'glyph', font: 'f', ch: 'L', x: 9, y: 5, color: '#f00' });
    p.glyph({ kind: 'glyph', font: 'f', ch: 'Q', x: 9, y: 5, color: '#f00' });
    expect(made).toEqual(['3x2']);
    expect(surface.calls).toEqual(['rect 0,0 1x1 #f00', 'rect 0,1 2x1 #f00']);
    expect(strip.calls).toEqual(['sprite font:L 4,5 [0,0 2x2]', 'sprite font:L 9,5 [0,0 2x2]']);
  });
});

describe('SkinnedCanvasPresenter: the UI kit HUD (Engine 0.16 T6)', () => {
  const frame = (status: PresentFrame['status']): PresentFrame => ({
    frame: 0,
    size: { width: 64, height: 32 },
    entities: [],
    events: [],
    status,
  });

  it('paints a skin with UI items through the painter, after the picture', () => {
    const skin: SkinFile = {
      backend: 'canvas2d',
      sheets: { sheet: 'ui' },
      kinds: {},
      hud: [
        { status: 'hp', as: 'bar', x: 0, y: 0, w: 6, h: 3, max: 2, back: '#000' },
        { as: 'text', x: 10, y: 0, font: 'f', format: 'L', color: '#ff0' },
      ],
    };
    const { r, calls } = recorder();
    new SkinnedCanvasPresenter(r, skin, sheets, { fonts }).present(freezeFrame(frame({ hp: 1 })));
    expect(calls).toEqual([
      'clear #000',
      'rect 0,0 6x3 #000',
      'rect 0,0 3x3 #00a800',
      'rect 10,0 1x1 #ff0',
      'rect 10,1 2x1 #ff0',
    ]);
  });
});
