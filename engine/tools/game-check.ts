import { loadContent, type ContentBundle, type LoadOptions } from '@engine/core/content/bundle';
import { engineContentKinds } from '@engine/core/content/engine-kinds';
import type { ContentKinds } from '@engine/core/content/kinds';
import type { KitDef, KitManifest } from '@engine/core/kit';
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
function kitsOf(text: string | undefined): { kit?: unknown; uses?: unknown; kitOptions?: unknown } {
  if (text === undefined) return {};
  try {
    const data = JSON.parse(text) as unknown;
    if (typeof data !== 'object' || data === null) return {};
    const { kit, uses, kitOptions } = data as { kit?: unknown; uses?: unknown; kitOptions?: unknown };
    return { kit, uses, kitOptions };
  } catch {
    return {};
  }
}

/**
 * The content kinds a game reads: the engine's, plus those of its kit (`kit`) and of every kit in
 * `uses` (each kit's hook, `kits.ts`), by the manifest. Errors are at `game.json` (`root` goes in
 * front of the file name): `unknown_kit` at `kit` or `uses.<i>` for a name no kit has,
 * `duplicate_kit` at `uses.<i>` for a kit already listed, and `kind_clash` at `uses.<i>` when that kit
 * adds a kind another listed kit (or the engine) already has, naming both, and (Engine 0.15, gap
 * G17) `unknown_option` / `bad_option` under `kitOptions` (`kitOptionErrors`); each kit's kinds are
 * made with the manifest's `kitOptions` (`KitDef.kinds(manifest)`). The manifest's shape is
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
  const { kit, uses, kitOptions } = kitsOf(manifestText);
  const options = isRecord(kitOptions) ? kitOptions : {};
  const manifest: KitManifest = { kitOptions: options as KitManifest['kitOptions'] };
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
    for (const kind of hook.kinds(manifest)) {
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
  errors.push(...kitOptionErrors(options, listed, file, find));
  return { kinds, errors };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The problems with a manifest's `kitOptions` (Engine 0.15, gap G17), at `game.json`:
 * `unknown_option` at `kitOptions.<kit>` for a kit the game does not use or one with no options,
 * and at `kitOptions.<kit>.<field>` for a field the kit's `options` schema does not have;
 * `bad_option` at the field for a value its schema refuses. The shape (an object of objects) is
 * `gameManifestSchema`'s.
 */
function kitOptionErrors(
  options: Record<string, unknown>,
  listed: readonly { name: string }[],
  file: string,
  find: (name: string) => KitDef | undefined,
): ContentError[] {
  const errors: ContentError[] = [];
  const names = listed.map((l) => l.name);
  for (const [name, value] of Object.entries(options)) {
    const at = ['kitOptions', name];
    const hook = names.includes(name) ? find(name) : undefined;
    if (!hook) {
      const why = names.includes(name)
        ? `no kit "${name}"`
        : `the game uses no kit "${name}" (its kits: ${names.join(', ')})`;
      errors.push(contentError(file, at, 'unknown_option', `options for kit "${name}": ${why}`));
      continue;
    }
    if (!hook.options) {
      errors.push(contentError(file, at, 'unknown_option', `kit "${name}" takes no options in game.json`));
      continue;
    }
    if (!isRecord(value)) continue;
    const parsed = hook.options.safeParse(value);
    if (parsed.success) continue;
    for (const issue of parsed.error.issues) {
      if (issue.code === 'unrecognized_keys') {
        for (const key of issue.keys)
          errors.push(
            contentError(
              file,
              [...at, ...issue.path, key],
              'unknown_option',
              `kit "${name}" has no option "${key}"`,
            ),
          );
      } else
        errors.push(
          contentError(
            file,
            [...at, ...issue.path] as (string | number)[],
            'bad_option',
            `kit "${name}": ${issue.message}`,
          ),
        );
    }
  }
  return errors;
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
