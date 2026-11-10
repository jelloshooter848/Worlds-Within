import type { Font } from './font';

/**
 * Text layout in a bitmap font (Engine 0.16 T6): where each glyph of a string goes, with line
 * breaks, word wrapping inside a width and left, centre or right alignment. Pure maths in whole
 * pixels: drawing is `textDraws` (`paint.ts`) through a backend's `UiPainter`.
 */

export type TextAlign = 'left' | 'center' | 'right';

/** The alignments a skin may name. */
export const TEXT_ALIGNS: readonly TextAlign[] = ['left', 'center', 'right'];

export interface TextLayoutOptions {
  /** Wrap words to stay inside this many px, and align inside it (default: no wrapping). */
  width?: number;
  /** Where each line sits in the width (or in the widest line when there is none); default left. */
  align?: TextAlign;
  /** Px from one line to the next (default the font's `line`). */
  line?: number;
}

/** One glyph placed, in px from the text's top-left. */
export interface PlacedGlyph {
  ch: string;
  x: number;
  y: number;
}

/** One laid-out line: its text and its width in px. */
export interface TextLine {
  text: string;
  width: number;
}

export interface TextLayout {
  glyphs: PlacedGlyph[];
  lines: TextLine[];
  /** The box the text fills: the width option when given, else the widest line; lines times the line height. */
  width: number;
  height: number;
  /** Characters the font has no glyph for (drawn as nothing, a cell wide), each once. */
  missing: string[];
}

/** The advance of one character: a space's, a glyph's, or a cell's width for a missing glyph. */
function advanceOf(font: Font, ch: string): number {
  if (ch === ' ') return font.space;
  return font.glyphs.get(ch)?.advance ?? font.cell.w + font.spacing;
}

/** The width a character takes as the last of a line: its ink width, not its advance. */
function lastWidthOf(font: Font, ch: string): number {
  if (ch === ' ') return 0;
  return font.glyphs.get(ch)?.w ?? font.cell.w;
}

/** The x of each character of `text` on one line (kerning included), and the line's width. */
function placeLine(font: Font, text: string): { xs: number[]; width: number } {
  const chars = [...text];
  const xs: number[] = [];
  let x = 0;
  let width = 0;
  chars.forEach((ch, i) => {
    if (i > 0) x += font.kerning.get(chars[i - 1]! + ch) ?? 0;
    xs.push(x);
    if (ch !== ' ') width = Math.max(width, x + lastWidthOf(font, ch));
    x += advanceOf(font, ch);
  });
  return { xs, width };
}

/** The width of one line of `text` in px (no wrapping; trailing spaces take no room). */
export function measureLine(font: Font, text: string): number {
  return placeLine(font, text).width;
}

/** Splits one paragraph into lines no wider than `width`: at spaces, and inside a word too long for a line. */
function wrap(font: Font, paragraph: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of paragraph.split(' ')) {
    const tried = line === '' ? word : `${line} ${word}`;
    if (measureLine(font, tried) <= width) {
      line = tried;
      continue;
    }
    if (line !== '') lines.push(line);
    line = '';
    // A word wider than the line is broken between characters.
    for (const ch of word) {
      if (line !== '' && measureLine(font, line + ch) > width) {
        lines.push(line);
        line = '';
      }
      line += ch;
    }
  }
  lines.push(line);
  return lines;
}

/**
 * Lays `text` out in `font`: `\n` breaks a line; with `width`, words wrap at spaces (a word
 * longer than the width breaks between characters) and lines align inside the width. Spaces and
 * missing glyphs place nothing; a missing glyph takes a cell's width and is listed in `missing`.
 */
export function layoutText(font: Font, text: string, opts: TextLayoutOptions = {}): TextLayout {
  const paragraphs = text.split('\n');
  const texts = opts.width === undefined ? paragraphs : paragraphs.flatMap((p) => wrap(font, p, opts.width!));
  const placed = texts.map((t) => ({ text: t, ...placeLine(font, t) }));
  const width = opts.width ?? Math.max(0, ...placed.map((l) => l.width));
  const step = opts.line ?? font.line;
  const glyphs: PlacedGlyph[] = [];
  const missing = new Set<string>();
  placed.forEach((l, row) => {
    const free = width - l.width;
    const left = opts.align === 'right' ? free : opts.align === 'center' ? Math.floor(free / 2) : 0;
    [...l.text].forEach((ch, i) => {
      if (ch === ' ') return;
      if (!font.glyphs.has(ch)) {
        missing.add(ch);
        return;
      }
      glyphs.push({ ch, x: left + l.xs[i]!, y: row * step });
    });
  });
  const height = placed.length === 0 ? 0 : (placed.length - 1) * step + font.cell.h;
  return {
    glyphs,
    lines: placed.map((l) => ({ text: l.text, width: l.width })),
    width,
    height,
    missing: [...missing],
  };
}
