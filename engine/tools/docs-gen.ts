import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import type { z } from 'zod';
import { campaignSaveSchema } from '@engine/core/campaign';
import { engineContentKinds } from '@engine/core/content/engine-kinds';
import { partFileName, parseContent, type ContentKind, type ContentPart } from '@engine/core/content/kinds';
import { gameManifestSchema, MANIFEST_FILE } from '@engine/core/content/manifest';
import { formatErrors, validate, type ContentError } from '@engine/core/content/validate';
import {
  SaveError,
  STANDARD_COMPONENTS,
  SYSTEM_COMPONENTS,
  ScenarioError,
  Terrain,
  carriedRecordSchema,
  loadWorld,
  rtsTypesSchema,
  scenarioSchema,
  timelineSchema,
  worldFromScenario,
  worldSaveSchema,
} from '@engine/sim/index';
import { helpResult, helpText } from './commands/help';
import { EXIT, EXIT_MEANINGS, type ExitName } from './exit-codes';
import { allKits } from './kits';
import { defaultRegistry } from './main';
import type { Registry } from './registry';
import { dumpFileSchema } from './dump-file';
import { CHECK_OP_MEANINGS, CHECK_OPS, runFileSchema } from './run-file';
import { repoMiniGameDocs, type GameMiniGameDoc } from './mini-game-docs';
import { fieldRows, type FieldRow } from './schema-doc';

/**
 * The generated docs (`pnpm docs:gen`, checked by `pnpm docs:check` and `docs.test.ts`): the CLI
 * reference, the schema reference and the reference blocks of the cheat sheet, all from the same
 * sources the code uses, so they cannot drift apart:
 *
 * - `docs/reference/cli.md`: `pnpm cli help` and `help <command>` for every command, the very text
 *   the CLI prints (`helpText` in `commands/help.ts`).
 * - `docs/reference/schemas.md`: one section per file format (the game manifest, run files and
 *   every content kind, the engine's and each kit's), with a field table from the Zod schema
 *   (`schema-doc.ts`) and an example from `docs/reference/examples/`, which must pass the schema.
 * - `docs/reference/mini-games/<game>-<id>.md` (Engine 0.15, gap M11): one page per mini game a
 *   game defines (`HeadlessEntry.miniGames`, `mini-game-docs.ts`), its params table from its
 *   schema, linked from the schema reference's "Mini game params".
 * - `docs/CHEATSHEET.md`: hand-written, except the blocks between `<!-- generated:<name> -->` and
 *   `<!-- /generated:<name> -->`, which are filled from {@link CHEATSHEET_BLOCKS}.
 *
 * Every page goes through Prettier with the repo's settings, so `pnpm lint` passes on it.
 */

export const CLI_PAGE = 'docs/reference/cli.md';
export const SCHEMAS_PAGE = 'docs/reference/schemas.md';
export const CHEATSHEET = 'docs/CHEATSHEET.md';
export const EXAMPLES_DIR = 'docs/reference/examples';

/** One file format the schema reference documents. */
export interface DocSubject {
  /** Short name: `manifest`, `run`, or a content kind's name. Also the example's file name. */
  name: string;
  /** The section heading. */
  title: string;
  /** Who defines it: `engine` or `kit <name>`. */
  from: string;
  /** Where such files live in a game, as a reader would write it. */
  where: string;
  /** The file forms it is read from: `.json`, `.txt`, `.json + .map.txt`. */
  forms: string;
  description: string;
  schema: z.ZodType;
  /**
   * `params`: a kit mini game's params (`KitDef.paramsDocs`); `options`: a kit's `game.json`
   * options (`KitDef.options`, gap G17). Each is listed in its own section.
   */
  section?: 'params' | 'options';
  /** The example's file name in {@link EXAMPLES_DIR}, and the sibling part files it has. */
  example: string;
  parts?: Readonly<Record<string, string>>;
  /** Checks the example: content errors, empty when it passes. */
  check(file: string, text: string, parts: Readonly<Record<string, ContentPart>>): ContentError[];
}

