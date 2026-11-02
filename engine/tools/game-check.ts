import { loadContent, type ContentBundle, type LoadOptions } from '@engine/core/content/bundle';
import { engineContentKinds } from '@engine/core/content/engine-kinds';
import type { ContentKinds } from '@engine/core/content/kinds';
import type { KitDef } from '@engine/core/kit';
import { MANIFEST_FILE } from '@engine/core/content/manifest';
import { contentError, dottedPath, type ContentError } from '@engine/core/content/validate';
import { findKit, unknownKitMessage } from './kits';

/**
 * Checking a game's files once they are text: the engine's content kinds plus its kits' (`kit` and
 * `uses`). No file system and no Node imports, so the screenshot page (`screenshot/page.ts`) checks
 * the same way in the browser that `loadGame` (`game-loader.ts`) does in Node.
 */

/** A game's checked content, or every error (each naming a repo path and a field). */
export type CheckedContent = { ok: true; value: ContentBundle } | { ok: false; errors: ContentError[] };

/** The manifest's `kit` and `uses`, if `game.json` parses far enough to have them. */
function kitsOf(text: string | undefined): { kit?: unknown; uses?: unknown } {
  if (text === undefined) return {};
  try {
    const data = JSON.parse(text) as unknown;
    if (typeof data !== 'object' || data === null) return {};
    const { kit, uses } = data as { kit?: unknown; uses?: unknown };
    return { kit, uses };
  } catch {
    return {};
  }
}

/**
 * The content kinds a game reads: the engine's, plus those of its kit (`kit`) and of every kit in
 * `uses` (each kit's hook, `kits.ts`), by the manifest. Errors are at `game.json` (`root` goes in
 * front of the file name): `unknown_kit` at `kit` or `uses.<i>` for a name no kit has,
 * `duplicate_kit` at `uses.<i>` for a kit already listed, and `kind_clash` at `uses.<i>` when that kit
 * adds a kind another listed kit (or the engine) already has, naming both. The manifest's shape is
 * checked elsewhere (`gameManifestSchema`): entries that are not strings are skipped here. `find`
 * looks a kit up by name (`findKit`; tests pass their own).
 */
export function gameKinds(
  manifestText: string | undefined,
  root = '',
  find: (name: string) => KitDef | undefined = findKit,
): {
  kinds: ContentKinds;
  errors: ContentError[];
} {
  const kinds = engineContentKinds();
  const errors: ContentError[] = [];
  const file = `${root}${MANIFEST_FILE}`;
  const { kit, uses } = kitsOf(manifestText);
  const listed: { name: string; at: (string | number)[] }[] = [];
  if (typeof kit === 'string') listed.push({ name: kit, at: ['kit'] });
  if (Array.isArray(uses))
    uses.forEach((name, i) => {
      if (typeof name === 'string') listed.push({ name, at: ['uses', i] });
    });

  /** Which kit added each kind ("the engine" for the engine's own). */
  const owner = new Map<string, string>(kinds.list().map((k) => [k.name, 'the engine']));
  const seen = new Set<string>();
  for (const { name, at } of listed) {
    const field = dottedPath(at);
    if (seen.has(name)) {
      errors.push(contentError(file, at, 'duplicate_kit', `kit "${name}" in "${field}" is already listed`));
      continue;
    }
    seen.add(name);
    const hook = find(name);
    if (!hook) {
      errors.push(contentError(file, at, 'unknown_kit', unknownKitMessage(name, field)));
      continue;
    }
    for (const kind of hook.kinds()) {
      const had = owner.get(kind.name);
      if (had !== undefined) {
        const by = had === 'the engine' ? 'the engine' : `kit "${had}"`;
        errors.push(
          contentError(
            file,
            at,
            'kind_clash',
            `content kind "${kind.name}" of kit "${name}" in "${field}" clashes with ${by}, which already has a kind of that name`,
          ),
        );
        continue;
      }
      owner.set(kind.name, name);
      kinds.register(kind);
    }
  }
  return { kinds, errors };
}

/**
 * Checks a game's files (`{ path: text }`, as `readGameFiles` gives them); errors name `root + path`.
 * `opts.checkAll: false` leaves out the kinds' cross-file checks (see `loadContent`).
 */
export function checkGameTexts(
  texts: Readonly<Record<string, string>>,
  root = '',
  opts: Pick<LoadOptions, 'checkAll'> = {},
): CheckedContent {
  const { kinds, errors } = gameKinds(texts[MANIFEST_FILE], root);
  const result = loadContent(texts, kinds, { ...opts, root });
  if (!result.ok) errors.push(...result.errors);
  return errors.length === 0 && result.ok ? { ok: true, value: result.value } : { ok: false, errors };
}
