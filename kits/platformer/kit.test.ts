import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadContent } from '@engine/core/content/bundle';
import { engineContentKinds } from '@engine/core/content/engine-kinds';
import type { ContentError } from '@engine/core/content/validate';
import { kit } from './kit';
import type { LevelDef } from './level';
import type { ProfileDef } from './profile';
import { PLATFORMER_RULES } from './rules';

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');

const MANIFEST = JSON.stringify({
  id: 'lab',
  kit: 'platformer',
  content: { level: ['content/levels/*.json'], profile: ['content/profiles/*.profile.json'] },
  start: { seed: 1 },
  headless: 'headless.ts',
});

/** The fixture game's files, with any file replaced or added by `over`. */
function files(over: Record<string, string> = {}): Record<string, string> {
  return {
    'game.json': MANIFEST,
    'content/levels/tiny.json': fixture('tiny.json'),
    'content/levels/tiny.map.txt': fixture('tiny.map.txt'),
    'content/profiles/runner.profile.json': fixture('runner.profile.json'),
    ...over,
  };
}

function load(over: Record<string, string> = {}) {
  const kinds = engineContentKinds();
  for (const k of kit.kinds()) kinds.register(k);
  return loadContent(files(over), kinds, { root: 'games/lab/' });
}

const brief = (errors: readonly ContentError[]) =>
  errors.map((e) => ({ file: e.file, path: e.path, code: e.code, row: e.row, col: e.col, line: e.line }));

/** The fixture map with the character at row/col replaced. */
function mapWith(row: number, col: number, ch: string): string {
  const rows = fixture('tiny.map.txt').split('\n');
  rows[row] = rows[row]!.slice(0, col) + ch + rows[row]!.slice(col + 1);
  return rows.join('\n');
}

describe('the platformer kit hook', () => {
  it('names the kit, its two kinds and opts in to strict mutants', () => {
    expect(kit.name).toBe('platformer');
    expect(kit.kinds().map((k) => k.name)).toEqual(['level', 'profile']);
    expect(kit.strictMutants).toBe(true);
    expect(kit.rules).toBe(PLATFORMER_RULES);
  });
});

describe('the fixture level and profile', () => {
  it('load as a game would load them, with the size from the grid', () => {
    const r = load();
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const level = r.value.entries.find((e) => e.kind === 'level')!.value as LevelDef;
    expect(level.map).toHaveLength(8);
    expect(level.map.every((row) => row.length === 24)).toBe(true);
    expect(level.spawns).toEqual({ w: { actor: 'walker', facing: 'left' } });
    expect(level.scroll).toBe('right');
    const profile = r.value.entries.find((e) => e.kind === 'profile')!.value as ProfileDef;
    expect(profile.id).toBe('runner');
    expect(Object.keys(profile.actors)).toEqual(['walker', 'shell-walker', 'shell']);
  });

  it('has a floor, a gap, a step, a coin, a bump block, one walker and a goal', () => {
    const map = fixture('tiny.map.txt').trim().split('\n');
    const all = map.join('');
    for (const ch of ['#', '?', 'o', 'w', 'G', '@']) expect(all).toContain(ch);
    expect(all.split('w')).toHaveLength(2);
    expect(map.at(-1)).toMatch(/#\.+#/); // a gap in the floor
    expect(map.at(-2)).toContain('##'); // a step on it
  });

  it('names the file and the field for a broken header field', () => {
    const header = { ...JSON.parse(fixture('tiny.json')), scroll: 'sideways' };
    const r = load({ 'content/levels/tiny.json': JSON.stringify(header) });
    expect(brief(r.errors)).toMatchObject([
      { file: 'games/lab/content/levels/tiny.json', path: 'scroll', code: 'invalid_value' },
    ]);
  });

  it('names the profile file and field for a broken number', () => {
    const p = JSON.parse(fixture('runner.profile.json'));
    p.player.walkAccel = 1.5;
    const r = load({ 'content/profiles/runner.profile.json': JSON.stringify(p) });
    expect(brief(r.errors)).toMatchObject([
      {
        file: 'games/lab/content/profiles/runner.profile.json',
        path: 'player.walkAccel',
        code: 'invalid_type',
      },
    ]);
  });

  it('reports a second start at its row and col in the .map.txt file', () => {
    const r = load({ 'content/levels/tiny.map.txt': mapWith(6, 4, '@') });
    expect(brief(r.errors)).toEqual([
      {
        file: 'games/lab/content/levels/tiny.map.txt',
        path: 'map.6',
        code: 'two_starts',
        row: 6,
        col: 4,
        line: 7,
      },
    ]);
  });

  it('reports a spawn of an unknown actor kind at its row and col', () => {
    const header = { ...JSON.parse(fixture('tiny.json')), spawns: { w: { actor: 'hopper' } } };
    const r = load({ 'content/levels/tiny.json': JSON.stringify(header) });
    expect(brief(r.errors)).toEqual([
      {
        file: 'games/lab/content/levels/tiny.map.txt',
        path: 'map.6',
        code: 'unknown_actor',
        row: 6,
        col: 15,
        line: 7,
      },
    ]);
    expect(r.errors[0]!.message).toContain('"hopper" is not an actor type of profile "runner"');
  });

  it('reports a missing goal, a missing start and a profile that is not there', () => {
    const map = fixture('tiny.map.txt').replace('@', '.').replace('G', '.');
    const header = { ...JSON.parse(fixture('tiny.json')), profile: 'floaty' };
    const r = load({
      'content/levels/tiny.map.txt': map,
      'content/levels/tiny.json': JSON.stringify(header),
    });
    expect(brief(r.errors).map((e) => [e.file, e.path, e.code])).toEqual([
      ['games/lab/content/levels/tiny.map.txt', 'map', 'no_start'],
      ['games/lab/content/levels/tiny.map.txt', 'map', 'no_goal'],
      ['games/lab/content/levels/tiny.json', 'profile', 'missing_profile'],
    ]);
  });

  it('reports an unknown character in the map at its line', () => {
    const r = load({ 'content/levels/tiny.map.txt': mapWith(2, 3, 'Z') });
    expect(brief(r.errors)).toEqual([
      {
        file: 'games/lab/content/levels/tiny.map.txt',
        path: 'map.2',
        code: 'unknown_char',
        row: 2,
        col: 3,
        line: 3,
      },
    ]);
  });
});
