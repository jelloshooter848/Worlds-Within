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
 * @typedef {object} ForbiddenCore
 * @property {LayerName} layer The layer whose files may not import these (tests included).
 * @property {string} reason
 * @property {readonly string[]} targets Core modules, each one file or a folder written `dir/**`.
 */

/**
 * Core modules a layer may not import even though it may import `engine/core`: the drawing and
 * output side of the core. Kits never draw (docs/DESIGN.md): they describe a frame
 * (`engine/core/present`) and a backend draws it through a skin. ESLint and
 * tests/architecture/dependency-rule.test.ts both read this list through config/deps.js.
 * @type {readonly ForbiddenCore[]}
 */
export const FORBIDDEN_CORE = [
  {
    layer: 'kits',
    reason:
      'kits never draw or play sound: they present a frame (engine/core/present) and a backend draws it',
    targets: [
      'engine/core/gfx/renderer.ts',
      'engine/core/gfx/spritesheet.ts',
      'engine/core/gfx/pixelart.ts',
      'engine/core/gfx/animation.ts',
      'engine/core/assets/**',
      'engine/core/audio/apu.ts',
      'engine/core/audio/audio-manager.ts',
      'engine/core/audio/sequencer.ts',
      'engine/core/view.ts',
      'engine/core/scene.ts',
      'engine/core/loop.ts',
    ],
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

/**
 * The purity rule (docs/ROADMAP.md, 0.2): files that must run the same on every machine, so no
 * `Math.random`, `Date.now`, `performance.now` or DOM. ESLint enforces it (eslint.config.js) on
 * every file in {@link PURE_DIRS} and on the core files in {@link PURE_CORE}.
 * @type {readonly string[]}
 */
export const PURE_DIRS = ['engine/sim', 'kits'];

/**
 * The pure part of `engine/core`: each entry is one file, or a folder written `dir/**`. It must hold
 * every core file that kits and the sim reach at run time (tests/architecture/purity.test.ts checks
 * the import closure), plus other core modules that are already clean and should stay so.
 * @type {readonly string[]}
 */
export const PURE_CORE = [
  'engine/core/rng.ts',
  'engine/core/headless.ts',
  'engine/core/rules.ts',
  'engine/core/math/**',
  'engine/core/scene.ts',
  'engine/core/input/actions.ts',
  'engine/core/input/bindings.ts',
  'engine/core/input/input-manager.ts',
  'engine/core/input/scripted-input.ts',
  'engine/core/gfx/renderer.ts',
  'engine/core/gfx/palette.ts',
  'engine/core/gfx/animation.ts',
  'engine/core/gfx/screen.ts',
  'engine/core/gfx/spritesheet.ts',
  'engine/core/audio/mml.ts',
  'engine/core/audio/song-schema.ts',
  'engine/core/gfx/sprite-schema.ts',
  'engine/core/gfx/palette-schema.ts',
  'engine/core/content/**',
  'engine/core/present/**',
  'engine/core/assets/sheet-lookup.ts',
];
