import { describe, expect, it } from 'vitest';
import { loadContent } from '@engine/core/content/bundle';
import { engineContentKinds } from '@engine/core/content/engine-kinds';
import { parseContent } from '@engine/core/content/kinds';
import type { ContentError } from '@engine/core/content/validate';
import { validate } from '@engine/core/content/validate';
import { isFullMap, presentFrameSchema, type PresentMap } from '@engine/core/present';
import { stateHash } from '@engine/core/state-hash';
import { battleSnapshot } from './__fixtures__/world';
import { decorLayerRows, RTS_DECOR, RTS_DECOR_CHARS, rtsDecorSchema } from './decor';
import { kit } from './kit';
import { presentMap, presentWorld, RtsPresentState } from './present';
import { rtsDecorKind } from './schema';
import { readWorld } from './snapshot';

/** Engine 0.16 polish Q, Q5: an RTS map's decoration grid, presentation only. */

const SIZE = { width: 320, height: 240 };

/** A decoration for the battle fixture's 8 x 6 map: trees, a rock, reeds and ground marks. */
const DECOR = ['T......P', '..r.....', '...|....', 'g..d....', '.....fbD', 'S......l'];

const MAP = {
  format: 'worlds-within/scenario',
  version: 1,
  seed: 3,
  systems: 'rts',
  terrain: {
    legend: { '.': { name: 'ground', cost: 1, passable: true } },
    rows: ['....', '....', '....'],
    elevation: ['0000', '0000', '0000'],
  },
  entities: [],
};

/** Loads a tiny game: one map (`field`) and the given files (`decor: false`: no `rts-decor` claimed). */
function load(files: Record<string, string>, decor = true) {
  const kinds = engineContentKinds();
  for (const k of kit.kinds()) kinds.register(k);
  const manifest = {
    id: 'field',
    kit: 'rts',
    content: {
      'rts-map': ['content/maps/*.world.json'],
      ...(decor && { 'rts-decor': ['content/maps/*.decor.txt'] }),
    },
    start: { seed: 1 },
    headless: 'headless.ts',
  };
  return loadContent(
    {
      'game.json': JSON.stringify(manifest),
      'content/maps/field.world.json': JSON.stringify(MAP),
      ...files,
    },
    kinds,
    { root: 'games/field/' },
  );
}

const brief = (errors: readonly ContentError[]) =>
  errors.map((e) => ({ file: e.file, path: e.path, code: e.code, ...(e.line && { line: e.line }) }));

describe('the rts-decor kind', () => {
  it('lists its characters: `.` for nothing, no digit (the terrain tiles are keyed by digits)', () => {
    expect(RTS_DECOR['.']).toBe('nothing');
    for (const ch of ['T', 'P', 'S', 'b', 'r', 'R', 'f', 'g', 'd', 'D', '|'])
      expect(RTS_DECOR_CHARS.has(ch)).toBe(true);
    for (const ch of '0123456789 ') expect(RTS_DECOR_CHARS.has(ch), ch).toBe(false);
  });

  it('reports a character not in the set and a short row, at the row and line', () => {
    const r = parseContent(rtsDecorKind(), 'maps/field.decor.txt', '\nT..\n.x.\n..\n');
    expect(r.ok ? [] : brief(r.errors)).toEqual([
      { file: 'maps/field.decor.txt', path: 'rows.1', code: 'unknown_char', line: 3 },
      { file: 'maps/field.decor.txt', path: 'rows.2', code: 'ragged_row', line: 4 },
    ]);
    const ok = validate('d.json', { rows: DECOR }, rtsDecorSchema);
    expect(ok.ok && ok.value.rows).toEqual(DECOR);
  });

  it('loads beside its map, and reports one not the map’s size or with no map of its name', () => {
    expect(load({ 'content/maps/field.decor.txt': 'T...\n.r..\n...|\n' }).errors).toEqual([]);
    expect(load({}, false).errors).toEqual([]);
    const file = 'games/field/content/maps/field.decor.txt';
    expect(brief(load({ 'content/maps/field.decor.txt': 'T...\n.r..\n' }).errors)).toEqual([
      { file, path: 'rows', code: 'size_mismatch' },
    ]);
    expect(brief(load({ 'content/maps/field.decor.txt': 'T....\n.r...\n...|.\n' }).errors)).toEqual([
      { file, path: 'rows', code: 'size_mismatch' },
    ]);
    const orphan = 'games/field/content/maps/meadow.decor.txt';
    expect(brief(load({ 'content/maps/meadow.decor.txt': 'T...\n.r..\n...|\n' }).errors)).toEqual([
      { file: orphan, path: '', code: 'missing_ref' },
    ]);
  });
});

describe('the `decor` map layer', () => {
  const view = readWorld(battleSnapshot({ tick: 5 }));

  it('is the grid with empty cells as spaces, at the terrain’s size', () => {
    expect(decorLayerRows(['T.', '.r'], 3, 3)).toEqual(['T  ', ' r ', '   ']);
    expect(decorLayerRows(['T..P'], 2, 1)).toEqual(['T ']);
  });

  it('is in the map with a decoration and absent without one; the decoration is in the version', () => {
    const plain = presentMap(view)!;
    const dressed = presentMap(view, 16, 'rts', DECOR)!;
    expect(plain.layers).toBeUndefined();
    expect(dressed.layers).toEqual([{ name: 'decor', tiles: DECOR.map((r) => r.replaceAll('.', ' ')) }]);
    expect(dressed.version).not.toBe(plain.version);
    expect(presentMap(view, 16, 'rts', ['T'.repeat(8), ...DECOR.slice(1)])!.version).not.toBe(
      dressed.version,
    );
    expect({ ...dressed, layers: undefined, version: 0 }).toEqual({
      ...plain,
      layers: undefined,
      version: 0,
    });
    const frame = presentWorld(view, { faction: 'red', size: SIZE, decor: DECOR, fog: true });
    expect(validate('frame.json', frame, presentFrameSchema).errors).toEqual([]);
    const map = frame.map as PresentMap;
    expect(isFullMap(map) && map.layers?.[0]?.name).toBe('decor');
    expect(presentWorld(view, { faction: 'red', size: SIZE }).map).toEqual(plain);
  });

  it('changes nothing but the map: the same entities, status, fog and snapshot hash', () => {
    const snapshot = battleSnapshot({ tick: 5 });
    const before = stateHash(snapshot as never);
    const frames = [undefined, DECOR].map((decor) => {
      const state = new RtsPresentState();
      return presentWorld(readWorld(snapshot), {
        faction: 'red',
        size: SIZE,
        selection: [6, 7],
        fog: true,
        state,
        ...(decor && { decor }),
      });
    });
    const [plain, dressed] = frames as [ReturnType<typeof presentWorld>, ReturnType<typeof presentWorld>];
    expect({ ...dressed, map: undefined }).toEqual({ ...plain, map: undefined });
    expect(stateHash(snapshot as never)).toBe(before);
  });
});
