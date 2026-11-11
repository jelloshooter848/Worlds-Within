import { z } from 'zod';
import type { ContentKind, ContentLookup, KindIssue, TextReadResult } from '../content/kinds';
import { gridRows } from '../content/text-grid';
import type { FieldPath, IssueParams } from '../content/validate';
import { fxRng } from '../fx/rng';
import { missingGlyphs, type FontFile } from '../ui/font';
import { modelAnchor, modelPath, modelRotate } from './model-fields';
import { kindLightSchema, type SkinKindLight } from './scene3d';
import type { DeepReadonly } from './types';

/**
 * Decor and place names (Engine 0.16 F3): presentation-only scenery and region labels a `three`
 * skin lays over a map, written in text. Pure data, checks and placement; the 3D backend builds
 * them. Neither ever touches a state.
 *
 * - A **decor grid** is a `decor` content file (`*.txt`: one row of characters per map row, one
 *   character per cell, the map's size). A skin's `decor` names one per map id with a legend:
 *
 *       "decor": { "meadow": { "grid": "meadow", "size": { "cols": 24, "rows": 18 },
 *         "legend": { "b": { "model": ["assets/p/bush.gltf", "assets/p/bush-2.gltf"],
 *                            "scale": [10, 14], "yaw": "random", "jitter": 3, "castShadow": true } } } }
 *
 *   `.` and space are empty cells. Each other character places one of its legend entry's models
 *   on the cell, every pick (model, scale, yaw, jitter) drawn from the presentation RNG,
 *   `fxRng(seed, 0, "decor:<map>:<col>,<row>")`, so a seed always dresses a map the same way.
 *   `validate` checks the grid is the map's size (`wrong_size`: against `size`, or the content
 *   entry `map` names, or the entry named like the map id), every character is in the legend
 *   (`unknown_char`), each legend key is one character other than `.` and space
 *   (`bad_legend_key`), the grid exists (`missing_ref`) and every model file is there and is a
 *   model (`missing_file`, `bad_model`, with the skin's other models).
 * - **Places** are world-anchored text labels per map id (`THE HALL` over the hall): a world
 *   point (px; in ground view `height` px over the floor), drawn by the label layer with a game
 *   font (`missing_ref` and `missing_glyph` when it cannot).
 * - A tile entry's **`vary`** turns, stretches and tints each cell of a model tile a little, from
 *   `fxRng(seed, 0, "tile:<map>:<layer>:<col>,<row>")` ({@link tileVariation}).
 */

const color = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
  message: 'a colour is "#rgb" or "#rrggbb"',
});

/** Cell characters that are always empty in a decor grid (never a legend key). */
export const DECOR_EMPTY = ['.', ' '] as const;

/** How a decor model turns about the vertical: degrees, any angle (`random`) or a quarter turn (`quarter`). */
export const DECOR_YAWS = ['random', 'quarter'] as const;

export const decorLegendSchema = z.strictObject({
  model: z
    .union([modelPath, z.array(modelPath).min(1)])
    .describe('the model, or a list to pick one from per cell (presentation RNG)'),
  scale: z
    .union([
      z.number().positive(),
      z.tuple([z.number().positive(), z.number().positive()]).describe('`[min, max]`: a size drawn per cell'),
    ])
    .exactOptional()
    .describe('px per model unit, or `[min, max]` drawn per cell (default 1)'),
  yaw: z
    .union([z.number(), z.enum(DECOR_YAWS)])
    .exactOptional()
    .describe(
      'the turn about the vertical: degrees, `random` (any angle per cell) or `quarter` (a random quarter turn) (default 0)',
    ),
  jitter: z
    .number()
    .min(0)
    .exactOptional()
    .describe('px the model moves off the cell centre at most, on each ground axis, per cell (default 0)'),
  offset: z
    .strictObject({
      x: z.number().describe('px right'),
      y: z.number().describe('px down (ground view: south)'),
      z: z.number().describe('px toward the camera (ground view: up)'),
    })
    .exactOptional()
    .describe('a fixed shift from the cell centre (default 0)'),
  anchor: modelAnchor.exactOptional(),
  rotate: modelRotate.exactOptional(),
  castShadow: z
    .boolean()
    .exactOptional()
    .describe("the model casts a shadow when the skin's `scene3d.sun` has a `shadow` (default false)"),
  receiveShadow: z
    .boolean()
    .exactOptional()
    .describe("shadows fall on the model when the skin's `scene3d.sun` has a `shadow` (default false)"),
  instanced: z
    .boolean()
    .exactOptional()
    .describe(
      'draw every cell of a model as one `InstancedMesh` per mesh (default true); false: one copy per cell',
    ),
  stack: z
    .array(
      z.strictObject({
        model: modelPath.describe('the model put on the cell too'),
        height: z
          .number()
          .describe(
            "px over the cell's model point (ground view: up; side view: toward the camera), before the cell's scale",
          ),
      }),
    )
    .min(1)
    .exactOptional()
    .describe(
      "more models on the same cell, turned and scaled with it, each `height` px higher (a tower's roof on its base); per-cell picks are the first model's (Engine 0.16 F6)",
    ),
  materials: z
    .record(z.string().min(1), color)
    .exactOptional()
    .describe("material name -> colour, replacing that material's colour on these copies (Engine 0.16 F6)"),
  tint: color
    .exactOptional()
    .describe("a colour every material's colour is multiplied by, after `materials` (Engine 0.16 F6)"),
  light: kindLightSchema
    .exactOptional()
    .describe(
      "a point light on each cell of the entry (a campfire), its `offset` from the cell's model point (px right, y down: a negative y lifts it, z toward the camera / south in ground view), flickering per frame as a kind's (Engine 0.16 F6)",
    ),
  emit: z
    .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
    .exactOptional()
    .describe(
      "emitters of the skin's `emitters` that run on each cell of the entry (smoke over a campfire), anchored on the cell's box (Engine 0.16 F6)",
    ),
});

