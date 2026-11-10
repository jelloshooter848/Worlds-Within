import type { z } from 'zod';
import {
  ANY_KIND,
  inPart,
  partFileName,
  parseContent,
  type ContentKind,
  type ContentKinds,
  type ContentPart,
} from './kinds';
import { gameManifestSchema, MANIFEST_FILE, type GameManifest } from './manifest';
import type { FontFile } from '../ui/font';
import type { SpriteSheet } from '../gfx/spritesheet';
import type { Rasterized } from '../gfx/pixelart';
import { checkGameAssets } from './assets';
import { isAssetPath } from './png';
import { checkMenus, type MenusRefs, type MenusSpec } from '../ui/menus';
import { contentError, validate, type ContentError, type ContentResult } from './validate';

/**
 * The content loader: a game's files, as `{ path: text }` pairs, into one checked, typed bundle.
 * Pure: the browser gets the pairs from the build's `virtual:game-files` module and Node
 * from the file system (`engine/core/node/game-files.ts`); this file only reads the strings.
 *
 * Paths are relative to the game folder (`game.json`, `content/rooms/hall.json`); a leading `./`
 * is dropped. Errors name `root + path`, so with `root: 'games/samples/dungeon/'` they carry repo paths.
 */

/** One checked content file. `name` is the file name without its folder and extension. */
export interface ContentEntry<T = unknown> {
  kind: string;
  name: string;
  /** The path relative to the game folder. */
  file: string;
  value: T;
}

export interface ContentBundle {
  manifest: GameManifest;
  /** Every content file, by kind in the manifest's order and then by path. */
  entries: readonly ContentEntry[];
  /**
   * The game's `assets/` files (Engine 0.16 T10) by path relative to the game folder
   * (`assets/fx-lab-png/torch.png`): text files as text, binary ones as base64 `data:` URLs
   * (`content/png.ts`). Left out when the game has none.
   */
  assets?: Readonly<Record<string, string>>;
  /**
   * The skins' PNG sheets once decoded (`withContentImages` in `engine/core/assets/`, browser
   * only), by image id; `contentSheets` and `contentPixelSheets` read them. Left out until then.
   */
  images?: ReadonlyMap<string, LoadedImageSheet>;
}

/** A skin's PNG sheet decoded in the browser: the sheet to draw and its RGBA pixels (3D HUD). */
export interface LoadedImageSheet {
  sheet: SpriteSheet;
  /** The whole image's pixels, or null where they could not be read. */
  pixels: Rasterized | null;
}

export interface LoadOptions {
  /** Put in front of every path in errors, such as `games/samples/dungeon/`. */
  root?: string;
  /**
   * Run each kind's `checkAll` across its files (default true). The editing verbs turn it off to
   * tell one file's errors from cross-file ones, which an edit to one file may leave for a moment.
   */
  checkAll?: boolean;
}

/** The entries of one kind, typed by that kind's schema. */
export function contentOf<S extends z.ZodType>(
  bundle: ContentBundle,
  kind: ContentKind<S>,
): ContentEntry<z.output<S>>[] {
  return bundle.entries.filter((e) => e.kind === kind.name) as ContentEntry<z.output<S>>[];
}

/** The one entry of `kind` called `name`, or undefined. */
export function contentNamed<S extends z.ZodType>(
  bundle: ContentBundle,
  kind: ContentKind<S>,
  name: string,
): ContentEntry<z.output<S>> | undefined {
  return contentOf(bundle, kind).find((e) => e.name === name);
}

