import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadContent } from '../content/bundle';
import { engineContentKinds } from '../content/engine-kinds';
import { encodeGltfEmbedded, lowPolyModel } from '../content/gltf';
import type { ContentKind } from '../content/kinds';
import { validate } from '../content/validate';
import {
  contentDecor,
  contentMapSize,
  DECOR_KIND,
  decorStream,
  NO_TILE_VARIATION,
  placeDecor,
  readDecorText,
  tileVariation,
  type SkinDecor,
} from './decor';
import { skinModelUses, skinSchema, type SkinFile } from './skin';

// Engine 0.16 F3: decor grids, places and per-cell tile variation.

const BUSH = lowPolyModel([
  { name: 'bush', shape: 'box', size: { x: 1, y: 1, z: 1 }, at: { x: 0, y: 0.5, z: 0 }, color: '#00a800' },
]);
const MODEL = encodeGltfEmbedded(BUSH.json, BUSH.bin);

/** A tiny map kind with a `map` grid (as a level or room has). */
const AREA = {
  name: 'area',
  description: 'a test map',
  schema: z.strictObject({ id: z.string(), map: z.array(z.string()).min(1) }),
  gridParts: { map: '.map.txt' },
} satisfies ContentKind;

const FONT = [
  'cell 3 3',
  'baseline 3',
  'space 2',
  ...['A', 'E', 'H', 'L', 'T'].flatMap((ch) => [`glyph ${ch}`, '###', '#.#', '###']),
].join('\n');

const CREDITS = '# Credits\n\n## pack\n\n- Source: own work\n- Author: us\n- Licence: CC0 1.0\n';

function skin(decor: unknown, places?: unknown): string {
  return JSON.stringify({
    backend: 'three',
    kinds: {},
    decor,
    ...(places !== undefined && { places }),
  });
}

const LEGEND = { b: { model: 'assets/pack/bush.gltf', scale: [8, 12], yaw: 'random', castShadow: true } };

function game(over: Record<string, string | undefined> = {}) {
  const base: Record<string, string | undefined> = {
    'game.json': JSON.stringify({
      id: 'g',
      kit: 'topdown',
      content: {
        area: ['content/areas/*.json'],
        decor: ['content/decor/*.txt'],
        skin: ['content/skins/*.json'],
        font: ['content/fonts/*.txt'],
      },
      start: { seed: 1 },
      headless: 'headless.ts',
    }),
    'content/areas/hall.json': JSON.stringify({ id: 'hall' }),
    'content/areas/hall.map.txt': '####\n#..#\n####\n',
    'content/decor/hall.txt': 'b..b\n....\n.bb.\n',
    'content/fonts/tiny.txt': FONT,
    'content/skins/three.json': skin({ hall: { grid: 'hall', legend: LEGEND } }),
    'assets/CREDITS.md': CREDITS,
    'assets/pack/bush.gltf': MODEL,
    ...over,
  };
  const files = Object.fromEntries(
    Object.entries(base).filter((e): e is [string, string] => e[1] !== undefined),
  );
  return loadContent(files, engineContentKinds().register(AREA), { root: 'games/g/' });
}

const codes = (r: ReturnType<typeof game>) => r.errors.map((e) => [e.file, e.path, e.code, e.row, e.col]);

