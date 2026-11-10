import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { gameManifestSchema } from '@engine/core/content/manifest';
import {
  CHEATSHEET,
  CLI_PAGE,
  defaultDocSources,
  diffSummary,
  EXAMPLES_DIR,
  fillCheatsheet,
  generateDocs,
  SCHEMAS_PAGE,
  staleDocs,
  type DocSources,
} from './docs-gen';
import { main } from './main';
import { gameFolders, MINI_GAMES_DIR, repoMiniGameDocs } from './mini-game-docs';
import { Registry, type Command } from './registry';
import { fieldRows, limitsOf, typeName } from './schema-doc';

// The generated docs (docs-gen.ts): the committed pages must be what the generator makes now, so a
// schema or command changed without `pnpm docs:gen` fails `pnpm test` (and CI's `pnpm docs:check`).

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** A temp copy of what the generator reads and writes: the examples and the three pages. */
let temp = '';
function tempRepo(): string {
  temp = mkdtempSync(join(tmpdir(), 'docs-gen-'));
  for (const path of [
    EXAMPLES_DIR,
    MINI_GAMES_DIR,
    CLI_PAGE,
    SCHEMAS_PAGE,
    CHEATSHEET,
    '.prettierrc',
    '.editorconfig',
  ]) {
    cpSync(join(ROOT, path), join(temp, path), { recursive: true });
  }
  return temp;
}
afterEach(() => {
  if (temp) rmSync(temp, { recursive: true, force: true });
  temp = '';
});

/** The real sources with the manifest's `id` described differently, as an edit would leave them. */
function withManifestDescription(text: string): DocSources {
  const sources = defaultDocSources();
  const schema = gameManifestSchema.safeExtend({ id: gameManifestSchema.shape.id.describe(text) });
  return {
    ...sources,
    subjects: sources.subjects.map((s) => (s.name === 'manifest' ? { ...s, schema } : s)),
  };
}

describe('generated docs: the repo', () => {
  it('are up to date (run "pnpm docs:gen" after changing a schema or a command)', async () => {
    expect(await staleDocs(ROOT, defaultDocSources())).toEqual([]);
  });

  it('cli.md holds exactly what "pnpm cli help" and "help <command>" print', async () => {
    const page = readFileSync(join(ROOT, CLI_PAGE), 'utf8');
    const helpOf = async (argv: string[]) => {
      let out = '';
      const code = await main(argv, { stdout: (t) => (out += t), stderr: () => {}, cwd: ROOT });
      expect(code).toBe(0);
      return out;
    };
    const overview = await helpOf(['help']);
    expect(page).toContain('```text\n' + overview + '```');
    for (const command of defaultDocSources().registry.list()) {
      expect(page).toContain('```text\n' + (await helpOf(['help', command.name])) + '```');
    }
  });

  it('documents every field of every format, and every format has a section', async () => {
    const sources = defaultDocSources();
    expect(sources.subjects.map((s) => s.name)).toEqual(
      expect.arrayContaining(['manifest', 'run', 'song', 'sfx', 'palette', 'sprite', 'room']),
    );
    for (const subject of sources.subjects) {
      const undescribed = fieldRows(subject.schema).filter((r) => r.description === '');
      expect(undescribed.map((r) => `${subject.name}: ${r.path}`)).toEqual([]);
    }
    const page = readFileSync(join(ROOT, SCHEMAS_PAGE), 'utf8');
    for (const subject of sources.subjects) expect(page).toContain(`# ${subject.title}\n`);
  });

  it('the cheat sheet and the reference pages are linked from llms.txt', () => {
    const llms = readFileSync(join(ROOT, 'llms.txt'), 'utf8');
    for (const page of [CHEATSHEET, CLI_PAGE, SCHEMAS_PAGE]) expect(llms).toContain(`](${page})`);
  });
});

describe('generated docs: the drift check', () => {
  it('fails when a schema description changes without regenerating', async () => {
    const root = tempRepo();
    expect(await staleDocs(root, defaultDocSources())).toEqual([]);
    const stale = await staleDocs(root, withManifestDescription('the game id, changed'));
    expect(stale.map((s) => s.file)).toEqual([SCHEMAS_PAGE]);
    expect(stale[0]!.summary).toContain('the game id, changed');
  });

  it('fails when a command changes, in the CLI page and the cheat sheet', async () => {
    const root = tempRepo();
    const sources = defaultDocSources();
    const registry = new Registry();
    for (const c of sources.registry.list()) {
      const changed: Command = c.name === 'validate' ? { ...c, summary: 'a changed summary' } : c;
      registry.add(changed);
    }
    const stale = await staleDocs(root, { ...sources, registry });
    expect(stale.map((s) => s.file).sort()).toEqual([CHEATSHEET, CLI_PAGE].sort());
  });

  it('fails on a page edited by hand, and gen puts it right', async () => {
    const root = tempRepo();
    const file = join(root, CLI_PAGE);
    writeFileSync(file, readFileSync(file, 'utf8').replace('Overview', 'Hand edit'));
    const stale = await staleDocs(root, defaultDocSources());
    expect(stale).toEqual([{ file: CLI_PAGE, summary: expect.stringContaining('"## Hand edit"') }]);
    const pages = await generateDocs(root, defaultDocSources());
    writeFileSync(file, pages[CLI_PAGE]!);
    expect(await staleDocs(root, defaultDocSources())).toEqual([]);
  });

  it('reports a missing page, and fails on an example that breaks its schema', async () => {
    const root = tempRepo();
    rmSync(join(root, SCHEMAS_PAGE));
    expect(await staleDocs(root, defaultDocSources())).toEqual([{ file: SCHEMAS_PAGE, summary: 'missing' }]);
    writeFileSync(join(root, EXAMPLES_DIR, 'palette.json'), '{ "id": "x", "colors": ["red"] }\n');
    await expect(generateDocs(root, defaultDocSources())).rejects.toThrow(
      /palette example breaks its schema/,
    );
  });

  it('needs every cheat sheet block, and knows each one', () => {
    const sources = defaultDocSources();
    expect(() => fillCheatsheet('# Nothing\n', sources)).toThrow(/missing generated blocks/);
    expect(() => fillCheatsheet('<!-- generated:nope --><!-- /generated:nope -->', sources)).toThrow(
      /no generator for block "nope"/,
    );
  });

  it('summarises a difference by its first line and count', () => {
    expect(diffSummary('a\nb\nc', 'a\nB\nC')).toBe('2 lines differ; first at line 2: has "b", should be "B"');
    expect(diffSummary('a', 'a\nb')).toBe('1 line differs; first at line 2: has (no line), should be "b"');
  });
});