/** What the docs are made from. Tests pass changed sources to show a stale page is caught. */
export interface DocSources {
  registry: Registry;
  subjects: readonly DocSubject[];
  /**
   * The mini games games define (Engine 0.15, gap M11), one params page each under
   * `docs/reference/mini-games/`. Left out, the repo's games' (`repoMiniGameDocs`).
   */
  miniGames?: readonly GameMiniGameDoc[];
}

function jsonCheck(schema: z.ZodType) {
  return (file: string, text: string): ContentError[] => {
    try {
      return validate(file, JSON.parse(text), schema).errors;
    } catch (error) {
      return [{ file, path: '', pointer: '', code: 'invalid_json', message: String(error) }];
    }
  };
}

/**
 * Checks a world save example by loading it with the standard components and `Terrain`, and a
 * do-nothing stand-in for each system it names (systems are code, never in a save).
 */
function checkWorldSave(file: string, text: string): ContentError[] {
  try {
    const json = JSON.parse(text) as { systems?: unknown };
    const names = Array.isArray(json.systems) ? json.systems.map(String) : [];
    loadWorld(json, {
      components: [...STANDARD_COMPONENTS, Terrain],
      systems: names.map((name) => ({ name, run: () => undefined })),
    });
    return [];
  } catch (error) {
    if (error instanceof SaveError) {
      return error.issues.map((i) => ({
        file,
        path: i.path,
        pointer: '',
        code: 'invalid_save',
        message: i.message,
      }));
    }
    return [{ file, path: '', pointer: '', code: 'invalid_json', message: String(error) }];
  }
}

/** Checks a world scenario example by building it with the standard and system components. */
function checkScenario(file: string, text: string): ContentError[] {
  try {
    worldFromScenario(JSON.parse(text), {
      components: [...STANDARD_COMPONENTS, Terrain, ...SYSTEM_COMPONENTS],
    });
    return [];
  } catch (error) {
    if (error instanceof ScenarioError) {
      return error.issues.map((i) => ({
        file,
        path: i.path,
        pointer: '',
        code: 'invalid_scenario',
        message: i.message,
      }));
    }
    return [{ file, path: '', pointer: '', code: 'invalid_json', message: String(error) }];
  }
}

/** A content kind as a doc subject; its example is `<name>.txt` when the kind reads `.txt` files. */
export function kindSubject(kind: ContentKind, from: string): DocSubject {
  const partSuffixes = Object.values(kind.gridParts ?? {});
  const forms = kind.readText
    ? '`.json` or `.txt`'
    : ['`.json`', ...partSuffixes.map((s) => `\`${s}\``)].join(' + ');
  const example = `${kind.name}${kind.readText ? '.txt' : '.json'}`;
  const parts = Object.fromEntries(
    Object.entries(kind.gridParts ?? {}).map(([field, suffix]) => [field, partFileName(example, suffix)]),
  );
  return {
    name: kind.name,
    title: `\`${kind.name}\``,
    from,
    where: `\`content/\`, claimed in \`game.json\` under \`content.${kind.name}\``,
    forms,
    description: kind.description,
    schema: kind.schema,
    example,
    ...(partSuffixes.length ? { parts } : {}),
    check: (file, text, partTexts) => {
      const result = parseContent(kind, file, text, partTexts);
      return result.ok ? [] : result.errors;
    },
  };
}

