import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ContentKind } from '@engine/core/content/kinds';
import { defineKit, type KitDef } from '@engine/core/kit';
import { EXIT } from './exit-codes';
import { checkGameTexts, gameKinds } from './game-check';
import { findKit } from './kits';
import { main } from './main';

/**
 * A game on two kits (Engine 0.7 T4): `uses` in `game.json` adds another kit's content kinds to
 * the game's own kit's. The test game is a copy of games/platformer-classic (kit `platformer`), which
 * uses `topdown` and holds one room (`vault`, its door level's mini game, Engine 0.7 T5).
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const GAME = 'games/platformer-classic';
const ROOMS = `${GAME}/content/rooms`;
const LEVEL_1 = `${GAME}/runs/level-1.run.json`;

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A temp folder with the test game on `platformer` with `uses` set to `uses` (`topdown` by
 * default; null leaves `uses` out) and its room files.
 */
function twoKitGame(uses: unknown = ['topdown']): string {
  const cwd = mkdtempSync(join(tmpdir(), 'ww-two-kits-'));
  temps.push(cwd);
  cpSync(join(ROOT, GAME), join(cwd, GAME), { recursive: true });
  cpSync(join(ROOT, '.prettierrc'), join(cwd, '.prettierrc'));
  const file = join(cwd, GAME, 'game.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as {
    content: Record<string, string[]>;
    uses?: unknown;
  };
  manifest.content.room = ['content/rooms/*.json'];
  if (uses === null) delete manifest.uses;
  else manifest.uses = uses;
  writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
  return cwd;
}

async function cli(cwd: string, ...argv: string[]): Promise<{ code: number; out: Record<string, unknown> }> {
  let stdout = '';
  const io = { stdout: (t: string) => void (stdout += t), stderr: () => {}, cwd, outDir: join(cwd, 'out') };
  const code = await main([...argv, '--json'], io);
  return { code, out: JSON.parse(stdout) as Record<string, unknown> };
}

