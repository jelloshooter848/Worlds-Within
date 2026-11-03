import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { canonicalJson, type JsonValue } from '@engine/core/headless';
import { formatErrors, type ContentError } from '@engine/core/content/validate';
import { openContentFile, rereadContentFile, writeContentFile } from '../content-file';
import {
  addAt,
  blockLines,
  getAt,
  gridRegion,
  gridRuler,
  parseGridRegion,
  parsePath,
  parseValue,
  pasteBlock,
  removeAt,
  rulerText,
  setAt,
  spell,
  type Edit,
  type GridRect,
  type Segment,
} from '../content-path';
import { EXIT, UsageError } from '../exit-codes';
import { defineCommand, type Outcome } from '../registry';

/**
 * The editing verbs: `get`, `set`, `add` and `remove <file> <path> [value]`, one verb set for every
 * content file (formats in `content-file.ts`, path syntax in `content-path.ts`).
 *
 * A write is made on the parsed file, the whole edited file is checked against its kind's schema
 * (and the game is checked for new errors, such as an `id` that no longer matches its file name),
 * and only then written: an edit that would break the content is refused with exit 3
 * (`invalidContent`, with `errors`) and the file is not touched. After writing, the file is read
 * back from disk and parsed again; `verified: true` says it holds exactly the edited content.
 * Problems across files (a kind's `checkAll`, such as a door whose partner room has not been
 * edited yet) never refuse a write: they come back in `crossErrors`, for the next edit to fix.
 *
 * Write result: `{ file, kind, path, pointer, written, verified, changed, before, after,
 * crossErrors }`, where `path` and `pointer` name the edited place (for an `add` to an array, the
 * new item) and `before` / `after` are the value there (null when absent: `before` of an `add`,
 * `after` of a `remove`).
 *
 * Text maps (Engine 0.14, gap G10): `get <grid> rows --ruler` (or `rows.R1-R2`) adds a column
 * ruler, `get <grid> rows.R.C:R2.C2` copies a rectangle, and `paste <grid> rows.R.C <block>`
 * writes one, checked and verified like `set`.
 */

const fileArg = z
  .string()
  .min(1)
  .describe('the file: game.json, a content file, a text-grid part (.map.txt) or a run file');
const pathArg = z
  .string()
  .describe(
    'where in the file: dotted (frames.idle.2, legend["#"]) or a JSON pointer (/frames/idle/2); "" or . is the whole file',
  );
const valueArg = z
  .string()
  .describe('the value, as JSON ("5", "[1, 2]", "{\\"a\\": 1}"); text that is not JSON is taken as a string');

type Verb = 'set' | 'add' | 'remove';
type OpenFile = ReturnType<typeof openContentFile>;

/** One change to a file: the edit on `holder`, where it is, and how to read its result back. */
interface Change {
  holder: { root: JsonValue };
  edit: Edit;
  where: { path: string; pointer: string };
  /** The value at the edited place in the file read back from disk. */
  afterOf(onDisk: JsonValue): JsonValue | null;
  /** More fields for the result (a paste's `region`). */
  extra?: Record<string, unknown>;
}

/** Makes one edit with `set`, `add` or `remove`, and writes it (`writeChange`). */
function writeAt(verb: Verb, file: OpenFile, segments: Segment[], valueText?: string): Promise<Outcome> {
  const holder = { root: file.doc };
  // A removed place is not in the edited file, so its spelling comes from the file as it was.
  const removedAt = verb === 'remove' ? spell(segments, file.doc) : null;
  let edit: Edit;
  if (verb === 'set') edit = setAt(holder, segments, parseValue(valueText!));
  else if (verb === 'add') edit = addAt(holder, segments, parseValue(valueText!));
  else edit = removeAt(holder, segments);
  return writeChange(file, {
    holder,
    edit,
    where: removedAt ?? spell(edit.at, holder.root),
    afterOf: (onDisk) => (verb === 'remove' ? null : getAt(onDisk, edit.at)),
  });
}

