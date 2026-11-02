import { z } from 'zod';

/**
 * The game manifest: `game.json` at the root of a game's folder. It names the game and its kit,
 * says which files hold which kind of content, how a run starts, and which module boots the game
 * headless (for the CLI's `run`).
 *
 *   { "id": "demo",
 *     "kit": "topdown",
 *     "content": { "room": ["content/rooms/*.json"], "song": ["content/songs/*.json"] },
 *     "start": { "seed": 1 },
 *     "headless": "headless.ts" }
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
  /** The game's id: its folder name. */
  id: name('a game id'),
  /** One line saying what the game is. */
  title: z.string().min(1).exactOptional(),
  /** The kit the game is built on (a folder under `kits/`). */
  kit: name('a kit name'),
  /** Content kind -> file paths or globs. Every file under `content/` must be claimed by one kind. */
  content: z.record(name('a content kind'), z.array(relativePath).min(1)),
  /** How a run starts. */
  start: z.strictObject({
    /** The seed for the world's RNG when nothing else gives one. */
    seed: z.number().int().min(0),
  }),
  /** The module (relative to the game folder) that boots the game headless, for `run`. */
  headless: relativePath,
});

export type GameManifest = z.output<typeof gameManifestSchema>;