describe('decor grids (Engine 0.16 F3)', () => {
  it('loads a game whose decor matches its map, legend and models', () => {
    const r = game();
    expect(r.errors).toEqual([]);
    if (!r.ok) return;
    expect(contentDecor(r.value)).toEqual({ hall: ['b..b', '....', '.bb.'] });
  });

  it('reports a grid of the wrong size against the map entry (wrong_size)', () => {
    expect(codes(game({ 'content/decor/hall.txt': 'b..b.\n.....\n.bb..\n' }))).toEqual([
      ['games/g/content/decor/hall.txt', 'rows', 'wrong_size', undefined, undefined],
    ]);
    // `size` for a map that is no content file; `map` names another entry.
    const sized = skin({ hall: { grid: 'hall', size: { cols: 4, rows: 2 }, legend: LEGEND } });
    expect(codes(game({ 'content/skins/three.json': sized })).map((c) => c[2])).toEqual(['wrong_size']);
    const named = skin({ rts: { grid: 'hall', map: 'hall', legend: LEGEND } });
    expect(game({ 'content/skins/three.json': named }).errors).toEqual([]);
  });

  it('reports a character the legend lacks at its row and column (unknown_char)', () => {
    expect(codes(game({ 'content/decor/hall.txt': 'b..b\n..x.\n.bb.\n' }))).toEqual([
      ['games/g/content/decor/hall.txt', 'rows.1', 'unknown_char', 1, 2],
    ]);
  });

  it('reports a missing or broken model file (missing_file, bad_model) at the legend', () => {
    expect(codes(game({ 'assets/pack/bush.gltf': undefined }))).toEqual([
      ['games/g/content/skins/three.json', 'decor.hall.legend.b.model', 'missing_file', undefined, undefined],
    ]);
    expect(
      codes(game({ 'assets/pack/bush.gltf': '{"asset":{"version":"1.0"}}' })).map((c) => [c[1], c[2]]),
    ).toEqual([['decor.hall.legend.b.model', 'bad_model']]);
    // A list of models is checked one by one, at its index.
    const two = skin({
      hall: { grid: 'hall', legend: { b: { model: ['assets/pack/bush.gltf', 'assets/pack/gone.gltf'] } } },
    });
    expect(codes(game({ 'content/skins/three.json': two })).map((c) => [c[1], c[2]])).toEqual([
      ['decor.hall.legend.b.model.1', 'missing_file'],
    ]);
  });

  it('reports a grid or map the game does not have (missing_ref) and a bad legend key (bad_legend_key)', () => {
    const missing = skin({ hall: { grid: 'nope', map: 'nowhere', legend: LEGEND } });
    expect(codes(game({ 'content/skins/three.json': missing })).map((c) => [c[1], c[2]])).toEqual([
      ['decor.hall.grid', 'missing_ref'],
      ['decor.hall.map', 'missing_ref'],
    ]);
    const bad = skin({ hall: { grid: 'hall', legend: { ...LEGEND, '.': LEGEND.b, ab: LEGEND.b } } });
    expect(codes(game({ 'content/skins/three.json': bad })).map((c) => [c[1], c[2]])).toEqual([
      ['decor.hall.legend["."]', 'bad_legend_key'],
      ['decor.hall.legend.ab', 'bad_legend_key'],
    ]);
  });

  it("checks places' fonts and glyphs (missing_ref, missing_glyph)", () => {
    const ok = { hall: [{ text: 'THE HALL', x: 32, y: 24, font: 'tiny' }] };
    expect(
      game({ 'content/skins/three.json': skin({ hall: { grid: 'hall', legend: LEGEND } }, ok) }).errors,
    ).toEqual([]);
    const bad = {
      hall: [
        { text: 'THE HALL', x: 0, y: 0, font: 'big' },
        { text: 'HALLS', x: 0, y: 0, font: 'tiny' },
      ],
    };
    expect(
      codes(game({ 'content/skins/three.json': skin({ hall: { grid: 'hall', legend: LEGEND } }, bad) })).map(
        (c) => [c[1], c[2]],
      ),
    ).toEqual([
      ['places.hall.0.font', 'missing_ref'],
      ['places.hall.1.text', 'missing_glyph'],
    ]);
  });

  it('reads a decor .txt with the line of each row', () => {
    const read = readDecorText('\n\nab\ncd\n');
    expect(read).toEqual({
      ok: true,
      data: { rows: ['ab', 'cd'] },
      lines: { '': 3, '/rows/0': 3, '/rows/1': 4 },
    });
    expect(validate('d.json', { rows: [] }, DECOR_KIND.schema).ok).toBe(false);
  });

  it('reads map sizes by shape: a map grid or a world scenario terrain', () => {
    expect(contentMapSize({ map: ['abc', 'def'] })).toEqual({ cols: 3, rows: 2 });
    expect(contentMapSize({ terrain: { rows: ['....', '....', '....'] } })).toEqual({ cols: 4, rows: 3 });
    expect(contentMapSize({ id: 'x' })).toBeNull();
  });

  it('lists decor models with the skin models (for preload and validate)', () => {
    const s = skinSchema.parse(JSON.parse(skin({ hall: { grid: 'hall', legend: LEGEND } }))) as SkinFile;
    expect(skinModelUses(s)).toEqual([
      { path: ['decor', 'hall', 'legend', 'b'], model: 'assets/pack/bush.gltf', clips: [] },
    ]);
  });
});