describe('a game on two kits', () => {
  it("validates the second kit's room files beside the first kit's levels", async () => {
    const cwd = twoKitGame();
    const { code, out } = await cli(cwd, 'validate', GAME);
    expect(out.errors).toEqual([]);
    expect(code).toBe(EXIT.ok);
    const files = (out.files as { file: string }[]).map((f) => f.file);
    expect(files).toContain(`${ROOMS}/vault.map.txt`);
    expect(files).toContain(`${GAME}/content/levels/level-1.json`);
  });

  it('reports a broken room file naming the file and field', async () => {
    const cwd = twoKitGame();
    writeFileSync(join(cwd, ROOMS, 'vault.json'), '{ "id": "vault", "at": [0, 0], "chests": 3 }\n');
    const { code, out } = await cli(cwd, 'validate', GAME);
    expect(code).toBe(EXIT.invalidContent);
    expect(out.errors).toEqual([expect.objectContaining({ file: `${ROOMS}/vault.json`, path: 'chests' })]);
  });

  it('without `uses`, a room kind in the manifest is unknown', async () => {
    const cwd = twoKitGame(null);
    const { code, out } = await cli(cwd, 'validate', GAME);
    expect(code).toBe(EXIT.invalidContent);
    expect(JSON.stringify(out.errors)).toContain('unknown content kind \\"room\\"');
  });

  it('edits a room file of the second kit, checked against its schema', async () => {
    const cwd = twoKitGame();
    const room = `${ROOMS}/vault.json`;
    const refused = await cli(cwd, 'set', room, 'at', '"nowhere"');
    expect(refused.code).toBe(EXIT.invalidContent);
    const map = `${ROOMS}/vault.map.txt`;
    const get = await cli(cwd, 'get', map, 'rows.0');
    expect(get.code).toBe(EXIT.ok);
    expect(get.out).toMatchObject({ kind: 'room', value: '################' });
  });

  it('runs, dumps and mutant-checks the game unchanged: same hashes as its golden file', async () => {
    const cwd = twoKitGame();
    const golden = JSON.parse(readFileSync(join(ROOT, `${GAME}/runs/level-1.hashes.json`), 'utf8')) as {
      hashes: unknown;
    };
    const run = await cli(cwd, 'run', LEVEL_1);
    expect(run.code).toBe(EXIT.ok);
    expect(run.out.hashes).toEqual(golden.hashes);
    const dump = await cli(cwd, 'dump', LEVEL_1, '--tick', '10');
    expect(dump.code).toBe(EXIT.ok);
    // Every kit's rules are tried (Engine 0.14, gap G12): `kit`'s bare, a `uses` kit's as `kit:id`.
    const mutants = await cli(cwd, 'mutants', LEVEL_1);
    expect(mutants.out).toMatchObject({ kit: 'platformer', baseline: { passed: true } });
    const rows = mutants.out.rules as { id: string; kit: string }[];
    expect(rows.length).toBe(findKit('platformer')!.rules.length + findKit('topdown')!.rules.length);
    expect(rows).toContainEqual(expect.objectContaining({ id: 'topdown:doors-change-room', kit: 'topdown' }));
    // A bare id is still the game's own kit's rule.
    const topdownRule = await cli(cwd, 'run', LEVEL_1, '--disable-rule', 'doors-change-room');
    expect(topdownRule.code).toBe(EXIT.usage);
    expect(JSON.stringify(topdownRule.out)).toContain(
      'kit \\"platformer\\" has no rule \\"doors-change-room\\"',
    );
    const qualified = await cli(cwd, 'run', LEVEL_1, '--disable-rule', 'topdown:doors-change-room');
    expect(qualified.code).toBe(EXIT.ok);
    expect(qualified.out.disabledRules).toEqual(['topdown:doors-change-room']);
    expect(qualified.out.hashes).toEqual(golden.hashes);
  });

  it('names the field for an unknown kit in `uses`', async () => {
    const cwd = twoKitGame(['topdown', 'nokit']);
    const { code, out } = await cli(cwd, 'validate', GAME);
    expect(code).toBe(EXIT.invalidContent);
    expect(out.errors).toContainEqual(
      expect.objectContaining({
        file: `${GAME}/game.json`,
        path: 'uses.1',
        code: 'unknown_kit',
        message: expect.stringContaining('unknown kit "nokit" in "uses.1": there is no kits/nokit/kit.ts'),
      }),
    );
  });

  it('reports a kit listed twice, or its own kit again, at that entry', async () => {
    const cwd = twoKitGame(['topdown', 'platformer']);
    const { code, out } = await cli(cwd, 'validate', GAME);
    expect(code).toBe(EXIT.invalidContent);
    expect(out.errors).toEqual([
      expect.objectContaining({ file: `${GAME}/game.json`, path: 'uses.1', code: 'duplicate_kit' }),
    ]);
  });

  it('a bad `uses` breaks the manifest schema at that field', async () => {
    const cwd = twoKitGame(['Top Down']);
    const { code, out } = await cli(cwd, 'validate', GAME);
    expect(code).toBe(EXIT.invalidContent);
    expect(out.errors).toContainEqual(expect.objectContaining({ file: `${GAME}/game.json`, path: 'uses.0' }));
  });
});

