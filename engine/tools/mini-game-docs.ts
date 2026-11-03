import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { z } from 'zod';
import { MANIFEST_FILE } from '@engine/core/content/manifest';
import { dottedPath } from '@engine/core/content/validate';
import type { HeadlessEntry } from '@engine/core/headless';
import { loadGame } from './game-loader';
import { allKits } from './kits';
import { miniGameUses } from './mini-game-check';

/**
 * The params pages of the mini games games define (Engine 0.15, gap M11; docs/BUILD-LOG.md,
 * Engine 0.15, decision 12): a kit's fixed-id mini games (`KitDef.paramsDocs`, the topdown kit's
 * `mission-room`) are listed in `docs/reference/schemas.md`, but a mini game a game makes itself
 * (`HeadlessEntry.miniGames`, such as the platformer sample's room challenges, whose ids are its
 * rooms') has its id only in the game. `pnpm docs:gen` writes one page per such mini game,
 * `docs/reference/mini-games/<game>-<id>.md`, with its params table from its `paramsSchema`, and
 * links each from the schema reference's "Mini game params".
 *
 * The games are the repo's (`games/**` with a `game.json`), found from this file's place, never a
 * static import: each game's headless module is imported by its path at run time, as `validate`
 * does (`mini-game-check.ts`). A game whose content does not load, or that exports no
 * `miniGames`, has no pages; a def with no `paramsSchema`, or whose id a kit documents, has none.
 */

export const MINI_GAMES_DIR = 'docs/reference/mini-games';

/** The repo this file is in: the games the pages are made from. */
export const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');

/** One mini game a game defines, for its params page. */
export interface GameMiniGameDoc {
  /** The game's id (`game.json`'s `id`). */
  readonly game: string;
  /** The game's folder, relative to the repo (`games/samples/platformer`). */
  readonly gameDir: string;
  /** The mini game's id, as content names it. */
  readonly id: string;
  /** Its title (`MiniGameDef.title`). */
  readonly title: string;
  readonly schema: z.ZodType;
  /** Where the game's content names it: `<file> (<field>)`, repo paths, in content order. */
  readonly uses: readonly string[];
  /** The page's repo path: `docs/reference/mini-games/<game>-<id>.md`. */
  readonly page: string;
}

/** Every folder under `games/` (relative to `root`, with `/`) holding a `game.json`, sorted. */
export function gameFolders(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let names: string[];
    try {
      names = readdirSync(join(root, dir)).sort();
    } catch {
      return;
    }
    if (names.includes(MANIFEST_FILE)) out.push(dir);
    for (const name of names) {
      if (name.startsWith('.') || name === 'node_modules') continue;
      const sub = `${dir}/${name}`;
      if (statSync(join(root, sub)).isDirectory()) walk(sub);
    }
  };
  walk('games');
  return out.sort();
}

/** The mini games every game under `root` defines that need a page, by page path. */
export async function gameMiniGameDocs(root: string = REPO_ROOT): Promise<GameMiniGameDoc[]> {
  const kitIds = new Set(allKits().flatMap((k) => (k.paramsDocs?.() ?? []).map((d) => d.game)));
  const docs: GameMiniGameDoc[] = [];
  for (const dir of gameFolders(root)) {
    const loaded = loadGame(root, dir);
    if (!loaded.content.ok) continue;
    const content = loaded.content.value;
    const abs = resolve(root, dir, content.manifest.headless);
    let mod: Partial<HeadlessEntry>;
    try {
      mod = (await import(pathToFileURL(abs).href)) as Partial<HeadlessEntry>;
    } catch {
      continue;
    }
    if (typeof mod.miniGames !== 'function') continue;
    const uses = miniGameUses(content);
    for (const def of mod.miniGames(content)) {
      if (def.paramsSchema === undefined || kitIds.has(def.id)) continue;
      const game = content.manifest.id;
      docs.push({
        game,
        gameDir: relative(root, resolve(root, dir)).replaceAll('\\', '/'),
        id: def.id,
        title: def.title,
        schema: def.paramsSchema,
        uses: uses
          .filter((u) => u.game === def.id)
          .map((u) => `${dir}/${u.file} (${dottedPath([...u.paramsAt])})`),
        page: `${MINI_GAMES_DIR}/${game}-${def.id}.md`,
      });
    }
  }
  return docs.sort((a, b) => a.page.localeCompare(b.page));
}

let cached: Promise<GameMiniGameDoc[]> | undefined;

/** {@link gameMiniGameDocs} of this repo, read once per process. */
export function repoMiniGameDocs(): Promise<GameMiniGameDoc[]> {
  cached ??= gameMiniGameDocs(REPO_ROOT);
  return cached;
}
