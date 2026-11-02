import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import ts from 'typescript';
import { isPure, resolveSpecifier } from '../../config/deps.js';
import { PURE_CORE, PURE_DIRS } from '../../config/layers.js';

// The purity rule (docs/ROADMAP.md, 0.2): engine/sim, kits/ and the core files they use may not use
// Math.random, Date.now, performance.now or the DOM. ESLint enforces it from the lists in
// config/layers.js; this file checks that ESLint really does, and that the PURE_CORE list covers
// every core file kits and the sim reach at run time, so it can never fall behind.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SOURCE = /\.(ts|tsx|js|mjs)$/;
const TEST = /\.test\.(ts|tsx|js|mjs)$/;
const eslint = new ESLint({ cwd: ROOT });

/** Every source file under `dir`, as repo paths; empty when the folder does not exist. */
function sourceFiles(dir: string): string[] {
  if (!existsSync(join(ROOT, dir))) return [];
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (SOURCE.test(entry.name)) out.push(path);
  }
  return out;
}

/**
 * The specifiers a file loads at run time: value imports, export-from and literal `import()`.
 * `import type` and imports whose every binding is `type` are erased by the compiler, so skipped.
 */
function runtimeSpecifiers(text: string): string[] {
  const source = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const typeOnly =
        clause !== undefined &&
        (clause.isTypeOnly ||
          (clause.name === undefined &&
            clause.namedBindings !== undefined &&
            ts.isNamedImports(clause.namedBindings) &&
            clause.namedBindings.elements.length > 0 &&
            clause.namedBindings.elements.every((e) => e.isTypeOnly)));
      if (!typeOnly) out.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      if (!node.isTypeOnly) out.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      out.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** The source file a resolved repo path names, trying the extensions and index files bundlers try. */
function fileFor(path: string): string | null {
  const candidates = [
    path,
    ...['.ts', '.tsx', '.js', '.mjs'].flatMap((ext) => [path + ext, `${path}/index${ext}`]),
  ];
  return candidates.find((c) => SOURCE.test(c) && existsSync(join(ROOT, c))) ?? null;
}

/** Every engine/core file reached at run time from `starts`, following core's own imports too. */
function coreClosure(starts: string[]): Map<string, string> {
  const reached = new Map<string, string>(); // core file -> the file that first imported it
  const queue = [...starts];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const file = queue.shift() as string;
    for (const spec of runtimeSpecifiers(readFileSync(join(ROOT, file), 'utf8'))) {
      const target = resolveSpecifier(file, spec);
      const resolved = target === null ? null : fileFor(target);
      if (resolved === null || seen.has(resolved)) continue;
      seen.add(resolved);
      if (resolved.startsWith('engine/core/')) reached.set(resolved, file);
      queue.push(resolved);
    }
  }
  return reached;
}

/** The purity messages ESLint reports for `code` linted as if it were at `filePath`. */
async function purityErrors(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? [])
    .filter(
      (m) =>
        (m.ruleId === 'no-restricted-properties' || m.ruleId === 'no-restricted-globals') && m.severity === 2,
    )
    .map((m) => m.message);
}

