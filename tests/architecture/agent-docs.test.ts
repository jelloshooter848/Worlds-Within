import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The agent docs (CLAUDE.md, "The repo is LLM-first"; docs/ROADMAP.md, Engine 0.3): every module
// folder has a CLAUDE.md, an AGENTS.md and a page in docs/modules/ linked from the root llms.txt,
// and every link in llms.txt and the module pages points at a file that exists.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Subfolders of `dir` (a repo path), skipping hidden and `__fixtures__` folders. */
function subfolders(root: string, dir: string): string[] {
  if (!existsSync(join(root, dir))) return [];
  return readdirSync(join(root, dir), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('__'))
    .map((e) => `${dir}/${e.name}`)
    .sort();
}

/**
 * Every module folder: each engine part (`engine/*`), each backend (`engine/backends/*`), each kit
 * (`kits/*`) and each game (`games/*`, and `games/samples/*` inside the samples group).
 */
function moduleFolders(root: string): string[] {
  const groups = new Set(['engine/backends', 'games/samples']);
  const top = [...subfolders(root, 'engine'), ...subfolders(root, 'kits'), ...subfolders(root, 'games')];
  return top.flatMap((dir) => (groups.has(dir) ? subfolders(root, dir) : [dir])).sort();
}

/** The docs/modules page for a module folder: `engine/backends/null` -> `docs/modules/engine-backends-null.md`. */
function pageFor(folder: string): string {
  return `docs/modules/${folder.replaceAll('/', '-')}.md`;
}

/** Local link targets in a Markdown or llms.txt file, without `#anchors`; web and mail links skipped. */
function localLinks(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1]!.split('#')[0]!;
    if (target === '' || /^[a-z]+:/i.test(target)) continue;
    out.push(target);
  }
  return out;
}

/** Every problem with the agent docs under `root`, one line each; empty when they are complete. */
function agentDocProblems(root: string): string[] {
  const problems: string[] = [];
  const llmsPath = join(root, 'llms.txt');
  const llms = existsSync(llmsPath) ? readFileSync(llmsPath, 'utf8') : null;
  if (llms === null) problems.push('llms.txt is missing at the repo root');
  const llmsLinks = new Set(llms === null ? [] : localLinks(llms));

  for (const folder of moduleFolders(root)) {
    for (const file of ['CLAUDE.md', 'AGENTS.md']) {
      if (!existsSync(join(root, folder, file))) problems.push(`${folder} has no ${file}`);
    }
    const page = pageFor(folder);
    if (!existsSync(join(root, page))) problems.push(`${folder} has no page ${page}`);
    if (llms !== null && !llmsLinks.has(page)) problems.push(`llms.txt does not link ${page} (${folder})`);
  }

  for (const target of llmsLinks) {
    if (!existsSync(join(root, target))) problems.push(`llms.txt links ${target}, which does not exist`);
  }

  const pages = existsSync(join(root, 'docs/modules'))
    ? readdirSync(join(root, 'docs/modules')).filter((f) => f.endsWith('.md'))
    : [];
  for (const name of pages) {
    const page = `docs/modules/${name}`;
    for (const target of localLinks(readFileSync(join(root, page), 'utf8'))) {
      if (!existsSync(join(root, dirname(page), target))) {
        problems.push(`${page} links ${target}, which does not exist`);
      }
    }
  }
  return problems;
}

describe('agent docs: the repo', () => {
  it('finds every current module', () => {
    expect(moduleFolders(ROOT)).toEqual(
      expect.arrayContaining([
        'engine/core',
        'engine/backends/canvas2d',
        'engine/backends/null',
        'engine/backends/three',
        'engine/sim',
        'engine/tools',
        'kits/topdown',
        'games/samples/dungeon',
      ]),
    );
    expect(moduleFolders(ROOT)).not.toContain('engine/backends');
  });

  it('has a CLAUDE.md, an AGENTS.md and a linked page for every module, and no broken links', () => {
    expect(agentDocProblems(ROOT)).toEqual([]);
  });
});

describe('agent docs: the checker', () => {
  let root = '';
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  /** A tiny repo with one engine part, one backend, one kit and one sample game, all documented. */
  function makeRepo(): string {
    root = mkdtempSync(join(tmpdir(), 'agent-docs-'));
    const write = (path: string, text: string) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    const folders = ['engine/core', 'engine/backends/null', 'kits/topdown', 'games/samples/dungeon'];
    const links: string[] = [];
    for (const folder of folders) {
      write(`${folder}/CLAUDE.md`, `# ${folder}\n`);
      write(`${folder}/AGENTS.md`, 'Read [CLAUDE.md](CLAUDE.md).\n');
      write(pageFor(folder), `# ${folder}\n\nRules: [CLAUDE.md](../../${folder}/CLAUDE.md).\n`);
      links.push(`- [${folder}](${pageFor(folder)}): a module`);
    }
    write('llms.txt', `# Test\n\n> Summary.\n\n## Modules\n\n${links.join('\n')}\n`);
    return root;
  }

  it('passes a complete repo', () => {
    const repo = makeRepo();
    expect(moduleFolders(repo)).toEqual([
      'engine/backends/null',
      'engine/core',
      'games/samples/dungeon',
      'kits/topdown',
    ]);
    expect(agentDocProblems(repo)).toEqual([]);
  });

  it.each([
    ['engine/core/CLAUDE.md', 'engine/core has no CLAUDE.md'],
    ['kits/topdown/AGENTS.md', 'kits/topdown has no AGENTS.md'],
    [
      'docs/modules/engine-backends-null.md',
      'engine/backends/null has no page docs/modules/engine-backends-null.md',
    ],
  ])('fails when %s is removed', (file, problem) => {
    const repo = makeRepo();
    rmSync(join(repo, file));
    expect(agentDocProblems(repo)).toContain(problem);
  });

  it('fails when a new module has no docs', () => {
    const repo = makeRepo();
    mkdirSync(join(repo, 'kits/platformer'));
    expect(agentDocProblems(repo)).toEqual([
      'kits/platformer has no CLAUDE.md',
      'kits/platformer has no AGENTS.md',
      'kits/platformer has no page docs/modules/kits-platformer.md',
      'llms.txt does not link docs/modules/kits-platformer.md (kits/platformer)',
    ]);
  });

  it('fails on a broken llms.txt link and on a missing llms.txt', () => {
    const repo = makeRepo();
    const llms = join(repo, 'llms.txt');
    writeFileSync(llms, `${readFileSync(llms, 'utf8')}- [Gone](docs/gone.md): nothing\n`);
    expect(agentDocProblems(repo)).toEqual(['llms.txt links docs/gone.md, which does not exist']);
    rmSync(llms);
    expect(agentDocProblems(repo)).toContain('llms.txt is missing at the repo root');
  });

  it('fails on a broken link in a module page', () => {
    const repo = makeRepo();
    writeFileSync(join(repo, 'docs/modules/kits-topdown.md'), 'See [nothing](../../kits/topdown/NOPE.md).\n');
    expect(agentDocProblems(repo)).toEqual([
      'docs/modules/kits-topdown.md links ../../kits/topdown/NOPE.md, which does not exist',
    ]);
  });

  it('reads local links and skips web links and anchors', () => {
    expect(
      localLinks('[a](docs/a.md) [b](https://x.org) [c](b.md#part "title") [d](#top) [e](mailto:x@y.z)'),
    ).toEqual(['docs/a.md', 'b.md']);
  });
});