export type SkinDecorLegend = z.output<typeof decorLegendSchema>;

export const decorEntrySchema = z
  .strictObject({
    grid: z
      .string()
      .min(1)
      .describe('the `decor` content file (its name: `content/decor/meadow.txt` is `meadow`)'),
    map: z
      .string()
      .min(1)
      .exactOptional()
      .describe(
        'the content entry whose grid the decor must match in size (a level, room, defence map or world scenario); default the entry named like the map id, if there is one',
      ),
    size: z
      .strictObject({
        cols: z.number().int().min(1).describe('cells across'),
        rows: z.number().int().min(1).describe('cells down'),
      })
      .exactOptional()
      .describe('the map size, for a map that is not a content file (checked against the grid)'),
    legend: z
      .record(z.string(), decorLegendSchema)
      .describe('grid character -> the models it places (`.` and space are empty)'),
  })
  .superRefine((entry, ctx) => {
    for (const key of Object.keys(entry.legend)) {
      if ([...key].length === 1 && !(DECOR_EMPTY as readonly string[]).includes(key)) continue;
      const params: IssueParams = { code: 'bad_legend_key' };
      ctx.addIssue({
        code: 'custom',
        path: ['legend', key],
        message: `a decor legend key is one character other than "." and space, not ${JSON.stringify(key)}`,
        params,
      });
    }
  });

export type SkinDecor = z.output<typeof decorEntrySchema>;

export const decorSchema = z
  .record(z.string().min(1), decorEntrySchema)
  .describe(
    '3D: presentation-only scenery per map id (Engine 0.16 F3): `{ grid, map?, size?, legend: { <char>: { model, scale?, yaw?, jitter?, offset?, anchor?, rotate?, castShadow?, receiveShadow?, instanced?, materials?, tint?, light?, emit? } } }`',
  );

export const placeSchema = z.strictObject({
  text: z.string().min(1).describe('the name shown'),
  x: z.number().describe('world px right'),
  y: z.number().describe('world px down (ground view: south)'),
  height: z
    .number()
    .exactOptional()
    .describe('ground view: px over the floor (default 0); side view: px toward the camera'),
  font: z.string().min(1).describe('a font file of the game'),
  color: color.exactOptional().describe('the ink (default white)'),
  shadow: color.exactOptional().describe('a one-px drop shadow'),
  outline: color.exactOptional().describe('a one-px outline'),
  offset: z
    .strictObject({ x: z.number().int(), y: z.number().int() })
    .exactOptional()
    .describe('picture px from the point (y down; default 0, 0: centred on it)'),
});

export type SkinPlace = z.output<typeof placeSchema>;

export const placesSchema = z
  .record(z.string().min(1), z.array(placeSchema).min(1))
  .describe(
    '3D: region names per map id (Engine 0.16 F3), each text centred on a world point, drawn on the label layer: `[{ text, x, y, height?, font, color?, shadow?, outline?, offset? }]`',
  );