/** `content/rooms/hall.map.txt` -> `hall`: the last path part up to its first dot. */
export function entryName(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.indexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/** A glob as a regular expression: `*` and `?` stay inside one folder, `**` crosses folders. */
export function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === '*' && glob[i + 1] === '*') {
      // `**/` is zero or more folders; a trailing `**` is anything.
      if (glob[i + 2] === '/') {
        out += '(?:[^/]+/)*';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (ch === '*') out += '[^/]*';
    else if (ch === '?') out += '[^/]';
    else out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

function normalize(path: string): string {
  return path.replace(/^\.\//, '');
}

/**
 * Builds the bundle from a game's files. Every problem comes back as a {@link ContentError}: a
 * missing or broken `game.json`, a kind the registry does not know (`unknown_kind`), a pattern that
 * matches nothing (`no_match`), a file two kinds claim (`claimed_twice`) or none does
 * (`unclaimed_file`), two files of one kind with the same name (`duplicate_name`), an `id` that is
 * not the file name (`id_mismatch`), every schema error in every file and, when there is no other
 * error, every problem a kind's `checkAll` finds across its files (code as the kind gives it;
 * skipped with `checkAll: false`).
 */
export function loadContent(
  files: Readonly<Record<string, string>>,
  kinds: ContentKinds,
  opts: LoadOptions = {},
): ContentResult<ContentBundle> {
  const root = opts.root ?? '';
  const texts = new Map<string, string>();
  for (const [path, text] of Object.entries(files)) texts.set(normalize(path), text);
  const at = (path: string) => root + path;

  const manifestText = texts.get(MANIFEST_FILE);
  if (manifestText === undefined) {
    const msg = `no ${MANIFEST_FILE}: every game folder needs one`;
    return { ok: false, errors: [contentError(at(MANIFEST_FILE), [], 'missing_file', msg)] };
  }
  let manifestData: unknown;
  try {
    manifestData = JSON.parse(manifestText);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      errors: [contentError(at(MANIFEST_FILE), [], 'invalid_json', `not valid JSON: ${why}`)],
    };
  }
  const read = validate(at(MANIFEST_FILE), manifestData, gameManifestSchema);
  if (!read.ok) return read;
  const manifest = read.value;

  const errors: ContentError[] = [];
  // `assets/` holds binary packs and their credits, not content: no kind claims them.
  const assets: Record<string, string> = {};
  for (const [path, text] of texts) if (isAssetPath(path)) assets[path] = text;
  const paths = [...texts.keys()].filter((p) => p !== MANIFEST_FILE && !isAssetPath(p)).sort();
  /** path -> the kind that claimed it. */
  const claimed = new Map<string, string>();
  /** Part files (such as `.map.txt`) belonging to a claimed file. */
  const partOf = new Set<string>();
  const entries: ContentEntry[] = [];
  /** The grid parts read with each claimed file, by path. */
  const partsByPath = new Map<string, Readonly<Record<string, ContentPart>>>();

  for (const [kindName, patterns] of Object.entries(manifest.content)) {
    const kind = kinds.get(kindName);
    if (!kind) {
      const known = kinds
        .list()
        .map((k) => k.name)
        .join(', ');
      const msg = `unknown content kind "${kindName}" (known: ${known || 'none'})`;
      errors.push(contentError(at(MANIFEST_FILE), ['content', kindName], 'unknown_kind', msg));
      continue;
    }
    const mine: string[] = [];
    patterns.forEach((pattern, i) => {
      const re = globToRegExp(pattern);
      const hits = paths.filter((p) => re.test(p));
      if (hits.length === 0) {
        const msg = `"${pattern}" matches no file`;
        errors.push(contentError(at(MANIFEST_FILE), ['content', kindName, i], 'no_match', msg));
      }
      for (const p of hits) {
        const had = claimed.get(p);
        if (had === kindName) continue;
        if (had !== undefined) {
          const msg = `claimed by both "${had}" and "${kindName}" in ${MANIFEST_FILE}`;
          errors.push(contentError(at(p), [], 'claimed_twice', msg));
          continue;
        }
        claimed.set(p, kindName);
        mine.push(p);
      }
    });
    const names = new Map<string, string>();
    for (const path of mine.sort()) {
      const parts: Record<string, ContentPart> = {};
      for (const [field, suffix] of Object.entries(kind.gridParts ?? {})) {
        if (!/\.json$/i.test(path)) continue;
        const partPath = partFileName(path, suffix);
        const text = texts.get(partPath);
        if (text === undefined) continue;
        partOf.add(partPath);
        parts[field] = { file: at(partPath), text };
      }
      partsByPath.set(path, parts);
      const result = parseContent(kind, at(path), texts.get(path)!, parts);
      if (!result.ok) {
        errors.push(...result.errors);
        continue;
      }
      const name = entryName(path);
      const other = names.get(name);
      if (other !== undefined) {
        const msg = `a second ${kindName} called "${name}" (the first is ${at(other)})`;
        errors.push(contentError(at(path), [], 'duplicate_name', msg));
        continue;
      }
      names.set(name, path);
      const value = result.value as unknown;
      const id = typeof value === 'object' && value !== null ? (value as { id?: unknown }).id : undefined;
      if (typeof id === 'string' && id !== name) {
        const msg = `id "${id}" must match the file name "${name}"`;
        errors.push(contentError(at(path), ['id'], 'id_mismatch', msg));
        continue;
      }
      entries.push({ kind: kindName, name, file: path, value });
    }
  }

  for (const path of paths) {
    if (claimed.has(path) || partOf.has(path)) continue;
    const msg = `no content kind in ${MANIFEST_FILE} claims this file`;
    errors.push(contentError(at(path), [], 'unclaimed_file', msg));
  }
  // A part file another kind also claimed is read twice; say so rather than guess which is meant.
  for (const path of partOf) {
    if (claimed.has(path)) {
      const msg = `read as part of another file and also claimed by "${claimed.get(path)}"`;
      errors.push(contentError(at(path), [], 'claimed_twice', msg));
    }
  }
  if (errors.length === 0 && opts.checkAll !== false) {
    errors.push(...checkAcross(manifest, kinds, entries, partsByPath, at));
    if (manifest.menus !== undefined) errors.push(...checkManifestMenus(manifest.menus, entries, at));
    errors.push(...checkGameAssets(assets, entries, at));
  }
  if (errors.length > 0) return { ok: false, errors };
  const hasAssets = Object.keys(assets).length > 0;
  return { ok: true, value: { manifest, entries, ...(hasAssets && { assets }) }, errors: [] };
}

/**
 * The manifest's `menus` (Engine 0.16 T9) against the game's fonts, sprites, palettes, songs and
 * sounds (`checkMenus`), as errors at `game.json` under `menus`.
 */
function checkManifestMenus(
  menus: MenusSpec,
  entries: readonly ContentEntry[],
  at: (path: string) => string,
): ContentError[] {
  const of = (kind: string) => entries.filter((e) => e.kind === kind);
  const music = of('skin').flatMap((e) => Object.keys((e.value as { music?: object }).music ?? {}));
  const refs: MenusRefs = {
    fonts: new Map(of('font').map((e) => [e.name, e.value as FontFile])),
    sprites: new Map(of('sprite').map((e) => [e.name, e.value as { frames?: Record<string, unknown> }])),
    palettes: new Set(of('palette').map((e) => e.name)),
    sounds: new Set([...of('song'), ...of('sfx')].map((e) => e.name).concat(music)),
  };
  return checkMenus(menus, refs).map((issue) =>
    contentError(at(MANIFEST_FILE), ['menus', ...issue.path], issue.code, issue.message),
  );
}

/** Every kind's `checkAll` over its entries, as errors at the entry's file (or grid part) and field. */
function checkAcross(
  manifest: GameManifest,
  kinds: ContentKinds,
  entries: readonly ContentEntry[],
  partsByPath: ReadonlyMap<string, Readonly<Record<string, ContentPart>>>,
  at: (path: string) => string,
): ContentError[] {
  const errors: ContentError[] = [];
  const others = (kind: string) => (kind === ANY_KIND ? entries : entries.filter((e) => e.kind === kind));
  for (const kindName of Object.keys(manifest.content)) {
    const kind = kinds.get(kindName);
    if (!kind?.checkAll) continue;
    const mine = entries.filter((e) => e.kind === kindName);
    if (mine.length === 0) continue;
    for (const issue of kind.checkAll(mine, others)) {
      const entry = mine.find((e) => e.name === issue.name) ?? mine[0]!;
      const extra: Pick<ContentError, 'row' | 'col'> = {};
      if (issue.row !== undefined) extra.row = issue.row;
      if (issue.col !== undefined) extra.col = issue.col;
      const error = contentError(at(entry.file), issue.path, issue.code, issue.message, extra);
      errors.push(inPart(error, partsByPath.get(entry.file) ?? {}));
    }
  }
  return errors;
}
