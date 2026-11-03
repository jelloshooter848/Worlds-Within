import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadContent } from '@engine/core/content/bundle';
import { engineContentKinds } from '@engine/core/content/engine-kinds';
import { validate, type ContentError } from '@engine/core/content/validate';
import { canonicalJson } from '@engine/core/headless';
import { kit } from './kit';
import { TOWERDEFENSE_RULES } from './rules';
import {
  tdMapSchema,
  tdTowersSchema,
  tdWavesSchema,
  towerTable,
  type TdMap,
  type TdTowers,
  type TdWaves,
} from './schema';
import { TdWorld } from './world';

const FIXTURE = '__fixtures__/game/';
const read = (path: string): string => readFileSync(new URL(`${FIXTURE}${path}`, import.meta.url), 'utf8');

/** The fixture game's files, with some replaced or added. */
function files(over: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of [
    'game.json',
    'content/maps/tiny.json',
    'content/maps/tiny.map.txt',
    'content/towers.json',
    'content/waves/tiny.json',
  ])
    out[f] = read(f);
  return { ...out, ...over };
}

function load(over: Record<string, string> = {}) {
  const kinds = engineContentKinds();
  for (const k of kit.kinds()) kinds.register(k);
  return loadContent(files(over), kinds, { root: 'games/td/' });
}

const brief = (errors: readonly ContentError[]) =>
  errors.map((e) => {
    const out: Record<string, unknown> = { file: e.file, path: e.path, code: e.code };
    if (e.row !== undefined) out.row = e.row;
    if (e.col !== undefined) out.col = e.col;
    return out;
  });

const MAP = { id: 'm', start: { gold: 10, lives: 2 }, towers: ['arrow'], waves: 'w' };
const mapErrors = (map: string[], over: Record<string, unknown> = {}) => {
  const r = validate('m.json', { ...MAP, ...over, map }, tdMapSchema);
  return r.ok ? [] : brief(r.errors).map(({ file: _file, ...rest }) => rest);
};

describe('the towerdefense kit hook', () => {
  it('names the kit, its three kinds and its rules, without strict mutants yet', () => {
    expect(kit.name).toBe('towerdefense');
    expect(kit.kinds().map((k) => k.name)).toEqual(['td-map', 'td-towers', 'td-waves']);
    expect(kit.rules).toBe(TOWERDEFENSE_RULES);
    expect(kit.strictMutants).toBeUndefined();
  });

  it('loads the fixture game as a game would', () => {
    const loaded = load();
    expect(loaded.ok ? [] : brief(loaded.errors)).toEqual([]);
  });

  it('names the file and field of a map, tower or wave problem', () => {
    const map = JSON.parse(read('content/maps/tiny.json')) as Record<string, unknown>;
    const loaded = load({
      'content/maps/tiny.json': JSON.stringify({ ...map, start: { gold: -1, lives: 3 } }),
      'content/towers.json': JSON.stringify({
        towers: { arrow: { cost: 1, range: 1, damage: 0, cooldown: 1 } },
      }),
      'content/maps/tiny.map.txt': 'S##...\n.B#B..\n..#Z#X\n..B...\n',
    });
    expect(loaded.ok ? [] : brief(loaded.errors)).toEqual([
      { file: 'games/td/content/maps/tiny.json', path: 'start.gold', code: 'too_small' },
      { file: 'games/td/content/maps/tiny.map.txt', path: 'map.2', code: 'unknown_char', row: 2, col: 3 },
      { file: 'games/td/content/towers.json', path: 'towers.arrow.damage', code: 'too_small' },
    ]);
  });

  it("checks a map's tower types and wave list across files", () => {
    const map = JSON.parse(read('content/maps/tiny.json')) as Record<string, unknown>;
    const loaded = load({
      'content/maps/tiny.json': JSON.stringify({ ...map, towers: ['arrow', 'laser'], waves: 'later' }),
    });
    expect(loaded.ok ? [] : brief(loaded.errors)).toEqual([
      { file: 'games/td/content/maps/tiny.json', path: 'towers.1', code: 'unknown_tower' },
      { file: 'games/td/content/maps/tiny.json', path: 'waves', code: 'unknown_waves' },
    ]);
  });

  it('refuses a tower type given in two files', () => {
    const manifest = JSON.parse(read('game.json')) as { content: Record<string, string[]> };
    manifest.content['td-towers'] = ['content/towers*.json'];
    const loaded = load({
      'game.json': JSON.stringify(manifest),
      'content/towers2.json': JSON.stringify({
        towers: { arrow: { cost: 1, range: 1, damage: 1, cooldown: 1 } },
      }),
    });
    expect(loaded.ok ? [] : brief(loaded.errors)).toEqual([
      { file: 'games/td/content/towers2.json', path: 'towers.arrow', code: 'duplicate_tower' },
    ]);
  });

  it('plays the fixture round to its end, the same twice', () => {
    const map = validate(
      'tiny.json',
      {
        ...JSON.parse(read('content/maps/tiny.json')),
        map: read('content/maps/tiny.map.txt').trim().split('\n'),
      },
      tdMapSchema,
    );
    const towers = validate('towers.json', JSON.parse(read('content/towers.json')), tdTowersSchema);
    const waves = validate('tiny.json', JSON.parse(read('content/waves/tiny.json')), tdWavesSchema);
    if (!map.ok || !towers.ok || !waves.ok) throw new Error('fixture does not load');
    const run = () => {
      const w = new TdWorld(
        {
          map: map.value as TdMap,
          towers: towerTable([{ value: towers.value as TdTowers }]),
          waves: waves.value as TdWaves,
        },
        { seed: 3 },
      );
      w.place('arrow', 1, 1);
      w.place('arrow', 3, 1);
      const hashes: string[] = [];
      while (w.outcome === 'playing' && w.tick < 500) {
        w.step();
        hashes.push(canonicalJson(w.snapshot()));
      }
      return { hashes, end: w.snapshot() };
    };
    const a = run();
    expect(run().hashes).toEqual(a.hashes);
    expect(a.end).toMatchObject({ outcome: 'won', wave: { started: 2, total: 2 } });
  });
});

