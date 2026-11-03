// @ts-check
/**
 * The dependency checker: pure functions over the layer table in ./layers.js. No file system, so the
 * same code backs the repo-wide test and can back a lint rule.
 *
 * All paths are repo paths: relative to the repo root, with forward slashes (`kits/topdown/hero.ts`).
 */
import { posix } from 'node:path';
import { ALIASES, EXCEPTIONS, FORBIDDEN_CORE, LAYERS, PACKAGES, PURE_CORE, PURE_DIRS } from './layers.js';

/**
 * Top-level repo folders. A bare specifier starting with one of these (`games/samples/dungeon/rooms`) is read as
 * a repo path, not a package: a resolver with a repo-rooted base would find it, so the checker must
 * judge it too.
 */
const REPO_FOLDERS = ['engine', 'kits', 'games', 'tests', 'build', 'config'];

/** @typedef {import('./layers.js').Layer} Layer */

/**
 * Where a repo path sits: its layer and, for isolated layers, its unit (`games/samples/dungeon`,
 * `games/samples/siege`, `kits/topdown`, `engine/backends/null`).
 * @typedef {object} Place
 * @property {Layer} layer
 * @property {string} unit
 */

/** @typedef {{ ok: true } | { ok: false, reason: string }} CheckResult */

/**
 * @param {string} path
 * @param {string} dir
 */
function isInside(path, dir) {
  return path === dir || path.startsWith(dir + '/');
}

/**
 * The layer and unit of a repo path, or null when it is outside every layer (tests/, build/, config/).
 * @param {string} path
 * @returns {Place | null}
 */
export function placeOf(path) {
  const layer = LAYERS.find((l) => isInside(path, l.dir));
  if (!layer) return null;
  if (!layer.isolated) return { layer, unit: layer.dir };
  const parts = path.slice(layer.dir.length + 1).split('/');
  const depth = layer.groups?.includes(parts[0] ?? '') ? 2 : 1;
  return { layer, unit: [layer.dir, ...parts.slice(0, depth)].join('/') };
}

/**
 * Turns an import specifier into a repo path, or null for an external package (`vitest`,
 * `node:fs`). Relative and `/`-rooted specifiers, the aliases in ALIASES and bare specifiers that
 * start with a top-level repo folder (`games/samples/dungeon/rooms`) resolve inside the repo; a query such as
 * `?raw` is dropped. The result may start with `..` if it leaves the repo.
 * @param {string} fromFile Repo path of the importing file.
 * @param {string} specifier
 * @returns {string | null}
 */
export function resolveSpecifier(fromFile, specifier) {
  const spec = specifier.replace(/[?#].*$/, '');
  if (spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../')) {
    return posix.normalize(posix.join(posix.dirname(fromFile), spec));
  }
  if (spec.startsWith('/')) return posix.normalize(spec.slice(1));
  for (const [alias, dir] of Object.entries(ALIASES)) {
    if (spec === alias) return dir;
    if (spec.startsWith(alias + '/')) return posix.normalize(dir + spec.slice(alias.length));
  }
  if (REPO_FOLDERS.includes(spec.split('/')[0] ?? '')) return posix.normalize(spec);
  return null;
}

/**
 * Checks one arrow: may `fromFile` import `target`?
 * @param {string} fromFile Repo path of the importing file.
 * @param {string | null} target Repo path from {@link resolveSpecifier}; null for an external package.
 * @returns {CheckResult}
 */
export function checkImport(fromFile, target) {
  if (target === null) return { ok: true };
  if (target === '..' || target.startsWith('../') || posix.isAbsolute(target)) {
    return { ok: false, reason: `${target} is outside the repo` };
  }
  const from = placeOf(fromFile);
  // Files outside every layer (tests/, build/, config/, root config) are tooling and may import anything.
  if (!from) return { ok: true };
  for (const ex of EXCEPTIONS) {
    if (ex.from.test(fromFile) && isInside(target, ex.target)) return { ok: true };
  }
  const to = placeOf(target);
  if (!to) {
    return { ok: false, reason: `${from.layer.name} may only import layered code; ${target} is in no layer` };
  }
  if (!from.layer.allowed.includes(to.layer.name)) {
    return {
      ok: false,
      reason: `${from.layer.name} may not import ${to.layer.name} (allowed: ${from.layer.allowed.join(', ')})`,
    };
  }
  if (from.layer === to.layer && from.unit !== to.unit) {
    return { ok: false, reason: `${from.unit} may not import its sibling ${to.unit}` };
  }
  for (const rule of FORBIDDEN_CORE) {
    if (rule.layer !== from.layer.name) continue;
    const hit = rule.targets.find((entry) => matchesEntry(target, entry));
    if (hit) return { ok: false, reason: `${from.layer.name} may not import ${hit}: ${rule.reason}` };
  }
  return { ok: true };
}

const SOURCE_EXT = /\.(ts|tsx|js|mjs)$/;

/**
 * Whether a repo path is a list entry: one file (with or without its extension, as specifiers
 * name it) or anything under a `dir/**` entry.
 * @param {string} path
 * @param {string} entry
 */
function matchesEntry(path, entry) {
  if (entry.endsWith('/**')) return isInside(path, entry.slice(0, -3));
  return path.replace(SOURCE_EXT, '') === entry.replace(SOURCE_EXT, '');
}

/**
 * The npm package a bare specifier names: `three` for `three` and `three/addons/x.js`,
 * `@scope/pkg` for `@scope/pkg/sub`; a `node:` builtin is its own name.
 * @param {string} specifier
 * @returns {string}
 */
export function packageName(specifier) {
  const parts = specifier.replace(/[?#].*$/, '').split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? '');
}

/**
 * Checks an external package import against {@link PACKAGES}: a listed package may be imported
 * only from inside one of its owners (or from unlayered tooling); an unlisted one from anywhere.
 * @param {string} fromFile Repo path of the importing file.
 * @param {string} specifier A bare specifier ({@link resolveSpecifier} gave null).
 * @returns {CheckResult}
 */
export function checkPackage(fromFile, specifier) {
  const name = packageName(specifier);
  const owned = PACKAGES.find((p) => p.name === name);
  if (!owned || !placeOf(fromFile)) return { ok: true };
  if (owned.owners.some((dir) => isInside(fromFile, dir))) return { ok: true };
  return {
    ok: false,
    reason: `${name} may only be imported from ${owned.owners.join(', ')}: ${owned.reason}`,
  };
}

/**
 * {@link resolveSpecifier} then {@link checkImport}, or {@link checkPackage} for an external package.
 * @param {string} fromFile
 * @param {string} specifier
 * @returns {CheckResult}
 */
export function checkSpecifier(fromFile, specifier) {
  const target = resolveSpecifier(fromFile, specifier);
  if (target === null) return checkPackage(fromFile, specifier);
  return checkImport(fromFile, target);
}

/**
 * Whether the purity rule covers a repo path: inside a folder in PURE_DIRS, or on the PURE_CORE list
 * (an exact file, or under a `dir/**` entry).
 * @param {string} path
 * @returns {boolean}
 */
export function isPure(path) {
  if (PURE_DIRS.some((dir) => isInside(path, dir))) return true;
  return PURE_CORE.some((entry) =>
    entry.endsWith('/**') ? isInside(path, entry.slice(0, -3)) : path === entry,
  );
}
