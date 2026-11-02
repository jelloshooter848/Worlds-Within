import { existsSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { readGameFiles } from '@engine/core/node/game-files';
import { UsageError } from './exit-codes';
import { checkGameTexts, type CheckedContent } from './game-check';

// Re-exported: these used to live here, and the editing verbs import them from here.
export { checkGameTexts, gameKinds, type CheckedContent } from './game-check';

/**
 * The game loader: a game's folder, by path, read at run time. It reads `<game>/game.json` and the
 * content files with the file system and checks them with the engine's kinds plus the kit's
 * (`kits.ts`). It never imports a game's code: nothing in `engine/` imports from `games/`, and
 * loading content starts nothing.
 */

export interface LoadedGame {
  /** The folder as given, relative to the working folder, with `/` (`games/demo`). */
  dir: string;
  /** Every file read, relative to the game folder (`game.json`, `content/rooms/hall.json`). */
  files: string[];
  /** Every file's text by the same paths (what `checkGameTexts` read). */
  texts: Readonly<Record<string, string>>;
  /** The checked content, or every error (each naming a repo path and a field). */
  content: CheckedContent;
}

/** Loads the game in folder `gameDir` (relative to `cwd`). A folder that is not there is a usage error. */
export function loadGame(cwd: string, gameDir: string): LoadedGame {
  const abs = resolve(cwd, gameDir);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new UsageError(`no game folder at ${gameDir}`);
  const dir = relative(cwd, abs).replaceAll('\\', '/') || '.';
  const root = dir === '.' ? '' : `${dir}/`;
  const texts = readGameFiles(abs);
  return { dir, files: Object.keys(texts), texts, content: checkGameTexts(texts, root) };
}
