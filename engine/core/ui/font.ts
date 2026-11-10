import { z } from 'zod';
import type { ContentKind, TextReadResult } from '../content/kinds';
import { jsonPointer, type ContentError } from '../content/validate';

/**
 * Bitmap pixel fonts as text content (Engine 0.16 T6): the `font` content kind. A font is a set
 * of one-bit glyph grids (`#` ink, `.` clear) on a fixed cell height, with a baseline, per-glyph
 * advance and kerning pairs. The colour is chosen when the text is drawn, so one font serves any
 * colour, shadow or outline. The engine ships no font (content rule): each game draws its own.
 *
 * Text form (`.txt`), one directive per line, then each glyph's rows under its `glyph` line; a
 * line starting with `;` is a comment and a blank line ends a glyph:
 *
 *   cell 5 9          the widest glyph and the cell height (every glyph has `h` rows)
 *   baseline 7        rows above the baseline (descenders go below)
 *   spacing 1         px between glyphs (default 1)
 *   space 3           a space's advance (default half the cell width, rounded up)
 *   line 11           px from one line to the next (default the cell height + 2)
 *   kern AV -1        px added between that pair (any whole number)
 *   glyph A           one character; `glyph A advance 6` sets its advance
 *
 * Glyph rows may be narrower than the cell (a proportional font): a glyph's advance is its width
 * plus `spacing` unless it gives one.
 */

/** The ink character of a glyph row. */
export const FONT_INK = '#';
/** The clear character of a glyph row. */
export const FONT_CLEAR = '.';

