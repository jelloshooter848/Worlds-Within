import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import layersPlugin from './config/eslint-plugin-layers.js';
import { LAYERS } from './config/layers.js';

// The dependency rule: one block per layer in config/layers.js, each running the shared checker
// (config/deps.js), so ESLint and tests/architecture/dependency-rule.test.ts read one table. Test
// files get their extra arrows (such as engine/backends/null) from EXCEPTIONS in the same table.
const layerBlocks = LAYERS.map((layer) => ({
  name: `layers/${layer.name}`,
  files: [`${layer.dir}/**/*.{ts,tsx,js,mjs}`],
  plugins: { layers: layersPlugin },
  rules: { 'layers/dependency-rule': 'error' },
}));

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '.claude/**'],
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
);