/** The real sources: the CLI's registry, the manifest and run-file schemas, and every content kind. */
export function defaultDocSources(): DocSources {
  const subjects: DocSubject[] = [
    {
      name: 'manifest',
      title: `Game manifest (\`${MANIFEST_FILE}\`)`,
      from: 'engine',
      where: `\`games/<game>/${MANIFEST_FILE}\``,
      forms: '`.json`',
      description:
        "Names the game and its kit, the files of each content kind, the start seed and the game's entry modules",
      schema: gameManifestSchema,
      example: 'manifest.json',
      check: jsonCheck(gameManifestSchema),
    },
    {
      name: 'run',
      title: 'Run file (`*.run.json`)',
      from: 'engine/tools',
      where: '`games/<game>/runs/<name>.run.json`; replay files in `.ww-out/replays/`',
      forms: '`.json`',
      description: 'A seeded, scripted headless run and the checks it must pass (`pnpm cli run`)',
      schema: runFileSchema,
      example: 'run.json',
      check: jsonCheck(runFileSchema),
    },
    {
      name: 'world-save',
      title: 'World save (`saveWorld`)',
      from: 'engine/sim',
      where:
        'wherever a game keeps its saves; `saveWorld(world)` writes it, `loadWorld(json, options)` reads it',
      forms: '`.json`',
      description:
        "The whole simulated world (Engine 0.8): seed, tick, RNG state, next entity id, every entity's components, the system names and the event log",
      schema: worldSaveSchema,
      example: 'world-save.json',
      check: checkWorldSave,
    },
    {
      name: 'world-scenario',
      title: 'World scenario (`worldFromScenario`)',
      from: 'engine/sim',
      where:
        "wherever a game keeps its world starts (the engine's sample: `engine/sim/__fixtures__/village.world.json`); `worldFromScenario(json, options)` reads it",
      forms: '`.json`',
      description:
        'A world written as data (Engine 0.8): the seed, the terrain as text grids of ground types and elevation digits, entities with their components, and squads with their named members',
      schema: scenarioSchema,
      example: 'world-scenario.json',
      check: checkScenario,
    },
    {
      name: 'timeline',
      title: 'Timeline record (`timelineOf`)',
      from: 'engine/sim',
      where:
        "read from a world's plain data by `timelineOf` / `worldTimeline` (`engine/sim/timeline.ts`); given by `HeadlessGame.timeline()`, printed by `pnpm cli timeline`, kept in a dump file",
      forms: '`.json`',
      description:
        "A world's time as data (Engine 0.14): the world tick, the world tick per game tick (`clock`, a game run's, run-length), frozen spans, experience per mission, opportunity windows with their status history and causes, and the missions opened and committed",
      schema: timelineSchema,
      example: 'timeline.json',
      check: jsonCheck(timelineSchema),
    },
    {
      name: 'dump-file',
      title: 'Dump file (`dump --out`)',
      from: 'engine/tools',
      where:
        'wherever `pnpm cli dump <run-file> --tick N --out <file>.json` writes it; the debugger reads it',
      forms: '`.json`',
      description:
        "One tick of a run as a still picture (Engine 0.14): the dump result (state, orders and mission steps applied, hash) with the world's event log and timeline there, paths relative to the file",
      schema: dumpFileSchema,
      example: 'dump-file.json',
      check: jsonCheck(dumpFileSchema),
    },
    {
      name: 'carried-record',
      title: 'Carried record (`carriedRecord`)',
      from: 'engine/sim',
      where:
        "built from a scenario's end world by `carriedRecord(world, from, keys)`; `worldFromScenario(json, { carried })` reads it",
      forms: '`.json`',
      description:
        "What carries from one scenario's end world into the scenario that names it in `from` (Engine 0.13): each carried person's fate and `Health`, and stockpile item counts, keys sorted",
      schema: carriedRecordSchema,
      example: 'carried-record.json',
      check: jsonCheck(carriedRecordSchema),
    },
    {
      name: 'campaign-save',
      title: 'Campaign save (`campaignSaveSchema`)',
      from: 'engine/core',
      where:
        "a game's campaign run state: kept in browser storage under `ww:<game>:campaign:<id>` (`engine/core/save/campaign-store.ts`), packed into a save code by `encodeSaveCode` (`engine/core/campaign-code.ts`), given by `HeadlessGame.campaignSave()`",
      forms: '`.json`',
      description:
        'Where a campaign run is and what it carries (Engine 0.13): the entry played now, the carried record the next scenario starts from, and the missions committed in every finished entry; never a whole world',
      schema: campaignSaveSchema,
      example: 'campaign-save.json',
      check: jsonCheck(campaignSaveSchema),
    },
    {
      name: 'rts-types',
      title: 'RTS unit and building types (`rtsTypesSchema`)',
      from: 'engine/core',
      where:
        "a game's RTS data, held in the world by the `RtsTypes` component (in a world scenario: an entity's `RtsTypes`)",
      forms: '`.json`',
      description:
        'The unit and building types an RTS world makes things from (Engine 0.9): stats, costs, build and training time, what a building trains and whether it takes drop-offs',
      schema: rtsTypesSchema,
      example: 'rts-types.json',
      check: jsonCheck(rtsTypesSchema),
    },
    ...engineContentKinds()
      .list()
      .map((kind) => kindSubject(kind, 'engine')),
  ];
  for (const kit of [...allKits()].sort((a, b) => a.name.localeCompare(b.name))) {
    for (const kind of kit.kinds()) subjects.push(kindSubject(kind, `kit ${kit.name}`));
    if (kit.options)
      subjects.push({
        name: `${kit.name}-options`,
        title: `\`${kit.name}\` kit options`,
        from: `kit ${kit.name}`,
        where: `\`kitOptions.${kit.name}\` in a game's \`${MANIFEST_FILE}\``,
        forms: '`.json`',
        description: `How kit \`${kit.name}\` treats this game (Engine 0.15, gap G17): read by its hook's \`kinds(manifest)\`; an option it does not have is \`unknown_option\`, a bad value \`bad_option\``,
        schema: kit.options,
        example: `${kit.name}-options.json`,
        section: 'options',
        check: jsonCheck(kit.options),
      });
    for (const doc of kit.paramsDocs?.() ?? [])
      subjects.push({
        name: `${doc.game}-params`,
        title: `\`${doc.game}\` params`,
        from: `kit ${kit.name}`,
        where: `the \`params\` of a \`*.mission.json\` whose \`play\` is \`${doc.game}\``,
        forms: '`.json`',
        description: doc.description,
        schema: doc.schema,
        example: `${doc.game}-params.json`,
        section: 'params',
        check: jsonCheck(doc.schema),
      });
  }
  return { registry: defaultRegistry(), subjects };
}