export const tileVarySchema = z
  .strictObject({
    turn: z
      .boolean()
      .exactOptional()
      .describe('a random quarter turn about the vertical per cell (default false)'),
    height: z
      .number()
      .min(0)
      .max(0.5)
      .exactOptional()
      .describe('the share the height varies by per cell, up or down (default 0)'),
    tint: z
      .number()
      .min(0)
      .max(0.5)
      .exactOptional()
      .describe('the share the brightness varies by per cell, up or down (default 0)'),
  })
  .describe(
    '3D model tile: per-cell variation from the presentation RNG, the same for a seed (Engine 0.16 F3)',
  );

export type SkinTileVary = z.output<typeof tileVarySchema>;

// ---- The decor content kind ----

/** A decor grid file: its rows. */
export const decorFileSchema = z.strictObject({
  rows: z
    .array(z.string())
    .min(1)
    .describe('one string per map row, one character per cell (`.` and space empty)'),
});

export type DecorFile = z.output<typeof decorFileSchema>;

/** Reads a decor `.txt`: every line a row (blank lines at the start and end dropped). */
export function readDecorText(text: string): TextReadResult {
  const lines = text.split('\n');
  let first = 0;
  while (first < lines.length && lines[first]!.trim() === '') first++;
  const rows = gridRows(text);
  const map: Record<string, number> = { '': first + 1 };
  rows.forEach((_, i) => (map[`/rows/${i}`] = first + i + 1));
  return { ok: true, data: { rows }, lines: map };
}

/**
 * The `decor` content kind (Engine 0.16 F3): a decor grid, `.txt` (or `.json` `{ rows }`). Its
 * `checkAll` checks each grid against every skin entry that names it: the size against the map
 * (`wrong_size`) and each character against the legend (`unknown_char`, at the row and column).
 */
export const DECOR_KIND = {
  name: 'decor',
  description:
    "A decor grid: one character per map cell, placed as presentation-only models by a 3D skin's `decor` legend",
  schema: decorFileSchema,
  readText: readDecorText,
  checkAll: checkDecorGrids,
} satisfies ContentKind<typeof decorFileSchema>;

/** A text row's cells (code points). */
function cells(row: string): string[] {
  return [...row];
}

/**
 * The size of a map content entry, read by its shape: a `map` field of rows (a platformer level,
 * a top-down room, a tower-defense map) or a world scenario's `terrain.rows`; null for anything else.
 */
export function contentMapSize(value: unknown): { cols: number; rows: number } | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as { map?: unknown; terrain?: { rows?: unknown } };
  const rows = Array.isArray(v.map) ? v.map : Array.isArray(v.terrain?.rows) ? v.terrain.rows : null;
  if (rows === null || rows.length === 0 || !rows.every((r) => typeof r === 'string')) return null;
  return { cols: Math.max(...(rows as string[]).map((r) => cells(r).length)), rows: rows.length };
}

/** Every skin `decor` entry that names `grid`: the skin's name, the map id and the entry. */
function usesOf(grid: string, others: ContentLookup) {
  const out: { skin: string; map: string; entry: SkinDecor }[] = [];
  for (const s of others('skin')) {
    const decor = (s.value as { decor?: Record<string, SkinDecor> }).decor ?? {};
    for (const [map, entry] of Object.entries(decor))
      if (entry.grid === grid) out.push({ skin: s.name, map, entry });
  }
  return out;
}

/** The size the decor of `map` must have: its `size`, else its `map` entry's, else the entry named `map`'s. */
function expectedSize(
  map: string,
  entry: DeepReadonly<SkinDecor>,
  others: ContentLookup,
): { cols: number; rows: number; what: string } | null {
  if (entry.size !== undefined) return { ...entry.size, what: `the size the skin gives map "${map}"` };
  const name = entry.map ?? map;
  for (const e of others('*')) {
    if (e.name !== name) continue;
    const size = contentMapSize(e.value);
    if (size !== null) return { ...size, what: `map "${name}"` };
  }
  return null;
}

/** The decor kind's cross-file check (see {@link DECOR_KIND}). */
export function checkDecorGrids(
  entries: readonly { name: string; value: DecorFile }[],
  others: ContentLookup,
): KindIssue[] {
  const issues: KindIssue[] = [];
  for (const { name, value } of entries) {
    const rows = value.rows;
    const width = Math.max(...rows.map((r) => cells(r).length));
    rows.forEach((row, r) => {
      if (cells(row).length === width) return;
      const message = `row ${r} is ${cells(row).length} wide, expected ${width}`;
      issues.push({ name, path: ['rows', r], code: 'ragged_row', message, row: r, col: cells(row).length });
    });
    for (const use of usesOf(name, others)) {
      const size = expectedSize(use.map, use.entry, others);
      if (size !== null && (size.cols !== width || size.rows !== rows.length)) {
        const message = `the grid is ${width} x ${rows.length}, but ${size.what} is ${size.cols} x ${size.rows} (skin "${use.skin}", decor.${use.map})`;
        issues.push({ name, path: ['rows'], code: 'wrong_size', message });
      }
      rows.forEach((row, r) => {
        cells(row).forEach((ch, c) => {
          if ((DECOR_EMPTY as readonly string[]).includes(ch) || Object.hasOwn(use.entry.legend, ch)) return;
          const message = `row ${r}, col ${c}: ${JSON.stringify(ch)} is not in the legend of skin "${use.skin}" decor.${use.map}`;
          issues.push({ name, path: ['rows', r], code: 'unknown_char', message, row: r, col: c });
        });
      });
    }
  }
  return issues;
}

