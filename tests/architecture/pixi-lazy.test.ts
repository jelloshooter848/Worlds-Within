import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// PixiJS is loaded only when a page draws with it (Engine 0.16 T13b-4): no game file imports
// `@engine/backends/pixi` (or `pixi.js`) statically, so Vite puts PixiJS in its own chunk and a
// Canvas2D page never downloads it; each page that offers `?backend=pixi` reaches it with a
// literal `import('@engine/backends/pixi')`.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PIXI = new Set(['@engine/backends/pixi', 'pixi.js']);

/** The pages that offer `?backend=pixi` (the platformer sample gets it when its track merges). */
const PIXI_PAGES = [
  'games/samples/rts-skirmish',
  'games/samples/tower-defense',
  'games/samples/dungeon',
  'games/samples/mini-siege',
  'games/fx-lab',
  'games/platformer-lab',
  'games/platformer-classic',
  'games/rts-classic',
  'games/td-classic',
];

/** Every non-test TypeScript file under `dir`, as repo paths. */
function sourceFiles(dir: string): string[] {
  if (!existsSync(join(ROOT, dir))) return [];
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) out.push(path);
  }
  return out;
}

/** A file's value imports and export-froms (`static`) and literal `import()` calls (`dynamic`). */
function specifiers(path: string): { static: string[]; dynamic: string[] } {
  const text = readFileSync(join(ROOT, path), 'utf8');
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const out = { static: [] as string[], dynamic: [] as string[] };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.importClause?.isTypeOnly) out.static.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      if (!node.isTypeOnly) out.static.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      out.dynamic.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

describe('PixiJS loads lazily (Engine 0.16 T13b-4)', () => {
  it('no game file imports PixiJS statically', () => {
    const offenders = sourceFiles('games').filter((f) => specifiers(f).static.some((s) => PIXI.has(s)));
    expect(offenders).toEqual([]);
  });

  it('each page offering ?backend=pixi imports the PixiJS backend dynamically', () => {
    for (const page of PIXI_PAGES)
      expect(specifiers(`${page}/main.ts`).dynamic, page).toContain('@engine/backends/pixi');
  });
});