describe('placing decor (Engine 0.16 F3)', () => {
  const entry = {
    grid: 'g',
    legend: {
      b: { model: ['m/a.glb', 'm/b.glb'], scale: [8, 12], yaw: 'random', jitter: 2 },
      r: { model: 'm/r.glb', yaw: 'quarter', offset: { x: 1, y: 2, z: 3 }, instanced: false },
      t: { model: 'm/t.glb', scale: 5, yaw: 45 },
    },
  } as unknown as SkinDecor;

  it('places one model per legend cell, its picks from the presentation RNG, the same every time', () => {
    const rows = ['b.r', ' tb'];
    const a = placeDecor(entry, rows, 'hall', 7);
    expect(a.map((p) => [p.char, p.col, p.row])).toEqual([
      ['b', 0, 0],
      ['r', 2, 0],
      ['t', 1, 1],
      ['b', 2, 1],
    ]);
    expect(placeDecor(entry, rows, 'hall', 7)).toEqual(a);
    for (const p of a.filter((p) => p.char === 'b')) {
      expect(['m/a.glb', 'm/b.glb']).toContain(p.model);
      expect(p.scale).toBeGreaterThanOrEqual(8);
      expect(p.scale).toBeLessThan(12);
      expect(p.yaw).toBeGreaterThanOrEqual(0);
      expect(p.yaw).toBeLessThan(360);
      expect(Math.abs(p.offset.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(p.offset.y)).toBeLessThanOrEqual(2);
      expect(p.instanced).toBe(true);
    }
    const r = a.find((p) => p.char === 'r')!;
    expect(r.yaw % 90).toBe(0);
    expect(r.offset).toEqual({ x: 1, y: 2, z: 3 });
    expect(r.instanced).toBe(false);
    expect(a.find((p) => p.char === 't')).toMatchObject({
      scale: 5,
      yaw: 45,
      model: 'm/t.glb',
      castShadow: false,
    });
    // Another seed or map dresses it differently; a limit cuts cells off the map.
    expect(placeDecor(entry, rows, 'hall', 8)).not.toEqual(a);
    expect(placeDecor(entry, rows, 'yard', 7)).not.toEqual(a);
    expect(placeDecor(entry, rows, 'hall', 7, { cols: 2, rows: 1 }).map((p) => p.char)).toEqual(['b']);
    expect(decorStream('hall', 3, 4)).toBe('decor:hall:3,4');
  });

  it('varies model tiles per cell only when asked, the same for a seed', () => {
    expect(tileVariation(undefined, 1, 'm', 'tiles', 0, 0)).toBe(NO_TILE_VARIATION);
    const vary = { turn: true, height: 0.1, tint: 0.2 };
    const cells = Array.from({ length: 40 }, (_, i) => tileVariation(vary, 1, 'm', 'tiles', i, 0));
    expect(cells).toEqual(Array.from({ length: 40 }, (_, i) => tileVariation(vary, 1, 'm', 'tiles', i, 0)));
    expect(new Set(cells.map((c) => c.turns))).toEqual(new Set([0, 1, 2, 3]));
    for (const c of cells) {
      expect(c.height).toBeGreaterThanOrEqual(0.9);
      expect(c.height).toBeLessThanOrEqual(1.1);
      expect(c.tint).toBeGreaterThanOrEqual(0.8);
      expect(c.tint).toBeLessThanOrEqual(1.2);
    }
    expect(tileVariation({ height: 0.1 }, 1, 'm', 'tiles', 3, 0).turns).toBe(0);
  });
});
