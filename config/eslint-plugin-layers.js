// @ts-check
/**
 * A local ESLint plugin whose one rule, `layers/dependency-rule`, reports every import arrow the
 * layer table forbids. It calls the same checker as the repo-wide dependency test
 * (./deps.js `checkSpecifier`), so ESLint and the test can never disagree.
 */
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSpecifier } from './deps.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The repo path (forward slashes, from the repo root) of a file ESLint is linting.
 * @param {string} filename
 */
function repoPath(filename) {
  return relative(ROOT, filename).split(sep).join('/');
}

/** @type {import('eslint').Rule.RuleModule} */
const dependencyRule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce the layer table in config/layers.js (docs/DESIGN.md, "The dependency rule")',
    },
    schema: [],
    messages: { forbidden: "'{{specifier}}' breaks the dependency rule: {{reason}}" },
  },
  create(context) {
    const file = repoPath(context.filename);
    /**
     * The `source` of an import or export: a string literal, or any expression for `import(x)`.
     * @param {{ type: string, value?: unknown } | null | undefined} source
     */
    function check(source) {
      if (!source || source.type !== 'Literal' || typeof source.value !== 'string') return;
      const result = checkSpecifier(file, source.value);
      if (!result.ok) {
        context.report({
          node: /** @type {import('eslint').Rule.Node} */ (source),
          messageId: 'forbidden',
          data: { specifier: source.value, reason: result.reason },
        });
      }
    }
    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
    };
  },
};

export default {
  meta: { name: 'layers' },
  rules: { 'dependency-rule': dependencyRule },
};
