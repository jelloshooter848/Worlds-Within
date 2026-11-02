import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ContentKind } from '@engine/core/content/kinds';
import { defineKit, type KitDef } from '@engine/core/kit';
import { EXIT } from './exit-codes';
import { gameKinds } from './game-check';
import { findKit } from './kits';
import { main } from './main';

/**
 * A game on two kits (Engine 0.7 T4): `uses` in `game.json` adds another kit's content kinds to
 * the game's own kit's. The test game is a copy of games/platformer-test (kit `platformer`) that
 * also uses `topdown` and holds the demo's three rooms.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const GAME = 'games/platformer-test';
const ROOMS = `${GAME}/content/rooms`;
const LEVEL_1 = `${GAME}/runs/level-1.run.json`;

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A temp folder with the test game on `platformer` using `uses` (`topdown` by default; null leaves
 * `uses` out), with the demo's rooms.
 */
function twoKitGame(uses: unknown = ['topdown']): string {
  const cwd = mkdtempSync(join(tmpdir(), 'ww-two-kits-'));
  temps.push(cwd);
  cpSync(join(ROOT, GAME), join(cwd, GAME), { recursive: true });
  cpSync(join(ROOT, '.prettierrc'), join(cwd, '.prettierrc'));
  mkdirSync(join(cwd, ROOMS), { recursive: true });
  cpSync(join(ROOT, 'games/demo/content/rooms'), join(cwd, ROOMS), { recursive: true });
  const file = join(cwd, GAME, 'game.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as { content: Record<string, string[]> };
  manifest.content.room = ['content/rooms/*.json'];
  writeFileSync(file, JSON.stringify(uses === null ? manifest : { ...manifest, uses }, null, 2) + '\n');
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
    expect(files).toContain(`${ROOMS}/courtyard.map.txt`);
    expect(files).toContain(`${GAME}/content/levels/level-1.json`);
  });

  it('reports a broken room file naming the file and field', async () => {
    const cwd = twoKitGame();
    writeFileSync(join(cwd, ROOMS, 'store-room.json'), '{ "id": "store-room", "at": [0, 0], "chests": 3 }\n');
    const { code, out } = await cli(cwd, 'validate', GAME);
    expect(code).toBe(EXIT.invalidContent);
    expect(out.errors).toEqual([
      expect.objectContaining({ file: `${ROOMS}/store-room.json`, path: 'chests' }),
    ]);
  });

  it('without `uses`, a room kind in the manifest is unknown', async () => {
    const cwd = twoKitGame(null);
    const { code, out } = await cli(cwd, 'validate', GAME);
    expect(code).toBe(EXIT.invalidContent);
    expect(JSON.stringify(out.errors)).toContain('unknown content kind \\"room\\"');
  });

  it('edits a room file of the second kit, checked against its schema', async () => {
    const cwd = twoKitGame();
    const room = `${ROOMS}/guard-room.json`;
    const refused = await cli(cwd, 'set', room, 'at', '"nowhere"');
    expect(refused.code).toBe(EXIT.invalidContent);
    const map = `${ROOMS}/guard-room.map.txt`;
    const get = await cli(cwd, 'get', map, 'rows.0');
    expect(get.code).toBe(EXIT.ok);
    expect(get.out).toMatchObject({ kind: 'room', value: '################' });
  });

  it('runs, dumps and mutant-checks the game unchanged: same hashes as without the rooms', async () => {
    const cwd = twoKitGame();
    const golden = JSON.parse(readFileSync(join(ROOT, `${GAME}/runs/level-1.hashes.json`), 'utf8')) as {
      hashes: unknown;
    };
    const run = await cli(cwd, 'run', LEVEL_1);
    expect(run.code).toBe(EXIT.ok);
    expect(run.out.hashes).toEqual(golden.hashes);
    const dump = await cli(cwd, 'dump', LEVEL_1, '--tick', '10');
    expect(dump.code).toBe(EXIT.ok);
    // Rules stay the game's own kit's: `uses` adds content kinds only.
    const mutants = await cli(cwd, 'mutants', LEVEL_1);
    expect(mutants.out).toMatchObject({ kit: 'platformer', baseline: { passed: true } });
    expect((mutants.out.rules as unknown[]).length).toBe(findKit('platformer')!.rules.length);
    const topdownRule = await cli(cwd, 'run', LEVEL_1, '--disable-rule', 'doors-change-room');
    expect(topdownRule.code).toBe(EXIT.usage);
    expect(JSON.stringify(topdownRule.out)).toContain(
      'kit \\"platformer\\" has no rule \\"doors-change-room\\"',
    );
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