const glyphSchema = z.strictObject({
  rows: z
    .array(z.string().regex(/^[#.]*$/, 'a glyph row holds only "#" (ink) and "." (clear)'))
    .describe('the rows, top to bottom: `#` ink, `.` clear; one per cell row'),
  advance: z
    .number()
    .int()
    .min(0)
    .exactOptional()
    .describe('px from this glyph to the next (default its width plus `spacing`)'),
});

/** A font file (the JSON shape the text form reads into). */
export const fontSchema = z
  .strictObject({
    cell: z
      .strictObject({
        w: z.number().int().min(1).max(64).describe('the widest glyph, px'),
        h: z.number().int().min(1).max(64).describe('the cell height, px: every glyph has this many rows'),
      })
      .describe('the glyph cell'),
    baseline: z.number().int().min(0).describe('rows above the baseline; descenders sit below it'),
    spacing: z.number().int().min(0).exactOptional().describe('px between glyphs (default 1)'),
    space: z
      .number()
      .int()
      .min(0)
      .exactOptional()
      .describe("a space's advance (default half the cell width, rounded up)"),
    line: z
      .number()
      .int()
      .min(1)
      .exactOptional()
      .describe('px from one line to the next (default the cell height + 2)'),
    glyphs: z.record(z.string(), glyphSchema).describe('character -> glyph'),
    kerning: z
      .record(z.string(), z.number().int())
      .exactOptional()
      .describe('a pair of characters (`AV`) -> px added between them'),
  })
  .superRefine((file, ctx) => {
    if (file.baseline > file.cell.h) {
      ctx.addIssue({
        code: 'custom',
        path: ['baseline'],
        message: `the baseline (${file.baseline}) is below the cell (${file.cell.h} rows)`,
        params: { code: 'bad_font' },
      });
    }
    for (const [ch, glyph] of Object.entries(file.glyphs)) {
      const at = ['glyphs', ch];
      if ([...ch].length !== 1 || /\s/.test(ch)) {
        ctx.addIssue({
          code: 'custom',
          path: at,
          message: `a glyph is one character, not a space: ${JSON.stringify(ch)}`,
          params: { code: 'bad_glyph' },
        });
        continue;
      }
      if (glyph.rows.length !== file.cell.h) {
        ctx.addIssue({
          code: 'custom',
          path: [...at, 'rows'],
          message: `glyph ${JSON.stringify(ch)} has ${glyph.rows.length} rows; the cell has ${file.cell.h}`,
          params: { code: 'bad_glyph' },
        });
      }
      const width = glyph.rows[0]?.length ?? 0;
      glyph.rows.forEach((row, i) => {
        if (row.length !== width) {
          ctx.addIssue({
            code: 'custom',
            path: [...at, 'rows', i],
            message: `glyph ${JSON.stringify(ch)}: row ${i} is ${row.length} px wide, row 0 ${width}`,
            params: { code: 'ragged_row' },
          });
        } else if (row.length > file.cell.w) {
          ctx.addIssue({
            code: 'custom',
            path: [...at, 'rows', i],
            message: `glyph ${JSON.stringify(ch)} is ${row.length} px wide; the cell is ${file.cell.w}`,
            params: { code: 'bad_glyph' },
          });
        }
      });
    }
    for (const pair of Object.keys(file.kerning ?? {})) {
      if ([...pair].length !== 2) {
        ctx.addIssue({
          code: 'custom',
          path: ['kerning', pair],
          message: `a kerning key is two characters: ${JSON.stringify(pair)}`,
          params: { code: 'bad_kerning' },
        });
      }
    }
  });

/** A checked font file. */
export type FontFile = z.output<typeof fontSchema>;

/** One run of ink on a glyph row: `w` px from (`x`, `y`) in the glyph. */
export interface GlyphRun {
  x: number;
  y: number;
  w: number;
}

/** A glyph ready to lay out and draw. */
export interface FontGlyph {
  /** Its width and height in px (the height is the cell's). */
  w: number;
  h: number;
  rows: readonly string[];
  /** Px to the next glyph's left edge. */
  advance: number;
  /** Its ink as horizontal runs, top to bottom. */
  runs: readonly GlyphRun[];
}

/** A font ready to lay out and draw (`buildFont`). */
export interface Font {
  id: string;
  cell: { w: number; h: number };
  baseline: number;
  spacing: number;
  /** A space's advance. */
  space: number;
  /** Px from one line to the next. */
  line: number;
  glyphs: ReadonlyMap<string, FontGlyph>;
  /** Px added between a pair of characters, by the pair. */
  kerning: ReadonlyMap<string, number>;
}

/** Finds a game's font by id, or null. */
export type FontLookup = (id: string) => Font | null;

/** Ink runs of a glyph's rows. */
export function glyphRuns(rows: readonly string[]): GlyphRun[] {
  const runs: GlyphRun[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== FONT_INK) {
        x++;
        continue;
      }
      const start = x;
      while (x < row.length && row[x] === FONT_INK) x++;
      runs.push({ x: start, y, w: x - start });
    }
  });
  return runs;
}

/** A checked font file as a {@link Font} called `id`, with every default filled in. */
export function buildFont(id: string, file: FontFile): Font {
  const spacing = file.spacing ?? 1;
  const glyphs = new Map<string, FontGlyph>();
  for (const [ch, g] of Object.entries(file.glyphs)) {
    const w = g.rows[0]?.length ?? 0;
    glyphs.set(ch, {
      w,
      h: file.cell.h,
      rows: g.rows,
      advance: g.advance ?? w + spacing,
      runs: glyphRuns(g.rows),
    });
  }
  return {
    id,
    cell: { ...file.cell },
    baseline: file.baseline,
    spacing,
    space: file.space ?? Math.ceil(file.cell.w / 2),
    line: file.line ?? file.cell.h + 2,
    glyphs,
    kerning: new Map(Object.entries(file.kerning ?? {})),
  };
}

/** The characters text needs a glyph for: everything but spaces and line breaks, each once, in order. */
export function textChars(text: string): string[] {
  const seen = new Set<string>();
  for (const ch of text) if (!/\s/.test(ch)) seen.add(ch);
  return [...seen];
}

/** The characters of `text` with no glyph in `glyphs` (a font's glyph map or a set of characters), each once, in order. */
export function missingGlyphs(glyphs: { has(ch: string): boolean }, text: string): string[] {
  return textChars(text).filter((ch) => !glyphs.has(ch));
}

