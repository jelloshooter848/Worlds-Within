import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Rollup } from 'vite';
import { readGameFiles } from '@engine/core/node/game-files';
import {
  GAME_FILES_ID,
  findGameDir,
  gameFilePaths,
  gameFiles,
  gameFilesModule,
  noGameError,
  readGameFolder,
} from '../../build/game-files.ts';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const at = (path: string) => join(repoRoot, path);

/**
 * What each game's old `files.ts` got from Vite: the same glob, here from this file, so its keys
 * carry the folder (`../../games/samples/dungeon/game.json`). Vite resolves it at test time.
 */
const DEMO_GLOB = import.meta.glob(
  ['../../games/samples/dungeon/game.json', '../../games/samples/dungeon/content/**/*'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
) as Record<string, string>;
const SIEGE_GLOB = import.meta.glob(
  ['../../games/samples/mini-siege/game.json', '../../games/samples/mini-siege/content/**/*'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

/** The glob's pairs keyed relative to the game folder, as `import.meta.glob` gave them there. */
function relativeTo(dir: string, glob: Record<string, string>): Record<string, string> {
  const prefix = `../../${dir}/`;
  return Object.fromEntries(
    Object.entries(glob).map(([key, text]) => [`./${key.slice(prefix.length)}`, text]),
  );
}

describe('virtual:game-files (Engine 0.14 T2, G5)', () => {
  it('finds the nearest folder holding game.json above the importer', () => {
    expect(findGameDir(at('games/samples/dungeon/main.ts'))).toBe(at('games/samples/dungeon'));
    expect(findGameDir(at('games/samples/mini-siege/main.ts?v=1'))).toBe(at('games/samples/mini-siege'));
    // A file deeper in a game folder still finds that game.
    expect(findGameDir(at('games/samples/dungeon/content/rooms/x.json'))).toBe(at('games/samples/dungeon'));
  });

  it('finds no game outside a game folder', () => {
    expect(findGameDir(at('engine/core/loop.ts'))).toBeNull();
    expect(findGameDir(at('tests/build/game-files.test.ts'))).toBeNull();
  });

  it.each([
    ['games/samples/dungeon', DEMO_GLOB],
    ['games/samples/mini-siege', SIEGE_GLOB],
  ])("gives %s the old glob's keys and texts", (dir, glob) => {
    const old = relativeTo(dir, glob);
    // The old glob had no `assets/` (the dungeon's CC0 pack, Engine 0.16 part C T2): compare the
    // rest, and check the assets reach the game too.
    const all = readGameFolder(at(dir));
    const files = Object.fromEntries(Object.entries(all).filter(([k]) => !k.startsWith('./assets/')));
    if (dir === 'games/samples/dungeon') expect(all).toHaveProperty(['./assets/CREDITS.md']);
    // In the glob's order too (sorted, so game.json comes after content/).
    expect(Object.keys(files)).toEqual(Object.keys(old));
    expect(files).toEqual(old);
    expect(Object.keys(files)).toContain('./game.json');
    // The same files Node tools read (readGameFiles lists game.json first), with a leading `./`.
    const node = readGameFiles(at(dir));
    expect(Object.keys(all).sort()).toEqual(
      Object.keys(node)
        .map((k) => `./${k}`)
        .sort(),
    );
  });

  it('skips hidden files and keeps only game.json and content/', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ww-game-files-'));
    try {
      writeFileSync(join(dir, 'game.json'), '{}');
      writeFileSync(join(dir, 'main.ts'), '');
      mkdirSync(join(dir, 'content/rooms'), { recursive: true });
      mkdirSync(join(dir, 'content/.hidden'));
      writeFileSync(join(dir, 'content/rooms/b.json'), 'b');
      writeFileSync(join(dir, 'content/a.txt'), 'a');
      writeFileSync(join(dir, 'content/.DS_Store'), 'x');
      writeFileSync(join(dir, 'content/.hidden/c.json'), 'c');
      expect(gameFilePaths(dir)).toEqual(['./content/a.txt', './content/rooms/b.json', './game.json']);
      expect(gameFilesModule(dir)).toBe(
        'export default {"./content/a.txt":"a","./content/rooms/b.json":"b","./game.json":"{}"};\n',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('builds a page that imports it, and errors clearly outside a game folder', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ww-game-files-build-'));
    try {
      mkdirSync(join(root, 'game/content'), { recursive: true });
      writeFileSync(join(root, 'game/game.json'), '{"id":"x"}');
      writeFileSync(join(root, 'game/content/room.txt'), 'hall');
      const entry = `import files from '${GAME_FILES_ID}';\nexport const keys = Object.keys(files);\n`;
      writeFileSync(join(root, 'game/main.js'), entry);
      writeFileSync(join(root, 'outside.js'), entry);
      const bundle = (input: string) =>
        build({
          configFile: false,
          root,
          logLevel: 'silent',
          plugins: [gameFiles()],
          build: { write: false, lib: { entry: join(root, input), formats: ['es'] } },
        });

      const out = (await bundle('game/main.js')) as Rollup.RollupOutput[] | Rollup.RollupOutput;
      const chunk = (Array.isArray(out) ? out[0] : out)?.output[0];
      expect(chunk?.type).toBe('chunk');
      const code = chunk && 'code' in chunk ? chunk.code : '';
      expect(code).toContain('./content/room.txt');
      expect(code).toContain('hall');

      await expect(bundle('outside.js')).rejects.toThrow(
        noGameError(join(root, 'outside.js')).split(' or any')[0] ?? '',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
