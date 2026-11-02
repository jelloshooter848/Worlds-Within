import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { checkSpecifier } from '../../config/deps.js';
import { LAYERS } from '../../config/layers.js';

// The dependency rule is enforced twice (docs/ROADMAP.md, 0.2): by ESLint per folder and by the
// repo-wide dependency test. Here deliberate bad imports must fail both, and good ones pass both.
// The files are virtual: lintText never touches the disk.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const eslint = new ESLint({ cwd: ROOT });

/** The dependency-rule messages ESLint reports for `code` linted as if it were at `filePath`. */
async function lintArrows(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId === 'layers/dependency-rule' && m.severity === 2)
    .map((m) => m.message);
}

/** An import that uses its binding, so no other lint rule has anything to say. */
function importOf(specifier: string): string {
  return `import { thing } from '${specifier}';\nexport const used = thing;\n`;
}

describe('dependency rule: ESLint and the checker agree', () => {
  const bad: [file: string, specifier: string, what: string][] = [
    ['kits/topdown/bad.ts', '../../games/demo/rooms', 'kit -> game (relative)'],
    ['kits/topdown/bad.ts', '@kits/../games/demo/rooms', 'kit -> game (via alias)'],
    ['engine/sim/bad.ts', '@engine/backends/null', 'sim -> backend (alias)'],
    ['engine/sim/bad.ts', '../backends/canvas2d', 'sim -> backend (relative)'],
    ['engine/core/bad.ts', '@kits/topdown', 'core -> kit'],
    ['kits/other/bad.ts', '@kits/topdown', 'kit -> sibling kit'],
    ['kits/topdown/bad.ts', 'games/demo/rooms', 'kit -> game (bare repo path)'],
    ['engine/sim/bad.ts', 'engine/backends/canvas2d', 'sim -> backend (bare repo path)'],
  ];

  it.each(bad)('%s importing %s fails both (%s)', async (file, specifier) => {
    expect(checkSpecifier(file, specifier).ok).toBe(false);
    const messages = await lintArrows(file, importOf(specifier));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('breaks the dependency rule');
  });

  it('sees export-from and dynamic import too', async () => {
    const code = [
      "export * from '../../games/demo/rooms';",
      "export { x } from '../../games/demo/scene';",
      "export const later = () => import('../../games/demo/main');",
    ].join('\n');
    expect(await lintArrows('kits/topdown/bad.ts', code)).toHaveLength(3);
  });

  const good: [file: string, specifier: string, what: string][] = [
    ['kits/topdown/good.ts', '@engine/core/rng', 'kit -> core'],
    ['games/demo/good.ts', '@kits/topdown', 'game -> kit'],
    ['engine/sim/good.ts', '../core/rng', 'sim -> core (relative)'],
    ['kits/topdown/good.test.ts', '@engine/backends/null', 'kit test -> null backend (test exception)'],
  ];

  it.each(good)('%s importing %s passes both (%s)', async (file, specifier) => {
    expect(checkSpecifier(file, specifier)).toEqual({ ok: true });
    expect(await lintArrows(file, importOf(specifier))).toEqual([]);
  });
});

describe('dependency rule: ESLint config', () => {
  it.each(LAYERS.map((l) => [l.dir]))('turns the rule on for every file in %s', async (dir) => {
    const config = (await eslint.calculateConfigForFile(`${dir}/any/file.ts`)) as {
      rules?: Record<string, unknown>;
    };
    expect(config.rules?.['layers/dependency-rule']).toEqual([2]);
  });
});
