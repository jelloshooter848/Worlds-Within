// @ts-check
/**
 * The layer table: the one place that says which folder may import which.
 *
 * Both the dependency test (tests/architecture/dependency-rule.test.ts) and ESLint read this file,
 * so change the arrows here and nowhere else. See docs/DESIGN.md, "The dependency rule".
 *
 * Plain JS with JSDoc types, so eslint.config.js (plain Node) and the TypeScript tests can both
 * import it.
 */

/**
 * @typedef {'games' | 'kits' | 'engine/sim' | 'engine/backends' | 'engine/core' | 'engine/tools'} LayerName
 */

/**
 * @typedef {object} Layer
 * @property {LayerName} name
 * @property {string} dir Folder from the repo root, with forward slashes and no trailing slash.
 * @property {readonly LayerName[]} allowed Layers a file in this layer may import (its own included).
 * @property {boolean} isolated When true, each subfolder is its own unit (one game, one kit, one
 *   backend) and may not import a sibling unit, even though they share a layer.
 * @property {readonly string[]} [groups] Subfolders that group units rather than being one, such as
 *   `games/samples/`: there the unit is the folder one level further down.
 */

/** @type {readonly Layer[]} */
export const LAYERS = [
  {
    name: 'games',
    dir: 'games',
    allowed: ['games', 'kits', 'engine/sim', 'engine/backends', 'engine/core'],
    isolated: true,
    groups: ['samples'],
  },
  { name: 'kits', dir: 'kits', allowed: ['kits', 'engine/core'], isolated: true },
  { name: 'engine/sim', dir: 'engine/sim', allowed: ['engine/sim', 'engine/core'], isolated: false },
  {
    name: 'engine/backends',
    dir: 'engine/backends',
    allowed: ['engine/backends', 'engine/core'],
    isolated: true,
  },
  { name: 'engine/core', dir: 'engine/core', allowed: ['engine/core'], isolated: false },
  {
    name: 'engine/tools',
    // Tools load a game by its folder path at run time, never by a static import.
    dir: 'engine/tools',
    allowed: ['engine/tools', 'engine/sim', 'engine/backends', 'engine/core', 'kits'],
    isolated: false,
  },
];

/**
 * @typedef {object} TestException
 * @property {string} reason
 * @property {RegExp} from Matches the importing file's repo path.
 * @property {string} target Folder (repo path) the matching files may also import.
 */

/**
 * Extra arrows on top of {@link LAYERS}. Each one names who, what and why.
 * @type {readonly TestException[]}
 */
export const EXCEPTIONS = [
  {
    reason: 'tests may run headless through the null backend',
    from: /\.test\.ts$/,
    target: 'engine/backends/null',
  },
];

/**
 * Path aliases (tsconfig `paths`, Vite `resolve.alias`) mapped to repo folders. No alias points into
 * `games/`.
 * @type {Readonly<Record<string, string>>}
 */
export const ALIASES = {
  '@engine': 'engine',
  '@kits': 'kits',
};
