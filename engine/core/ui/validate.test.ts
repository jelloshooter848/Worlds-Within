import { describe, expect, it } from 'vitest';
import { loadContent } from '../content/bundle';
import { engineContentKinds } from '../content/engine-kinds';
import type { SkinFile } from '../present';

/** A game with one skin, one sprite and one font that has `A`, `b` and the digits 0-8 only. */
function game(hud: SkinFile['hud']): Record<string, string> {
  const glyph = (ch: string) => `glyph ${ch}\n#\n#\n`;
  const skin: SkinFile = { backend: 'canvas2d', sheets: { sheet: 'ui' }, kinds: {}, ...(hud && { hud }) };
  return {
    'game.json': JSON.stringify({
      id: 'g',
      kit: 'topdown',
      content: {
        skin: ['skins/*.json'],
        sprite: ['sprites/*.json'],
        palette: ['palettes/*.json'],
        font: ['fonts/*.txt'],
      },
      start: { seed: 1 },
      headless: 'headless.ts',
    }),
    'skins/canvas2d.json': JSON.stringify(skin),
    'sprites/ui.json': JSON.stringify({ palette: 'ui', frames: { coin: ['0'] } }),
    'palettes/ui.json': JSON.stringify({ id: 'ui', colors: ['#000'] }),
    'fonts/small.txt': ['cell 1 2', 'baseline 2', '', ...[...'Ab012345678'].map(glyph)].join('\n'),
  };
}

describe('the skin checks its HUD fonts (Engine 0.16 T6)', () => {
  it('passes text the font covers', () => {
    const r = loadContent(
      game([{ as: 'text', x: 0, y: 0, font: 'small', format: 'Ab {value} bA' }]),
      engineContentKinds(),
    );
    expect(r.errors).toEqual([]);
  });

  it("reports a format's missing glyphs at the format, a number's missing digits at the font", () => {
    const r = loadContent(
      game([
        { as: 'text', x: 0, y: 0, font: 'small', format: 'Abc {value}!' },
        { status: 'coins', as: 'counter', x: 0, y: 0, frame: 'coin', font: 'small' },
        { status: 'n', as: 'counter', x: 0, y: 0, font: 'none' },
        { status: 'n', as: 'number', x: 0, y: 0, font: 'legacy-sprite-font' },
      ]),
      engineContentKinds(),
      { root: 'games/g/' },
    );
    expect(r.errors.map((e) => [e.file, e.path, e.code, e.message])).toEqual([
      [
        'games/g/skins/canvas2d.json',
        'hud.0.format',
        'missing_glyph',
        'font "small" has no glyph for "c", "!" (used in this format)',
      ],
      [
        'games/g/skins/canvas2d.json',
        'hud.1.font',
        'missing_glyph',
        'font "small" has no glyph for "9" (a number shows every digit)',
      ],
      ['games/g/skins/canvas2d.json', 'hud.2.font', 'missing_ref', 'no font or sprite "none" in the game'],
    ]);
  });

  it("checks the widgets' fields", () => {
    const r = loadContent(
      game([
        { status: 'hp', as: 'bar', x: 0, y: 0 } as never,
        { as: 'panel', x: 0, y: 0, w: 4, h: 4, frame: 'coin' } as never,
        { as: 'minimap', x: 0, y: 0, w: 4, h: 4, dots: [{ color: '#fff' }] } as never,
        {
          status: 'c',
          as: 'counter',
          x: 0,
          y: 0,
          font: 'small',
          tween: { ticks: 4, ease: 'wobbly' },
        } as never,
      ]),
      engineContentKinds(),
    );
    expect(r.errors.map((e) => [e.path, e.code])).toEqual([
      ['hud.0.w', 'missing_field'],
      ['hud.0.h', 'missing_field'],
      ['hud.0.max', 'missing_field'],
      ['hud.1.slice', 'missing_field'],
      ['hud.2.dots.0', 'bad_minimap_dot'],
      ['hud.3.tween.ease', 'bad_ease'],
    ]);
  });
});
