import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import layersPlugin from './config/eslint-plugin-layers.js';
import { LAYERS, PURE_CORE, PURE_DIRS } from './config/layers.js';

// The dependency rule: one block per layer in config/layers.js, each running the shared checker
// (config/deps.js), so ESLint and tests/architecture/dependency-rule.test.ts read one table. Test
// files get their extra arrows (such as engine/backends/null) from EXCEPTIONS in the same table.
const layerBlocks = LAYERS.map((layer) => ({
  name: `layers/${layer.name}`,
  files: [`${layer.dir}/**/*.{ts,tsx,js,mjs}`],
  plugins: { layers: layersPlugin },
  rules: { 'layers/dependency-rule': 'error' },
}));

// The purity rule (docs/ROADMAP.md, 0.2): the sim, kits and the core files they use must run the
// same on every machine and in Node, so no wall clock, no unseeded randomness and no DOM. The file
// list lives next to the layer table in config/layers.js; tests/architecture/purity.test.ts checks
// that it covers every core file kits and the sim reach at run time.
const RNG_HINT = 'Randomness goes through the seeded Rng in engine/core/rng.ts.';
const CLOCK_HINT = 'Time comes from the fixed-step loop (frame counts), never the wall clock.';
const DOM_HINT = 'The sim, kits and pure core never touch the DOM; backends and games do.';
const DOM_GLOBALS = [
  'document',
  'window',
  'self',
  'globalThis',
  'navigator',
  'location',
  'history',
  'screen',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'matchMedia',
  'getComputedStyle',
  'alert',
  'confirm',
  'prompt',
  'fetch',
  'Image',
  'Audio',
  'AudioContext',
  'HTMLElement',
  'HTMLCanvasElement',
  'HTMLImageElement',
  'HTMLAudioElement',
  'Element',
  'Node',
  'Event',
  'KeyboardEvent',
  'PointerEvent',
  'TouchEvent',
  'MouseEvent',
  'Gamepad',
  'OffscreenCanvas',
  'CanvasRenderingContext2D',
  'ImageData',
  'MutationObserver',
  'ResizeObserver',
  'IntersectionObserver',
];
const purityBlock = {
  name: 'purity',
  files: [...PURE_DIRS.map((dir) => `${dir}/**/*.{ts,tsx,js,mjs}`), ...PURE_CORE],
  rules: {
    'no-restricted-properties': [
      'error',
      { object: 'Math', property: 'random', message: `Math.random is not seeded. ${RNG_HINT}` },
      { object: 'Date', property: 'now', message: `Date.now reads the wall clock. ${CLOCK_HINT}` },
      {
        object: 'performance',
        property: 'now',
        message: `performance.now reads the wall clock. ${CLOCK_HINT}`,
      },
    ],
    'no-restricted-globals': [
      'error',
      { name: 'performance', message: `performance reads the wall clock. ${CLOCK_HINT}` },
      ...DOM_GLOBALS.map((name) => ({ name, message: `${name} is browser-only. ${DOM_HINT}` })),
    ],
  },
};

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '.claude/**', '.ww-out/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
  ...layerBlocks,
  purityBlock,
);
