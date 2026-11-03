import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Text checks on the Pages workflow: it publishes only on full release tags and runs CI's checks first.
const read = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const pages = read('.github/workflows/pages.yml');
const ci = read('.github/workflows/ci.yml');
const viteConfig = read('vite.config.ts');

/** The tag filters listed under `on.push.tags`. */
function tagFilters(yaml: string): string[] {
  const block = /\n {4}tags:\n((?: {6}- .*\n)+)/.exec(yaml)?.[1] ?? '';
  return [...block.matchAll(/- '([^']+)'/g)].map((match) => match[1] ?? '');
}

/** A GitHub filter pattern as a regex, for the subset the workflow uses: `[0-9]`, `+` and literals. */
function filterRegex(filter: string): RegExp {
  const source = filter.replace(/\./g, '\\.').replace(/\*/g, '[^/]*');
  return new RegExp(`^${source}$`);
}

const matchesAny = (tag: string) => tagFilters(pages).some((filter) => filterRegex(filter).test(tag));

describe('Pages workflow', () => {
  it('runs on three-part engine and Worlds Within tags', () => {
    expect(tagFilters(pages)).toHaveLength(2);
    for (const tag of ['engine-v0.2.0', 'engine-v1.0.12', 'ww-v0.1.0', 'ww-v10.20.30']) {
      expect(matchesAny(tag), tag).toBe(true);
    }
  });

  it('ignores two-part, plain v* and other tags', () => {
    for (const tag of [
      'engine-v0.2',
      'ww-v1',
      'v0.2.0',
      'engine-v0.2.0.1',
      'engine-v0.2.0-rc',
      'other-v1.0.0',
    ]) {
      expect(matchesAny(tag), tag).toBe(false);
    }
  });

  it('accepts manual dispatch and never runs on branch pushes', () => {
    expect(pages).toMatch(/^ {2}workflow_dispatch:/m);
    expect(pages).not.toMatch(/^ {4}branches:/m);
  });

  it('runs every CI step before publishing', () => {
    const ciRuns = [...ci.matchAll(/- run: (.+)/g)].map((match) => match[1]);
    const pageRuns = [...pages.matchAll(/- run: (.+)/g)].map((match) => match[1]);
    expect(pageRuns).toEqual(ciRuns);
    expect(pages.indexOf('pnpm build')).toBeLessThan(pages.indexOf('actions/deploy-pages'));
  });

  it('builds under the repo name and deploys dist with the permissions Pages needs', () => {
    expect(pages).toContain('VITE_BASE: /${{ github.event.repository.name }}/');
    expect(pages).toMatch(/upload-pages-artifact@v\d+\n\s+with:\n\s+path: dist\n/);
    for (const permission of ['contents: read', 'pages: write', 'id-token: write']) {
      expect(pages).toContain(permission);
    }
    expect(pages).toContain('name: github-pages');
    expect(pages).toContain('actions/configure-pages@');
  });

  it('runs every run file in CI and publishes every game page (Engine 0.15 T16)', () => {
    // CI's `pnpm test` is vitest over vite.config.ts's `test.include`, which takes tests/runs
    // (every games/**/runs/*.run.json, run-files.test.ts); the Pages build is `pnpm build`, whose
    // inputs are every games/*/ and games/samples/*/ page (build/pages.ts's `pageInputs`), into `dist`.
    expect(ci).toMatch(/- run: pnpm test\n/);
    expect(viteConfig).toContain("'tests/**/*.test.ts'");
    expect(viteConfig).toContain('input: pageInputs(root)');
    expect(pages).toMatch(/- run: pnpm build\n/);
  });
});