/**
 * A skin's decor and places references (the skin's `checkAll`): each `decor` grid must be a
 * decor file of the game and its `map` a content entry with a grid (`missing_ref`); each place's
 * font a font file (`missing_ref`) with a glyph for every character of its text (`missing_glyph`).
 */
export function checkDecorRefs(
  name: string,
  skin: {
    decor?: DeepReadonly<Record<string, SkinDecor>>;
    places?: DeepReadonly<Record<string, SkinPlace[]>>;
  },
  others: ContentLookup,
): KindIssue[] {
  const issues: KindIssue[] = [];
  const grids = new Set(others('decor').map((e) => e.name));
  for (const [map, entry] of Object.entries(skin.decor ?? {})) {
    const at: FieldPath = ['decor', map];
    if (!grids.has(entry.grid)) {
      const message = `no decor file "${entry.grid}" in the game (claim it under content.decor)`;
      issues.push({ name, path: [...at, 'grid'], code: 'missing_ref', message });
    }
    if (
      entry.map !== undefined &&
      !others('*').some((e) => e.name === entry.map && contentMapSize(e.value))
    ) {
      const message = `no map "${entry.map}" with a grid in the game (a level, room, defence map or world scenario)`;
      issues.push({ name, path: [...at, 'map'], code: 'missing_ref', message });
    }
  }
  const fonts = new Map(others('font').map((e) => [e.name, e.value as FontFile]));
  for (const [map, list] of Object.entries(skin.places ?? {})) {
    list.forEach((place, i) => {
      const at: FieldPath = ['places', map, i];
      const font = fonts.get(place.font);
      if (font === undefined) {
        const message = `no font "${place.font}" in the game`;
        issues.push({ name, path: [...at, 'font'], code: 'missing_ref', message });
        return;
      }
      const chars = missingGlyphs(new Set(Object.keys(font.glyphs)), place.text);
      if (chars.length === 0) return;
      const message = `font "${place.font}" has no glyph for ${chars.map((c) => JSON.stringify(c)).join(', ')}`;
      issues.push({ name, path: [...at, 'text'], code: 'missing_glyph', message });
    });
  }
  return issues;
}

// ---- Placement ----

/** One decor model placed on a cell: everything a backend needs, every random pick made. */
export interface DecorPlacement {
  /** The grid character. */
  char: string;
  col: number;
  row: number;
  /** The model path (one of the legend entry's). */
  model: string;
  /** Px per model unit. */
  scale: number;
  /** Degrees about the vertical (clockwise seen from above in ground view). */
  yaw: number;
  /** Px from the cell centre: right, down (south) and toward the camera (up). */
  offset: { x: number; y: number; z: number };
  anchor: SkinDecorLegend['anchor'];
  rotate: { x: number; y: number; z: number };
  castShadow: boolean;
  receiveShadow: boolean;
  instanced: boolean;
  /** Material name -> colour (Engine 0.16 F6; empty: none). */
  materials: Record<string, string>;
  /** A colour every material's colour is multiplied by, or null (Engine 0.16 F6). */
  tint: string | null;
  /** The entry's point light, or null (Engine 0.16 F6). */
  light: SkinKindLight | null;
  /** The entry's emitter names (Engine 0.16 F6; empty: none). */
  emit: string[];
}

/** The presentation RNG stream of a decor cell. */
export function decorStream(map: string, col: number, row: number): string {
  return `decor:${map}:${col},${row}`;
}

/**
 * Every decor model of a map, in row then column order: each non-empty cell of `rows` with a
 * legend entry, its picks drawn from `fxRng(seed, 0, decorStream(map, col, row))` in a fixed
 * order (model, scale, yaw, jitter x, jitter y), so the same seed, map and grid always place the
 * same scene. Cells past `limit` (the map's size) and characters without an entry are left out.
 * An entry's `stack` (Engine 0.16 F6) follows its cell's placement, each with the same picks, its
 * own model and its `height` (times the cell's scale over the entry's base scale) added to the
 * offset's up part, with no light or emitters of its own. Pure.
 */