type TextError = Omit<ContentError, 'file'>;

function textError(line: number, code: string, message: string): TextError {
  return { path: '', pointer: '', code, message, line };
}

const INT = /^-?\d+$/;

/**
 * Reads the text form of a font file into its JSON shape (which {@link fontSchema} then checks),
 * noting the line of every field so errors point at it.
 */
export function readFontText(text: string): TextReadResult {
  const data: Record<string, unknown> & { glyphs: Record<string, { rows: string[]; advance?: number }> } = {
    glyphs: {},
  };
  const lines: Record<string, number> = {};
  const errors: TextError[] = [];
  let glyph: string | null = null;
  let skipping = false;
  const number = (n: number, word: string | undefined, what: string): number | null => {
    if (word !== undefined && INT.test(word)) return Number(word);
    errors.push(textError(n, 'bad_directive', `line ${n}: ${what} needs a whole number`));
    return null;
  };

  text.split('\n').forEach((raw, i) => {
    const n = i + 1;
    const line = raw.replace(/\s+$/, '');
    if (line === '') {
      glyph = null;
      skipping = false;
      return;
    }
    if (line.startsWith(';')) return;
    if (!/\s/.test(line)) {
      if (skipping) return;
      if (glyph === null) {
        errors.push(
          textError(
            n,
            'row_outside_glyph',
            `line ${n}: glyph row outside a glyph (add "glyph <char>" above it)`,
          ),
        );
        return;
      }
      const rows = data.glyphs[glyph]!.rows;
      lines[jsonPointer(['glyphs', glyph, 'rows', rows.length])] = n;
      rows.push(line);
      return;
    }
    const [directive = '', ...args] = line.trim().split(/\s+/);
    glyph = null;
    skipping = false;
    if (directive === 'cell' && args.length === 2) {
      const w = number(n, args[0], 'cell');
      const h = number(n, args[1], 'cell');
      if (w !== null && h !== null) data['cell'] = { w, h };
      lines['/cell'] = n;
    } else if (['baseline', 'spacing', 'space', 'line'].includes(directive) && args.length === 1) {
      const v = number(n, args[0], directive);
      if (v !== null) data[directive] = v;
      lines[`/${directive}`] = n;
    } else if (directive === 'kern' && args.length === 2) {
      const v = number(n, args[1], 'kern');
      const kerning = (data['kerning'] ??= {}) as Record<string, number>;
      if (v !== null) kerning[args[0]!] = v;
      lines[jsonPointer(['kerning', args[0]!])] = n;
    } else if (directive === 'glyph' && (args.length === 1 || (args.length === 3 && args[1] === 'advance'))) {
      const ch = args[0]!;
      if (Object.hasOwn(data.glyphs, ch)) {
        errors.push(
          textError(n, 'duplicate_glyph', `line ${n}: glyph ${JSON.stringify(ch)} is already defined`),
        );
        skipping = true;
        return;
      }
      data.glyphs[ch] = { rows: [] };
      if (args.length === 3) {
        const v = number(n, args[2], 'advance');
        if (v !== null) data.glyphs[ch].advance = v;
      }
      lines[jsonPointer(['glyphs', ch])] = n;
      glyph = ch;
    } else {
      errors.push(
        textError(
          n,
          'unknown_directive',
          `line ${n}: expected "cell <w> <h>", "baseline <n>", "spacing <n>", "space <n>", "line <n>", "kern <pair> <n>" or "glyph <char> [advance <n>]"`,
        ),
      );
    }
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, data, lines };
}

/** The `font` content kind: a bitmap pixel font (JSON or the text form). */
export const FONT_KIND = {
  name: 'font',
  description:
    'A bitmap pixel font: one-bit glyph grids on a cell, a baseline, spacing, per-glyph advance and kerning pairs',
  schema: fontSchema,
  readText: readFontText,
} satisfies ContentKind;
