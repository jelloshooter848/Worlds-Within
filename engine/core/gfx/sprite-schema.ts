import { z } from 'zod';
import { addGridIssues, type Legend } from '../content/text-grid';
import type { TextReadResult } from '../content/kinds';
import { jsonPointer, type ContentError } from '../content/validate';
import type { SpriteDef } from './pixelart';

/**
 * Sprite files: text-grid pixel art with a palette legend, read into a {@link SpriteDef}.
 *
 * JSON form:
 *
 *   { "palette": "hero",
 *     "legend": { ".": "clear", "#": 1, "o": 2 },
 *     "frames": { "idle": ["..#..", ".#o#."] } }
 *
 * Text form (`.txt`): one directive per line, then each frame's rows under its `frame` line. A
 * blank line ends a frame and a line starting with `;` is a comment.
 *
 *   palette hero
 *   legend . clear
 *   legend # 1
 *   frame idle
 *   ..#..
 *   .#o#.
 *
 * The legend maps one character to `clear` (transparent) or a palette index 0-35. Without a legend
 * the rows use the SpriteDef characters directly: `.` is clear and `0`-`9`, `a`-`z` are indices
 * 0-35. Every frame is a text grid: equal-width rows of legend characters.
 */

export const MAX_PALETTE_INDEX = 35;

export type LegendValue = 'clear' | number;

/** The raw shape of a sprite file, before the legend is applied. */
export interface SpriteFile {
  palette: string;
  legend?: Record<string, LegendValue>;
  frames: Record<string, string[]>;
}

/** The SpriteDef character for a legend value: `.` or `0`-`9`, `a`-`z`. */
export function spriteChar(value: LegendValue): string {
  if (value === 'clear') return '.';
  return value < 10 ? String(value) : String.fromCharCode(97 + value - 10);
}

/** The legend used when a file has none: the SpriteDef characters themselves. */
export const DEFAULT_LEGEND: Legend<LegendValue> = Object.freeze(
  Object.fromEntries([
    ['.', 'clear'],
    ...Array.from({ length: MAX_PALETTE_INDEX + 1 }, (_, i) => [spriteChar(i), i]),
  ]) as Record<string, LegendValue>,
);

const legendValue = z.union([z.literal('clear'), z.number().int().min(0).max(MAX_PALETTE_INDEX)]);

const legendKey = z.string().refine((key) => [...key].length === 1 && !/\s/.test(key) && key !== ';', {
  message: 'a legend key must be one character, not a space or ";"',
  params: { code: 'bad_legend_key' },
});

const legendSchema = z.record(legendKey, legendValue);

const framesSchema = z
  .record(z.string().min(1), z.array(z.string()))
  .refine((frames) => Object.keys(frames).length > 0, {
    message: 'needs at least one frame',
    params: { code: 'no_frames' },
  });

/** Sprite file -> SpriteDef. Fails with the exact field (`frames.idle.2`) and, for grids, row and column. */
export const spriteSchema = z
  .strictObject({
    palette: z.string().min(1),
    legend: legendSchema.exactOptional(),
    frames: framesSchema,
  })
  .superRefine((file, ctx) => {
    const legend = file.legend ?? DEFAULT_LEGEND;
    for (const [name, rows] of Object.entries(file.frames)) {
      addGridIssues(ctx, rows, legend, ['frames', name]);
    }
  })
  .transform((file): SpriteDef => {
    const legend = file.legend ?? DEFAULT_LEGEND;
    const frames: Record<string, string[]> = {};
    for (const [name, rows] of Object.entries(file.frames)) {
      frames[name] = rows.map((row) => [...row].map((ch) => spriteChar(legend[ch] as LegendValue)).join(''));
    }
    return { palette: file.palette, frames };
  });

type TextError = Omit<ContentError, 'file'>;

function textError(line: number, code: string, message: string): TextError {
  return { path: '', pointer: '', code, message, line };
}

/**
 * Reads the text form of a sprite file into the raw {@link SpriteFile} shape (which
 * {@link spriteSchema} then checks), noting the line of every field so errors can point at it.
 */
export function readSpriteText(text: string): TextReadResult {
  const data: {
    palette?: string;
    legend?: Record<string, LegendValue | string>;
    frames: Record<string, string[]>;
  } = { frames: {} };
  const lines: Record<string, number> = {};
  const errors: TextError[] = [];
  let frame: string | null = null;
  // After a duplicate `frame` line its rows are skipped, so one mistake gives one error.
  let skipping = false;

  text.split('\n').forEach((raw, i) => {
    const n = i + 1;
    const line = raw.replace(/\s+$/, '');
    if (line === '') {
      frame = null;
      skipping = false;
      return;
    }
    if (line.startsWith(';')) return;
    if (!/\s/.test(line)) {
      // No space: a pixel row.
      if (skipping) return;
      if (frame === null) {
        errors.push(
          textError(
            n,
            'row_outside_frame',
            `line ${n}: pixel row outside a frame (add "frame <name>" above it)`,
          ),
        );
        return;
      }
      const rows = data.frames[frame] as string[];
      lines[jsonPointer(['frames', frame, rows.length])] = n;
      rows.push(line);
      return;
    }
    const [directive = '', ...args] = line.trim().split(/\s+/);
    skipping = false;
    if (directive === 'palette' && args.length === 1) {
      data.palette = args[0] as string;
      lines['/palette'] = n;
      frame = null;
    } else if (directive === 'legend' && args.length === 2) {
      const [ch, value] = args as [string, string];
      data.legend ??= {};
      if (Object.hasOwn(data.legend, ch)) {
        errors.push(
          textError(n, 'duplicate_legend', `line ${n}: legend ${JSON.stringify(ch)} is already defined`),
        );
        return;
      }
      data.legend[ch] = /^\d+$/.test(value) ? Number(value) : value;
      lines[jsonPointer(['legend', ch])] = n;
      lines['/legend'] ??= n;
      frame = null;
    } else if (directive === 'frame' && args.length === 1) {
      const name = args[0] as string;
      if (Object.hasOwn(data.frames, name)) {
        errors.push(textError(n, 'duplicate_frame', `line ${n}: frame "${name}" is already defined`));
        frame = null;
        skipping = true;
        return;
      }
      data.frames[name] = [];
      lines[jsonPointer(['frames', name])] = n;
      frame = name;
    } else {
      errors.push(
        textError(
          n,
          'unknown_directive',
          `line ${n}: expected "palette <name>", "legend <char> <value>" or "frame <name>"`,
        ),
      );
    }
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, data, lines };
}