describe('generated docs: mini games a game defines (gap M11)', () => {
  it('has one params page per game-defined mini game, linked from the schema reference', async () => {
    const docs = await repoMiniGameDocs();
    expect(docs.map((d) => d.page)).toEqual(
      expect.arrayContaining([
        `${MINI_GAMES_DIR}/platformer-classic-vault.md`,
        `${MINI_GAMES_DIR}/platformer-classic-cellar.md`,
      ]),
    );
    // A kit's fixed-id mini game (the mini siege's mission-room) is the schema reference's own.
    expect(docs.some((d) => d.id === 'mission-room' || d.id === 'td-defence')).toBe(false);
    const schemas = readFileSync(join(ROOT, SCHEMAS_PAGE), 'utf8');
    for (const d of docs) {
      expect(schemas).toContain(`](${d.page.replace('docs/reference/', '')})`);
      const page = readFileSync(join(ROOT, d.page), 'utf8');
      expect(page).toContain('| Field ');
    }
    const vault = docs.find((d) => d.id === 'vault')!;
    expect(vault.uses).toEqual(['games/platformer-classic/content/levels/level-4.json (triggers.0.params)']);
  });

  it('a page edited by hand is stale', async () => {
    const root = tempRepo();
    const page = join(root, MINI_GAMES_DIR, 'platformer-classic-vault.md');
    writeFileSync(page, readFileSync(page, 'utf8').replace('VAULT', 'VOLT'));
    const stale = await staleDocs(root, defaultDocSources());
    expect(stale.map((s) => s.file)).toEqual([`${MINI_GAMES_DIR}/platformer-classic-vault.md`]);
  });

  it('finds every game folder under games/', () => {
    const dirs = gameFolders(ROOT);
    expect(dirs).toContain('games/samples/platformer');
    expect(dirs).toContain('games/platformer-lab');
  });
});

describe('generated docs: schema fields', () => {
  it('lists nested fields with type, required, default and limits', () => {
    const schema = z.strictObject({
      name: z.string().min(1).describe('a name'),
      size: z.number().int().min(1).max(9).default(3).describe('a size'),
      tags: z.array(z.string()).optional().describe('tags'),
      at: z.tuple([z.number(), z.number()]).describe('a cell'),
      kind: z.enum(['a', 'b']).describe('a kind'),
      items: z.array(z.strictObject({ id: z.string().describe('an id') })).describe('items'),
      byName: z.record(z.string(), z.number().describe('a count')).describe('counts'),
    });
    expect(fieldRows(schema)).toEqual([
      { path: 'name', type: 'string', required: true, limits: 'not empty', description: 'a name' },
      {
        path: 'size',
        type: 'integer',
        required: false,
        default: '3',
        limits: '1 to 9',
        description: 'a size',
      },
      { path: 'tags', type: 'string[]', required: false, limits: '', description: 'tags' },
      { path: 'at', type: '[number, number]', required: true, limits: '', description: 'a cell' },
      { path: 'kind', type: '"a" | "b"', required: true, limits: '', description: 'a kind' },
      { path: 'items', type: 'object[]', required: true, limits: '', description: 'items' },
      { path: 'items[].id', type: 'string', required: true, limits: '', description: 'an id' },
      { path: 'byName', type: '{ <key>: number }', required: true, limits: '', description: 'counts' },
      { path: 'byName.<key>', type: 'number', required: false, limits: '', description: 'a count' },
    ]);
  });

  it('names unions, nullables and JSON values', () => {
    expect(typeName({ anyOf: [{ type: 'string' }, { type: 'null' }] })).toBe('string | null');
    expect(typeName({ type: 'array', items: { enum: ['x', 'y'] } })).toBe('("x" | "y")[]');
    expect(typeName({ $ref: '#/$defs/json' })).toBe('JSON');
    expect(limitsOf({ type: 'array', minItems: 1, items: { type: 'string', pattern: '^a$' } })).toBe(
      'at least 1 item; items: matches `^a$`',
    );
  });
});