describe('gameKinds with two kits', () => {
  const manifest = (kit: string, uses: string[]) => JSON.stringify({ kit, uses });
  /** A test-only kit whose one kind is named `kind`. */
  const kitWith = (name: string, kind: string): KitDef =>
    defineKit({
      name,
      kinds: () => [{ ...(findKit('topdown')!.kinds()[0] as ContentKind), name: kind }],
      rules: [],
    });
  const find = (extra: KitDef) => (name: string) => (name === extra.name ? extra : findKit(name));

  it("merges every listed kit's kinds", () => {
    const { kinds, errors } = gameKinds(manifest('platformer', ['topdown']));
    expect(errors).toEqual([]);
    for (const name of ['level', 'profile', 'room', 'song']) expect(kinds.has(name)).toBe(true);
  });

  it('reports a kind clash naming both kits', () => {
    const clash = kitWith('rooms-too', 'room');
    const { kinds, errors } = gameKinds(manifest('topdown', ['rooms-too']), 'games/g/', find(clash));
    expect(kinds.has('room')).toBe(true);
    expect(errors).toEqual([
      expect.objectContaining({
        file: 'games/g/game.json',
        path: 'uses.0',
        code: 'kind_clash',
        message:
          'content kind "room" of kit "rooms-too" in "uses.0" clashes with kit "topdown", which already has a kind of that name',
      }),
    ]);
  });

  it("reports a clash with the engine's own kinds", () => {
    const clash = kitWith('songs', 'song');
    const { errors } = gameKinds(manifest('topdown', ['songs']), '', find(clash));
    expect(errors).toEqual([
      expect.objectContaining({
        path: 'uses.0',
        code: 'kind_clash',
        message: expect.stringContaining('the engine'),
      }),
    ]);
  });
});

describe('kit options in game.json (Engine 0.15, gap G17)', () => {
  const manifest = (kit: string, uses: string[], kitOptions: unknown) =>
    JSON.stringify({ kit, uses, kitOptions });

  it("takes the topdown kit's rooms option and refuses unknown or bad ones", () => {
    expect(gameKinds(manifest('platformer', ['topdown'], { topdown: { rooms: 'separate' } })).errors).toEqual(
      [],
    );
    expect(gameKinds(manifest('platformer', ['topdown'], { topdown: { rooms: 'dungeon' } })).errors).toEqual(
      [],
    );
    const { errors } = gameKinds(
      manifest('platformer', ['topdown'], { topdown: { rooms: 'apart', doors: 1 }, rts: {}, platformer: {} }),
      'games/g/',
    );
    expect(errors.map((e) => [e.path, e.code])).toEqual([
      ['kitOptions.topdown.rooms', 'bad_option'],
      ['kitOptions.topdown.doors', 'unknown_option'],
      ['kitOptions.rts', 'unknown_option'],
      ['kitOptions.platformer', 'unknown_option'],
    ]);
    expect(errors[0]!.file).toBe('games/g/game.json');
  });

  it('checks room files as one dungeon by default and each alone with rooms "separate"', () => {
    const room = (id: string) => [
      JSON.stringify({ id, at: [0, 0] }),
      [
        '################',
        ...Array.from({ length: 9 }, (_, i) => (i === 4 ? '#..@...........#' : '#..............#')),
        '################',
      ].join('\n'),
    ];
    const texts = (kitOptions: unknown) => {
      const [a, aMap] = room('a');
      const [b, bMap] = room('b');
      return {
        'game.json': JSON.stringify({
          id: 'g',
          kit: 'topdown',
          ...(kitOptions === undefined ? {} : { kitOptions }),
          content: { room: ['content/rooms/*.json'] },
          start: { seed: 1 },
          headless: 'headless.ts',
        }),
        'content/rooms/a.json': a!,
        'content/rooms/a.map.txt': aMap!,
        'content/rooms/b.json': b!,
        'content/rooms/b.map.txt': bMap!,
      } as Record<string, string>;
    };
    const dungeon = checkGameTexts(texts(undefined));
    expect(dungeon.ok).toBe(false);
    if (!dungeon.ok) expect(dungeon.errors.map((e) => e.code)).toContain('invalid_dungeon');
    expect(checkGameTexts(texts({ topdown: { rooms: 'separate' } })).ok).toBe(true);
    // Each room is still a dungeon of its own: one without a start fails alone.
    const noStart = texts({ topdown: { rooms: 'separate' } });
    noStart['content/rooms/b.map.txt'] = noStart['content/rooms/b.map.txt']!.replace('@', '.');
    const alone = checkGameTexts(noStart);
    expect(alone.ok).toBe(false);
    if (!alone.ok)
      expect(alone.errors).toEqual([
        expect.objectContaining({ file: 'content/rooms/b.map.txt', code: 'invalid_dungeon' }),
      ]);
  });
});