// ---- Markdown helpers ----

/** Text for a table cell: `|` escaped, and `<` outside code spans so `<game>` is not read as HTML. */
export function cell(text: string): string {
  return text
    .split('`')
    .map((part, i) => (i % 2 === 1 ? part : part.replaceAll('<', '&lt;')))
    .join('`')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ');
}

/** Text in a code span, for a table cell: only `|` needs escaping there. */
const code = (text: string) => `\`${text.replaceAll('|', '\\|')}\``;

function table(head: readonly string[], rows: readonly (readonly string[])[]): string {
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}

const GENERATED_NOTE = (what: string) =>
  `<!-- Generated by \`pnpm docs:gen\` from ${what}. Do not edit by hand: \`pnpm docs:check\` (part of \`pnpm test\`) fails when this page is out of date. -->`;

function fieldTable(rows: readonly FieldRow[]): string {
  return table(
    ['Field', 'Type', 'Required', 'Default', 'Limits', 'Description'],
    rows.map((r) => [
      code(r.path),
      code(r.type),
      r.required ? 'yes' : 'no',
      r.default === undefined ? '' : code(r.default),
      cell(r.limits),
      cell(r.description),
    ]),
  );
}

function fence(lang: string, text: string): string {
  return ['```' + lang, text.replace(/\n+$/, ''), '```'].join('\n');
}

const exitRows = () =>
  (Object.keys(EXIT) as ExitName[]).map((name) => [
    String(EXIT[name]),
    code(name),
    cell(EXIT_MEANINGS[name]),
  ]);

const opRows = () => CHECK_OPS.map((op) => [code(op), cell(CHECK_OP_MEANINGS[op])]);

// ---- Pages ----

