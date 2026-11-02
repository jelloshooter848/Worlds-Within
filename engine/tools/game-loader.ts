import { existsSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { loadContent, type ContentBundle } from '@engine/core/content/bundle';
import { engineContentKinds } from '@engine/core/content/engine-kinds';
import type { ContentKinds } from '@engine/core/content/kinds';
import { MANIFEST_FILE } from '@engine/core/content/manifest';
import { contentError, type ContentError } from '@engine/core/content/validate';
import { readGameFiles } from '@engine/core/node/game-files';
import { UsageError } from './exit-codes';
import { KIT_KINDS } from './kits';

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
  /** The checked content, or every error (each naming a repo path and a field). */
  content: { ok: true; value: ContentBundle } | { ok: false; errors: ContentError[] };
}

/** The manifest's `kit`, if `game.json` parses far enough to have one. */
function kitOf(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    const data = JSON.parse(text) as unknown;
    return typeof data === 'object' && data !== null ? (data as { kit?: unknown }).kit : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The content kinds a game reads: the engine's plus its kit's, by the manifest's `kit`. An unknown
 * kit is an `unknown_kit` error at `kit` in `game.json` (`root` goes in front of the file name).
 */
export function gameKinds(
  manifestText: string | undefined,
  root = '',
): {
  kinds: ContentKinds;
  errors: ContentError[];
} {
  const kinds = engineContentKinds();
  const errors: ContentError[] = [];
  const kit = kitOf(manifestText);
  if (typeof kit === 'string') {
    const kitKinds = KIT_KINDS[kit];
    if (kitKinds) for (const kind of kitKinds()) kinds.register(kind);
    else {
      const known = Object.keys(KIT_KINDS).join(', ');
      errors.push(
        contentError(
          `${root}${MANIFEST_FILE}`,
          ['kit'],
          'unknown_kit',
          `unknown kit "${kit}" (known: ${known})`,
        ),
      );
    }
  }
  return { kinds, errors };
}

/** Checks a game's files (`{ path: text }`, as `readGameFiles` gives them); errors name `root + path`. */
export function checkGameTexts(texts: Readonly<Record<string, string>>, root = ''): LoadedGame['content'] {
  const { kinds, errors } = gameKinds(texts[MANIFEST_FILE], root);
  const result = loadContent(texts, kinds, { root });
  if (!result.ok) errors.push(...result.errors);
  return errors.length === 0 && result.ok ? { ok: true, value: result.value } : { ok: false, errors };
}

/** Loads the game in folder `gameDir` (relative to `cwd`). A folder that is not there is a usage error. */
export function loadGame(cwd: string, gameDir: string): LoadedGame {
  const abs = resolve(cwd, gameDir);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new UsageError(`no game folder at ${gameDir}`);
  const dir = relative(cwd, abs).replaceAll('\\', '/') || '.';
  const root = dir === '.' ? '' : `${dir}/`;
  const texts = readGameFiles(abs);
  return { dir, files: Object.keys(texts), content: checkGameTexts(texts, root) };
}