describe('purity rule: the pure-core list', () => {
  const starts = PURE_DIRS.flatMap(sourceFiles).filter((f) => !TEST.test(f));

  it('finds the kit sources', () => {
    expect(starts.some((f) => f.startsWith('kits/topdown/'))).toBe(true);
  });

  it('covers every core file kits and the sim reach at run time', () => {
    const reached = coreClosure(starts);
    // The kit uses the seeded RNG at run time; if this ever fails the closure walk is broken.
    expect([...reached.keys()]).toContain('engine/core/rng.ts');
    const missing = [...reached]
      .filter(([file]) => !isPure(file))
      .map(([file, by]) => `${file} (imported by ${by})`);
    expect(missing).toEqual([]);
  });

  it('covers every core file the pure core itself reaches at run time', () => {
    const pureCore = sourceFiles('engine/core').filter((f) => isPure(f) && !TEST.test(f));
    // The content core and the schemas next to the MML compiler and pixel art are pure (Engine 0.3).
    expect(pureCore).toEqual(
      expect.arrayContaining([
        'engine/core/content/validate.ts',
        'engine/core/content/text-grid.ts',
        'engine/core/content/kinds.ts',
        'engine/core/content/engine-kinds.ts',
        'engine/core/audio/song-schema.ts',
        'engine/core/gfx/sprite-schema.ts',
      ]),
    );
    const missing = [...coreClosure(pureCore)]
      .filter(([file]) => !isPure(file))
      .map(([file, by]) => `${file} (imported by ${by})`);
    expect(missing).toEqual([]);
  });

  it('names only files and folders that exist', () => {
    for (const entry of PURE_CORE) {
      const path = entry.endsWith('/**') ? entry.slice(0, -3) : entry;
      expect(existsSync(join(ROOT, path)), entry).toBe(true);
      expect(path.startsWith('engine/core/'), entry).toBe(true);
    }
  });

  it('matches files and folders the way ESLint globs do', () => {
    expect(isPure('engine/core/rng.ts')).toBe(true);
    expect(isPure('engine/core/math/aabb.ts')).toBe(true);
    expect(isPure('kits/topdown/hero.ts')).toBe(true);
    expect(isPure('engine/sim/world.ts')).toBe(true);
    expect(isPure('engine/core/rng.test.ts')).toBe(false);
    expect(isPure('engine/core/save/storage.ts')).toBe(false);
    expect(isPure('engine/core/mathx/a.ts')).toBe(false);
  });
});

describe('purity rule: the import scanner', () => {
  it('skips type-only imports and keeps value ones', () => {
    const text = [
      "import type { A } from './a';",
      "import { type B } from './b';",
      "import { type C, d } from './c';",
      "import e from './e';",
      "import './side-effect';",
      "export * from './f';",
      "export type { G } from './g';",
      "const h = () => import('./h');",
    ].join('\n');
    expect(runtimeSpecifiers(text)).toEqual(['./c', './e', './side-effect', './f', './h']);
  });
});

describe('purity rule: ESLint', () => {
  it('rejects Math.random() in a kit', async () => {
    const errors = await purityErrors('kits/topdown/bad.ts', 'export const roll = () => Math.random();\n');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('engine/core/rng');
  });

  it.each([
    ['kits/topdown/bad.ts', 'export const t = () => Date.now();\n', 'Date.now'],
    ['kits/topdown/bad.ts', 'export const t = () => performance.now();\n', 'performance.now'],
    ['kits/topdown/bad.ts', "export const el = () => document.createElement('div');\n", 'document'],
    ['engine/sim/bad.ts', 'export const t = () => Date.now();\n', 'Date.now'],
    ['engine/sim/bad.ts', 'export const t = () => performance.now();\n', 'performance.now'],
    ['engine/sim/bad.ts', 'export const w = () => window.innerWidth;\n', 'window'],
    ['engine/sim/bad.ts', "export const s = () => localStorage.getItem('x');\n", 'localStorage'],
    [
      'engine/sim/bad.ts',
      'export const f = (cb: () => void) => requestAnimationFrame(cb);\n',
      'requestAnimationFrame',
    ],
    ['engine/core/rng.ts', 'export const roll = () => Math.random();\n', 'Math.random (pure core file)'],
    ['engine/core/math/bad.ts', 'export const t = () => Date.now();\n', 'Date.now (pure core folder)'],
  ])('rejects %s using %s (%s)', async (file, code) => {
    expect((await purityErrors(file, code)).length).toBeGreaterThan(0);
  });

  it('allows the seeded RNG and leaves impure core and games alone', async () => {
    const seeded = "import { Rng } from '@engine/core/rng';\nexport const roll = (r: Rng) => r.next();\n";
    expect(await purityErrors('kits/topdown/good.ts', seeded)).toEqual([]);
    const clock = 'export const t = () => performance.now();\n';
    expect(await purityErrors('engine/core/loop.ts', clock)).toEqual([]);
    expect(await purityErrors('games/demo/good.ts', clock)).toEqual([]);
  });

  it('does not mistake a local named like a global for the global', async () => {
    const code = 'export const within = (window: number, t: number) => t < window;\n';
    expect(await purityErrors('kits/topdown/good.ts', code)).toEqual([]);
  });
});