function cliPage(registry: Registry): string {
  const sections = registry
    .list()
    .map((c) => [`## \`${c.name}\``, '', fence('text', helpText(helpResult(registry, c.name)))].join('\n'));
  return [
    '# CLI reference',
    '',
    GENERATED_NOTE(
      'the command registry (`engine/tools/registry.ts`, `defaultRegistry()` in `engine/tools/main.ts`)',
    ),
    '',
    'Every block below is exactly what `pnpm cli help` and `pnpm cli help <command>` print. Add `--json` to any',
    'command for one JSON result object on stdout. The rules behind each command are in',
    '[engine/tools/CLAUDE.md](../../engine/tools/CLAUDE.md); file formats are in [schemas.md](schemas.md).',
    '',
    '## Overview',
    '',
    fence('text', helpText(helpResult(registry))),
    '',
    ...sections.flatMap((s) => [s, '']),
  ].join('\n');
}

interface Example {
  file: string;
  text: string;
  parts: Record<string, ContentPart>;
}

/** Reads a subject's example (and its parts) under `root`, and fails when it breaks the schema. */
function readExample(root: string, subject: DocSubject): Example {
  const read = (name: string): string => {
    const path = join(root, EXAMPLES_DIR, name);
    if (!existsSync(path)) throw new Error(`${subject.name}: no example at ${EXAMPLES_DIR}/${name}`);
    return readFileSync(path, 'utf8');
  };
  const file = `${EXAMPLES_DIR}/${subject.example}`;
  const text = read(subject.example);
  const parts: Record<string, ContentPart> = {};
  for (const [field, name] of Object.entries(subject.parts ?? {})) {
    parts[field] = { file: `${EXAMPLES_DIR}/${name}`, text: read(name) };
  }
  const errors = subject.check(file, text, parts);
  if (errors.length > 0)
    throw new Error(`the ${subject.name} example breaks its schema:\n${formatErrors(errors)}`);
  return { file, text, parts };
}

function subjectSection(subject: DocSubject, example: Example, level: string): string {
  const lang = subject.example.endsWith('.json') ? 'json' : 'text';
  const out = [
    `${level} ${subject.title}`,
    '',
    `${subject.description}.`,
    '',
    `- Defined by: ${subject.from}`,
    `- Where: ${subject.where}`,
    `- Read from: ${subject.forms}`,
    '',
    fieldTable(fieldRows(subject.schema)),
    '',
    `Example (\`${example.file}\`):`,
    '',
    fence(lang, example.text),
  ];
  for (const part of Object.values(example.parts)) {
    out.push('', `With \`${part.file}\`:`, '', fence('text', part.text));
  }
  if (subject.name === 'run') {
    out.push('', 'Check ops (`op` in assertions and invariants):', '', table(['Op', 'Meaning'], opRows()));
  }
  return out.join('\n');
}

