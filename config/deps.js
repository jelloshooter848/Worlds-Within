// @ts-check
/**
 * The dependency checker: pure functions over the layer table in ./layers.js. No file system, so the
 * same code backs the repo-wide test and can back a lint rule.
 *
 * All paths are repo paths: relative to the repo root, with forward slashes (`kits/topdown/hero.ts`).
 */
import { posix } from 'node:path';
import { ALIASES, EXCEPTIONS, LAYERS } from './layers.js';

/** @typedef {import('./layers.js').Layer} Layer */

/**
 * Where a repo path sits: its layer and, for isolated layers, its unit (`games/demo`,
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
 * `node:fs`). Relative and `/`-rooted specifiers and the aliases in ALIASES resolve inside the
 * repo; a query such as `?raw` is dropped. The result may start with `..` if it leaves the repo.
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
  return { ok: true };
}

/**
 * {@link resolveSpecifier} then {@link checkImport}.
 * @param {string} fromFile
 * @param {string} specifier
 * @returns {CheckResult}
 */
export function checkSpecifier(fromFile, specifier) {
  return checkImport(fromFile, resolveSpecifier(fromFile, specifier));
}
