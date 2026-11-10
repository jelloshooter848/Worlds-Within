import { describe, expect, it } from 'vitest';
import { buildFont, type Font } from './font';
import { textDraws } from './paint';
import { layoutText, measureLine } from './text';

/** A fixed-width test font: every glyph a 3-wide block on a 3x4 cell, spacing 1, space 2. */
function font(chars: string, kerning: Record<string, number> = {}): Font {
  const glyph = { rows: ['###', '#.#', '###', '...'] };
  return buildFont('t', {
    cell: { w: 3, h: 4 },
    baseline: 3,
    space: 2,
    glyphs: Object.fromEntries([...chars].map((c) => [c, glyph])),
    kerning,
  });
}

describe('text layout (Engine 0.16 T6)', () => {
  const f = font('abcdefgh');

  it('places glyphs by advance, with kerning, and measures without the trailing spacing', () => {
    expect(measureLine(f, 'ab')).toBe(7);
    expect(measureLine(f, 'a b')).toBe(9);
    expect(measureLine(f, 'ab ')).toBe(7);
    const kerned = font('AV', { AV: -1 });
    expect(layoutText(kerned, 'AV').glyphs).toEqual([
      { ch: 'A', x: 0, y: 0 },
      { ch: 'V', x: 3, y: 0 },
    ]);
  });

  it('breaks lines at \\n and wraps words inside a width', () => {
    const two = layoutText(f, 'ab\ncd');
    expect(two.lines).toEqual([
      { text: 'ab', width: 7 },
      { text: 'cd', width: 7 },
    ]);
    expect(two.glyphs[2]).toEqual({ ch: 'c', x: 0, y: 6 });
    expect(two.height).toBe(10);
    const wrapped = layoutText(f, 'ab cd ef', { width: 17 });
    expect(wrapped.lines.map((l) => l.text)).toEqual(['ab cd', 'ef']);
    // A word longer than the width is broken between characters.
    expect(layoutText(f, 'abcdefgh', { width: 12 }).lines.map((l) => l.text)).toEqual(['abc', 'def', 'gh']);
  });

  it('aligns lines left, centre or right inside the width', () => {
    expect(layoutText(f, 'ab', { width: 20 }).glyphs[0]!.x).toBe(0);
    expect(layoutText(f, 'ab', { width: 20, align: 'center' }).glyphs[0]!.x).toBe(6);
    expect(layoutText(f, 'ab', { width: 20, align: 'right' }).glyphs[0]!.x).toBe(13);
    // Without a width, lines align inside the widest.
    const block = layoutText(f, 'abcd\nab', { align: 'right' });
    expect(block.width).toBe(15);
    expect(block.glyphs.find((g) => g.y === 6)!.x).toBe(8);
  });

  it('lists missing glyphs and draws nothing for them, a cell wide', () => {
    const r = layoutText(f, 'aZb!Z');
    expect(r.missing).toEqual(['Z', '!']);
    expect(r.glyphs.map((g) => [g.ch, g.x])).toEqual([
      ['a', 0],
      ['b', 8],
    ]);
  });

  it('draws the shadow, then the outline, then the text', () => {
    const draws = textDraws(f, 'a', 10, 20, { color: '#fff', shadow: '#000', outline: '#111' });
    expect(draws).toHaveLength(10);
    expect(draws[0]).toEqual({ kind: 'glyph', font: 't', ch: 'a', x: 11, y: 21, color: '#000' });
    expect(draws.slice(1, 9).every((d) => d.color === '#111')).toBe(true);
    expect(draws[9]).toEqual({ kind: 'glyph', font: 't', ch: 'a', x: 10, y: 20, color: '#fff' });
  });
});
