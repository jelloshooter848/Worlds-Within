import { z } from 'zod';

/**
 * The game manifest: `game.json` at the root of a game's folder. It names the game and its kit,
 * says which files hold which kind of content, how a run starts, and which module boots the game
 * headless (for the CLI's `run`) and, optionally, which one draws it (for `screenshot`).
 *
 *   { "id": "demo",
 *     "kit": "topdown",
 *     "content": { "room": ["content/rooms/*.json"], "song": ["content/songs/*.json"] },
 *     "start": { "seed": 1 },
 *     "headless": "headless.ts",
 *     "view": "view.ts" }
 *
 * Content paths are relative to the game folder, with forward slashes. Each entry is a file path
 * or a glob: `*` and `?` match within one folder, `**` matches any number of folders.
 */

export const MANIFEST_FILE = 'game.json';

const NAME = /^[a-z0-9][a-z0-9-]*$/;

const name = (what: string) =>
  z.string().regex(NAME, { message: `${what} must be lower-case letters, digits and "-"` });

const relativePath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith('/') && !p.includes('\\') && !p.split('/').includes('..'), {
    message: 'a path relative to the game folder, with "/" and no ".."',
  });

export const gameManifestSchema = z.strictObject({
  id: name('a game id').describe("the game's id: its folder name"),
  title: z.string().min(1).exactOptional().describe('one line saying what the game is'),
  kit: name('a kit name').describe('the kit the game is built on (a folder under `kits/`)'),
  content: z
    .record(
      name('a content kind'),
      z
        .array(relativePath)
        .min(1)
        .describe('file paths or globs (`*`, `?`, `**`), relative to the game folder'),
    )
    .describe('content kind -> its files; every file under `content/` must be claimed by one kind'),
  start: z
    .strictObject({
      seed: z.number().int().min(0).describe("the seed for the world's RNG when nothing else gives one"),
    })
    .describe('how a run starts'),
  headless: relativePath.describe('the module that boots the game headless (`createGame`), for `run`'),
  view: relativePath
    .exactOptional()
    .describe('the module that boots the game for drawing (`createView`), for `screenshot`; optional'),
});

export type GameManifest = z.output<typeof gameManifestSchema>;