/** Checks a changed file, writes it and reads it back. */
async function writeChange(file: OpenFile, change: Change): Promise<Outcome> {
  const { holder, edit, extra } = change;
  const base = { file: file.file, kind: file.kind, ...change.where, ...extra };

  const refuse = (errors: ContentError[]): Outcome => ({
    exit: EXIT.invalidContent,
    result: { ...base, written: false, verified: false, before: edit.before, after: edit.after, errors },
  });
  const rendered = await file.render(holder.root);
  if (!rendered.ok) return refuse(rendered.errors);
  const errors = file.check(rendered.text, holder.root);
  if (errors.length > 0) return refuse(errors);
  const crossErrors = file.crossErrors(rendered.text);

  writeContentFile(file, rendered.text);
  const reread = rereadContentFile(file);
  const onDisk = file.parse(reread);
  const verified = reread === rendered.text && canonicalJson(onDisk) === canonicalJson(holder.root);
  return {
    exit: verified ? EXIT.ok : EXIT.failedCheck,
    result: {
      ...base,
      written: true,
      verified,
      changed: reread !== file.text,
      before: edit.before,
      after: change.afterOf(onDisk),
      crossErrors,
    },
  };
}

/** The rows of a text-grid part file; any other file is a usage error naming what needs one. */
function gridRows(file: OpenFile, what: string): string[] {
  if (file.form !== 'grid')
    throw new UsageError(
      `${what} works on text-grid part files (such as rooms/hall.map.txt); ${file.file} is not one`,
    );
  return (file.doc as { rows: string[] }).rows;
}

/** `paste`: writes a block of lines over a grid from one cell, through the same checks as `set`. */
function pasteAt(file: OpenFile, at: string, block: string[], transparent?: string): Promise<Outcome> {
  const rows = gridRows(file, 'paste');
  const cell = /^rows\.(\d+)\.(\d+)$/.exec(at);
  if (!cell)
    throw new UsageError(`paste needs the block's top-left cell as rows.R.C, not ${JSON.stringify(at)}`);
  const [row, col] = [Number(cell[1]), Number(cell[2])];
  const pasted = pasteBlock(rows, row, col, block, transparent);
  const holder = { root: { rows: pasted.rows } as JsonValue };
  const rect = pasted.rect;
  const edit: Edit = {
    at: ['rows', String(row), String(col)],
    before: gridRegion(rows, rect),
    after: gridRegion(pasted.rows, rect),
  };
  return writeChange(file, {
    holder,
    edit,
    where: spell(edit.at, file.doc),
    afterOf: (onDisk) => gridRegion((onDisk as { rows: string[] }).rows, rect),
    extra: { region: rect },
  });
}

/**
 * A paste's block: the argument, or a file's lines (`--from-file`, or the argument `@path`). A
 * block that starts with a real `@` (a player start) is typed `\@...`.
 */
function readBlock(cwd: string, block: string | undefined, fromFile: string | undefined): string[] {
  if ((block === undefined) === (fromFile === undefined))
    throw new UsageError('paste takes a block: the <block> argument or --from-file <path>, not both');
  const path = fromFile ?? (block!.startsWith('@') ? block!.slice(1) : undefined);
  if (path === undefined) return blockLines(block!.startsWith('\\@') ? block!.slice(1) : block!, true);
  const abs = resolve(cwd, path);
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new UsageError(`no block file at ${path}`);
  return blockLines(readFileSync(abs, 'utf8'), false);
}

function writeText(result: Record<string, unknown>): string {
  const where = `${String(result.file)} ${String(result.path) || '(whole file)'}`;
  const errors = result.errors as ContentError[] | undefined;
  if (errors) return `${where}: refused, the file is unchanged\n${formatErrors(errors)}`;
  const show = (v: unknown) => JSON.stringify(v);
  const state = result.verified === true ? 'verified' : 'NOT verified: the file on disk differs';
  const region = result.region as GridRect | undefined;
  const line = region
    ? `${where}: pasted ${region.height} line(s) of ${region.width} (${state}, ${result.changed === true ? 'changed' : 'unchanged'})\n` +
      `before:\n${(result.before as string[]).join('\n')}\nafter:\n${(result.after as string[]).join('\n')}`
    : `${where}: ${show(result.before)} -> ${show(result.after)} (${state})`;
  const cross = (result.crossErrors as ContentError[] | undefined) ?? [];
  if (cross.length === 0) return line;
  return `${line}\nthe game is not valid yet (validate fails until another file is edited to match):\n${formatErrors(cross)}`;
}