export function placeDecor(
  entry: DeepReadonly<SkinDecor>,
  rows: readonly string[],
  map: string,
  seed: number,
  limit?: { cols: number; rows: number },
): DecorPlacement[] {
  const out: DecorPlacement[] = [];
  rows.forEach((line, row) => {
    if (limit !== undefined && row >= limit.rows) return;
    cells(line).forEach((char, col) => {
      if (limit !== undefined && col >= limit.cols) return;
      if (!Object.hasOwn(entry.legend, char)) return;
      const spec = entry.legend[char]!;
      const rng = fxRng(seed, 0, decorStream(map, col, row));
      const models = typeof spec.model === 'string' ? [spec.model] : spec.model;
      const model = models[rng.int(models.length)]!;
      const s = spec.scale ?? 1;
      const scale = typeof s === 'number' ? s : s[0]! + rng.float() * (s[1]! - s[0]!);
      const y = spec.yaw ?? 0;
      const yaw = y === 'random' ? rng.float() * 360 : y === 'quarter' ? rng.int(4) * 90 : y;
      const j = spec.jitter ?? 0;
      const jx = j > 0 ? (rng.float() * 2 - 1) * j : 0;
      const jy = j > 0 ? (rng.float() * 2 - 1) * j : 0;
      const placed: DecorPlacement = {
        char,
        col,
        row,
        model,
        scale,
        yaw,
        offset: { x: (spec.offset?.x ?? 0) + jx, y: (spec.offset?.y ?? 0) + jy, z: spec.offset?.z ?? 0 },
        anchor: spec.anchor ?? 'bottom',
        rotate: { x: spec.rotate?.x ?? 0, y: spec.rotate?.y ?? 0, z: spec.rotate?.z ?? 0 },
        castShadow: spec.castShadow ?? false,
        receiveShadow: spec.receiveShadow ?? false,
        instanced: spec.instanced ?? true,
        materials: { ...(spec.materials ?? {}) },
        tint: spec.tint ?? null,
        light: spec.light === undefined ? null : { ...spec.light },
        emit: spec.emit === undefined ? [] : typeof spec.emit === 'string' ? [spec.emit] : [...spec.emit],
      };
      out.push(placed);
      // The stack's heights grow with the cell's drawn size (a tower's roof stays on its base).
      const grow = typeof s === 'number' ? 1 : scale / s[0]!;
      for (const top of spec.stack ?? [])
        out.push({
          ...placed,
          model: top.model,
          offset: { ...placed.offset, z: placed.offset.z + top.height * grow },
          light: null,
          emit: [],
        });
    });
  });
  return out;
}

/** A model tile cell's variation: quarter turns, a height factor and a brightness factor. */
export interface TileVariation {
  turns: number;
  height: number;
  tint: number;
}

/** No variation (a tile entry without `vary`). */
export const NO_TILE_VARIATION: TileVariation = { turns: 0, height: 1, tint: 1 };

/**
 * A model tile cell's variation (`vary`, Engine 0.16 F3), drawn from
 * `fxRng(seed, 0, "tile:<map>:<layer>:<col>,<row>")` in a fixed order (turn, height, tint); a
 * field left out draws nothing. Pure.
 */
export function tileVariation(
  vary: DeepReadonly<SkinTileVary> | undefined,
  seed: number,
  map: string,
  layer: string,
  col: number,
  row: number,
): TileVariation {
  if (vary === undefined) return NO_TILE_VARIATION;
  const rng = fxRng(seed, 0, `tile:${map}:${layer}:${col},${row}`);
  const turns = vary.turn === true ? rng.int(4) : 0;
  const height = vary.height ? 1 + (rng.float() * 2 - 1) * vary.height : 1;
  const tint = vary.tint ? 1 + (rng.float() * 2 - 1) * vary.tint : 1;
  return { turns, height, tint };
}

/** A decor lookup the 3D backend reads grids from: decor file name -> rows. */
export type DecorLookup = Readonly<Record<string, readonly string[]>>;

/** The game's decor grids by name (`content.entries` of kind `decor`). */
export function contentDecor(content: {
  entries: readonly { kind: string; name: string; value: unknown }[];
}): DecorLookup {
  const out: Record<string, readonly string[]> = {};
  for (const e of content.entries) if (e.kind === 'decor') out[e.name] = (e.value as DecorFile).rows;
  return out;
}