function schemasPage(
  root: string,
  subjects: readonly DocSubject[],
  miniGames: readonly GameMiniGameDoc[],
): string {
  const files = subjects.filter((s) =>
    [
      'manifest',
      'run',
      'world-save',
      'world-scenario',
      'timeline',
      'dump-file',
      'carried-record',
      'campaign-save',
    ].includes(s.name),
  );
  const params = subjects.filter((s) => s.section === 'params');
  const options = subjects.filter((s) => s.section === 'options');
  const kinds = subjects.filter((s) => !files.includes(s) && !params.includes(s) && !options.includes(s));
  return [
    '# Schema reference',
    '',
    GENERATED_NOTE(
      'the Zod schemas (`engine/core/content/manifest.ts`, `engine/tools/run-file.ts`, `engine/sim/save.ts`, `engine/sim/scenario.ts`, `engine/sim/timeline.ts`, `engine/tools/dump-file.ts`, `engine/sim/carry.ts`, `engine/core/campaign.ts`, each content kind) and `docs/reference/examples/`',
    ),
    '',
    'One section per file format. Each table lists every field: nested fields are written under their',
    'parent (`input.steps[].frame` is a field of each item of `input.steps`; `<key>` is any key of a map).',
    '"Required" is whether the file must give it; a field with a default may be left out. Checks beyond',
    "the shape (a room's map must parse, a song's MML must compile) are listed in the kind's module",
    'page. `pnpm cli validate <game>` checks every file; errors name the file and the field.',
    '',
    ...files.flatMap((s) => [subjectSection(s, readExample(root, s), '##'), '']),
    '## Content kinds',
    '',
    'The engine defines some kinds and each kit adds its own (`engine/tools/kits.ts`); a game claims',
    'files for each kind in `game.json`.',
    '',
    ...kinds.flatMap((s) => [subjectSection(s, readExample(root, s), '###'), '']),
    ...(options.length
      ? [
          '## Kit options',
          '',
          "A kit's own options, given in `game.json`'s `kitOptions` under the kit's name (gap G17);",
          '`validate` checks them with the manifest.',
          '',
          ...options.flatMap((s) => [subjectSection(s, readExample(root, s), '###'), '']),
        ]
      : []),
    ...(params.length || miniGames.length
      ? [
          '## Mini game params',
          '',
          "The params of a kit's mini games that content names by a fixed id (`KitDef.paramsDocs`);",
          '`validate` checks them with the content (gap G16).',
          '',
          ...params.flatMap((s) => [subjectSection(s, readExample(root, s), '###'), '']),
          ...(miniGames.length
            ? [
                '### Mini games a game defines',
                '',
                "A game's own mini games (`HeadlessEntry.miniGames`, such as a room challenge whose id is",
                "its room's) each have a params page of their own (gap M11):",
                '',
                ...miniGames.map(
                  (m) =>
                    `- [\`${m.id}\` (${m.game})](${m.page.replace(/^docs\/reference\//, '')}): ${cell(m.title)}`,
                ),
                '',
              ]
            : []),
        ]
      : []),
  ].join('\n');
}

/** The params page of a mini game a game defines (gap M11). */
function miniGamePage(m: GameMiniGameDoc): string {
  return [
    `# \`${m.id}\` params (${m.game})`,
    '',
    GENERATED_NOTE(
      `the \`paramsSchema\` of mini game \`${m.id}\` in \`${m.gameDir}\`'s \`miniGames(content)\``,
    ),
    '',
    `${cell(m.title)}: a mini game the game \`${m.game}\` defines (\`HeadlessEntry.miniGames\` in`,
    `\`${m.gameDir}\`), so its id is the game's, not a kit's. Its \`params\` are written where the game's`,
    'content names it; `pnpm cli validate` checks them with the content. See the',
    "[schema reference](../schemas.md#mini-game-params) for the kits' own mini games.",
    '',
    `- Named in: ${m.uses.length ? m.uses.map((u) => cell(u)).join('; ') : 'nothing in the content yet'}`,
    '',
    fieldTable(fieldRows(m.schema)),
    '',
  ].join('\n');
}

/** The cheat sheet's generated blocks, by marker name. */
export const CHEATSHEET_BLOCKS: Readonly<Record<string, (sources: DocSources) => string>> = {
  commands: ({ registry }) =>
    table(
      ['Command', 'Usage', 'What it does'],
      registry.list().map((c) => {
        const usage = helpText(helpResult(registry, c.name)).split('\n')[0]!;
        return [code(c.name), code(usage), cell(c.summary)];
      }),
    ),
  'exit-codes': () => table(['Code', 'Name', 'Meaning'], exitRows()),
  files: ({ subjects }) =>
    table(
      ['Format', 'From', 'Where', 'Read from', 'What it is'],
      subjects.map((s) => [s.title, cell(s.from), cell(s.where), s.forms, cell(s.description)]),
    ),
  'run-file': ({ subjects }) => {
    const run = subjects.find((s) => s.name === 'run');
    if (!run) throw new Error('no run subject');
    const rows = fieldRows(run.schema).filter((r) => !r.path.startsWith('replay.'));
    return table(
      ['Field', 'Type', 'Default', 'Description'],
      rows.map((r) => [
        code(r.path),
        code(r.type),
        r.default === undefined ? (r.required ? 'required' : '') : code(r.default),
        cell(r.description),
      ]),
    );
  },
  'check-ops': () => table(['Op', 'Meaning'], opRows()),
};