export const getCommand = defineCommand({
  name: 'get',
  summary: 'read one value of a content file (path dotted or a JSON pointer); text-map rows with a ruler',
  args: z.strictObject({
    file: fileArg,
    path: pathArg.describe(
      'where in the file: dotted (frames.idle.2, legend["#"]) or a JSON pointer (/frames/idle/2); "" or . is the whole file; in a text grid also rows.R1-R2 (rows R1 to R2) and rows.R1.C1:R2.C2 (a rectangle, corners included)',
    ),
  }),
  flags: z.strictObject({
    ruler: z
      .boolean()
      .default(false)
      .describe(
        'text grids: show the rows (rows, rows.R1-R2 or a rectangle) under a column ruler, each with its row number',
      ),
  }),
  run({ args, flags }, ctx) {
    const file = openContentFile(ctx.cwd, args.file);
    const rows = file.form === 'grid' ? (file.doc as { rows: string[] }).rows : null;
    const rect = rows ? parseGridRegion(args.path, rows) : null;
    const base = { file: file.file, kind: file.kind };
    if (!rect && !flags.ruler) {
      const segments = parsePath(args.path);
      const value = getAt(file.doc, segments);
      return { exit: EXIT.ok, result: { ...base, ...spell(segments, file.doc), value } };
    }
    const all = gridRows(file, flags.ruler ? '--ruler' : 'a region (rows.R1-R2, rows.R.C:R2.C2)');
    let region = rect;
    if (!region) {
      if (parsePath(args.path).join('.') !== 'rows')
        throw new UsageError('--ruler shows rows: give rows, rows.R1-R2 or rows.R1.C1:R2.C2 as the path');
      if (all.length === 0) throw new UsageError(`${file.file} has no rows`);
      region = parseGridRegion(`rows.0-${all.length - 1}`, all)!;
    }
    const lines = gridRegion(all, region);
    return {
      exit: EXIT.ok,
      result: {
        ...base,
        path: args.path,
        pointer: null,
        value: lines,
        rows: lines,
        ruler: flags.ruler ? gridRuler(region.width, region.col) : null,
        width: region.width,
        height: region.height,
        firstRow: region.row,
        firstColumn: region.col,
      },
    };
  },
  text: (result) => {
    const rows = result.rows as string[] | undefined;
    if (!rows) return JSON.stringify(result.value, null, 2);
    if (result.ruler === null) return rows.join('\n');
    return rulerText(rows, result.firstRow as number, result.firstColumn as number);
  },
});

export const setCommand = defineCommand({
  name: 'set',
  summary: 'replace one value of a content file; checked, written, read back and verified',
  args: z.strictObject({ file: fileArg, path: pathArg, value: valueArg }),
  flags: z.strictObject({}),
  run: ({ args }, ctx) =>
    writeAt('set', openContentFile(ctx.cwd, args.file), parsePath(args.path), args.value),
  text: writeText,
});

export const addCommand = defineCommand({
  name: 'add',
  summary: 'append to an array, insert at an index (- is the end) or add a new key; verified like set',
  args: z.strictObject({ file: fileArg, path: pathArg, value: valueArg }),
  flags: z.strictObject({}),
  run: ({ args }, ctx) =>
    writeAt('add', openContentFile(ctx.cwd, args.file), parsePath(args.path), args.value),
  text: writeText,
});

export const removeCommand = defineCommand({
  name: 'remove',
  summary: 'delete a key or an array item of a content file; verified like set',
  args: z.strictObject({ file: fileArg, path: pathArg }),
  flags: z.strictObject({}),
  run: ({ args }, ctx) => writeAt('remove', openContentFile(ctx.cwd, args.file), parsePath(args.path)),
  text: writeText,
});

export const pasteCommand = defineCommand({
  name: 'paste',
  summary: 'write a block of lines over a text map from one cell; verified like set',
  args: z.strictObject({
    file: z.string().min(1).describe('the text-grid part file (.map.txt)'),
    at: z.string().describe("the block's top-left cell, rows.R.C (row R, column C)"),
    block: z
      .string()
      .optional()
      .describe(
        'the block: lines of equal width split by \\n (typed as two characters) or line breaks, or @path for a file holding them (\\@ for a block starting with a real @)',
      ),
  }),
  flags: z.strictObject({
    fromFile: z.string().optional().describe('read the block from this file instead of the <block> argument'),
    transparent: z
      .string()
      .length(1)
      .optional()
      .describe(
        'a block character that leaves the cell under it as it is (default: none, every cell is written)',
      ),
  }),
  run: ({ args, flags }, ctx) => {
    const file = openContentFile(ctx.cwd, args.file);
    gridRows(file, 'paste');
    return pasteAt(file, args.at, readBlock(ctx.cwd, args.block, flags.fromFile), flags.transparent);
  },
  text: writeText,
});
