import { loadContent, type ContentBundle } from '@engine/core/content/bundle';
import { engineContentKinds } from '@engine/core/content/engine-kinds';
import type { ContentKinds } from '@engine/core/content/kinds';
import { MANIFEST_FILE } from '@engine/core/content/manifest';
import { contentError, type ContentError } from '@engine/core/content/validate';
import { KIT_KINDS } from './kits';

/**
 * Checking a game's files once they are text: the engine's content kinds plus the kit's. No file
 * system and no Node imports, so the screenshot page (`screenshot/page.ts`) checks the same way in
 * the browser that `loadGame` (`game-loader.ts`) does in Node.
 */

/** A game's checked content, or every error (each naming a repo path and a field). */
export type CheckedContent = { ok: true; value: ContentBundle } | { ok: false; errors: ContentError[] };

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
export function checkGameTexts(texts: Readonly<Record<string, string>>, root = ''): CheckedContent {
  const { kinds, errors } = gameKinds(texts[MANIFEST_FILE], root);
  const result = loadContent(texts, kinds, { root });
  if (!result.ok) errors.push(...result.errors);
  return errors.length === 0 && result.ok ? { ok: true, value: result.value } : { ok: false, errors };
}