const BLOCK = /<!-- generated:([a-z-]+) -->[\s\S]*?<!-- \/generated:\1 -->/g;

/** The cheat sheet with every generated block filled. A block without a generator is an error. */
export function fillCheatsheet(text: string, sources: DocSources): string {
  const seen = new Set<string>();
  const out = text.replace(BLOCK, (_, name: string) => {
    const make = CHEATSHEET_BLOCKS[name];
    if (!make) throw new Error(`${CHEATSHEET}: no generator for block "${name}"`);
    seen.add(name);
    return `<!-- generated:${name} -->\n\n${make(sources)}\n\n<!-- /generated:${name} -->`;
  });
  const missing = Object.keys(CHEATSHEET_BLOCKS).filter((n) => !seen.has(n));
  if (missing.length) throw new Error(`${CHEATSHEET}: missing generated blocks: ${missing.join(', ')}`);
  return out;
}

async function prettierMarkdown(root: string, file: string, text: string): Promise<string> {
  const abs = join(root, file);
  const config = (await resolveConfig(abs, { editorconfig: true })) ?? {};
  return format(text, { ...config, parser: 'markdown', filepath: abs });
}

/**
 * Every generated page, `{ repo path: text }`, as it should be on disk under `root`. Reads the
 * examples and the cheat sheet's hand-written part from `root`; writes nothing.
 */
export async function generateDocs(root: string, sources: DocSources): Promise<Record<string, string>> {
  const cheatPath = join(root, CHEATSHEET);
  if (!existsSync(cheatPath))
    throw new Error(`no ${CHEATSHEET}: it holds the hand-written part of the cheat sheet`);
  const miniGames = sources.miniGames ?? (await repoMiniGameDocs());
  const pages: Record<string, string> = {
    [CLI_PAGE]: cliPage(sources.registry),
    [SCHEMAS_PAGE]: schemasPage(root, sources.subjects, miniGames),
    [CHEATSHEET]: fillCheatsheet(readFileSync(cheatPath, 'utf8'), sources),
  };
  for (const m of miniGames) pages[m.page] = miniGamePage(m);
  for (const [file, text] of Object.entries(pages)) pages[file] = await prettierMarkdown(root, file, text);
  return pages;
}

/** Writes the generated pages under `root`; returns the paths that changed. */
export async function writeDocs(root: string, sources: DocSources): Promise<string[]> {
  const changed: string[] = [];
  for (const [file, text] of Object.entries(await generateDocs(root, sources))) {
    const abs = join(root, file);
    if (existsSync(abs) && readFileSync(abs, 'utf8') === text) continue;
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
    changed.push(file);
  }
  return changed;
}

/** A generated page that is not what is on disk. */
export interface StaleDoc {
  file: string;
  /** One line: missing, or the first differing line and how many lines differ. */
  summary: string;
}

/** The first line where `actual` and `expected` differ, and how many lines differ, as one summary. */
export function diffSummary(actual: string, expected: string): string {
  const a = actual.split('\n');
  const e = expected.split('\n');
  let first = -1;
  let count = 0;
  for (let i = 0; i < Math.max(a.length, e.length); i++) {
    if (a[i] === e[i]) continue;
    count++;
    if (first < 0) first = i;
  }
  const show = (line: string | undefined) => (line === undefined ? '(no line)' : JSON.stringify(line));
  return `${count} line${count === 1 ? ' differs' : 's differ'}; first at line ${first + 1}: has ${show(a[first])}, should be ${show(e[first])}`;
}

/** Regenerates in memory and compares with the files under `root`. Empty when the docs are current. */
export async function staleDocs(root: string, sources: DocSources): Promise<StaleDoc[]> {
  const stale: StaleDoc[] = [];
  for (const [file, text] of Object.entries(await generateDocs(root, sources))) {
    const abs = join(root, file);
    if (!existsSync(abs)) stale.push({ file, summary: 'missing' });
    else {
      const actual = readFileSync(abs, 'utf8');
      if (actual !== text) stale.push({ file, summary: diffSummary(actual, text) });
    }
  }
  return stale;
}