describe('td-map grids and paths', () => {
  it('takes one walk from the entry to the exit, with the header’s own characters', () => {
    expect(mapErrors(['S#W', '.#.', '.#X'], { legend: { W: 'build' } })).toEqual([]);
    expect(mapErrors(['S#W', '.##', '..X'], { legend: { W: 'build' } })).toEqual([]);
  });

  it('names the cell of each path problem', () => {
    expect(mapErrors(['S#.', '...', '..X'])).toEqual([
      { path: 'map.0', code: 'path_broken', row: 0, col: 1 },
    ]);
    expect(mapErrors(['S##', '.#.', '.#X'])).toEqual([
      { path: 'map.0', code: 'path_branch', row: 0, col: 1 },
    ]);
    expect(mapErrors(['S#X', '...', '.#.'])).toEqual([
      { path: 'map.2', code: 'path_off_walk', row: 2, col: 1 },
    ]);
    expect(mapErrors(['S#S', '.#.', '.#X'])).toEqual([
      { path: 'map.0', code: 'two_entries', row: 0, col: 2 },
    ]);
    expect(mapErrors(['S##', '...'])).toEqual([{ path: 'map', code: 'no_exit' }]);
    expect(mapErrors(['.#X', '...'])).toEqual([{ path: 'map', code: 'no_entry' }]);
    expect(mapErrors(['S#X', 'X..'])).toEqual([{ path: 'map.1', code: 'two_exits', row: 1, col: 0 }]);
  });

  it('refuses a bad legend key, a duplicate tower and a ragged grid', () => {
    expect(mapErrors(['S#X'], { legend: { B: 'path', ab: 'build' } })).toEqual([
      { path: 'legend.B', code: 'bad_legend_char' },
      { path: 'legend.ab', code: 'bad_legend_char' },
    ]);
    expect(mapErrors(['S#X'], { towers: ['arrow', 'arrow'] })).toEqual([
      { path: 'towers', code: 'duplicate_tower' },
    ]);
    expect(mapErrors(['S#X', '..'])).toEqual([{ path: 'map.1', code: 'ragged_row', row: 1, col: 2 }]);
  });
});
