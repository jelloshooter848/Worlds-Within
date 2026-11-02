import { z } from 'zod';
import { canonicalJson, type JsonValue } from '@engine/core/headless';
import { formatErrors, type ContentError } from '@engine/core/content/validate';
import { openContentFile, rereadContentFile, writeContentFile } from '../content-file';
import {
  addAt,
  getAt,
  parsePath,
  parseValue,
  removeAt,
  setAt,
  spell,
  type Edit,
  type Segment,
} from '../content-path';
import { EXIT } from '../exit-codes';
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

/** Makes one edit, checks it, writes it and reads it back. */
async function writeAt(
  verb: Verb,
  file: ReturnType<typeof openContentFile>,
  segments: Segment[],
  valueText?: string,
): Promise<Outcome> {
  const holder = { root: file.doc };
  // A removed place is not in the edited file, so its spelling comes from the file as it was.
  const removedAt = verb === 'remove' ? spell(segments, file.doc) : null;
  let edit: Edit;
  if (verb === 'set') edit = setAt(holder, segments, parseValue(valueText!));
  else if (verb === 'add') edit = addAt(holder, segments, parseValue(valueText!));
  else edit = removeAt(holder, segments);
  const where = removedAt ?? spell(edit.at, holder.root);
  const base = { file: file.file, kind: file.kind, ...where };

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
  const after: JsonValue | null = verb === 'remove' ? null : getAt(onDisk, edit.at);
  return {
    exit: verified ? EXIT.ok : EXIT.failedCheck,
    result: {
      ...base,
      written: true,
      verified,
      changed: reread !== file.text,
      before: edit.before,
      after,
      crossErrors,
    },
  };
}

function writeText(result: Record<string, unknown>): string {
  const where = `${String(result.file)} ${String(result.path) || '(whole file)'}`;
  const errors = result.errors as ContentError[] | undefined;
  if (errors) return `${where}: refused, the file is unchanged\n${formatErrors(errors)}`;
  const show = (v: unknown) => JSON.stringify(v);
  const state = result.verified === true ? 'verified' : 'NOT verified: the file on disk differs';
  const line = `${where}: ${show(result.before)} -> ${show(result.after)} (${state})`;
  const cross = (result.crossErrors as ContentError[] | undefined) ?? [];
  if (cross.length === 0) return line;
  return `${line}\nthe game is not valid yet (validate fails until another file is edited to match):\n${formatErrors(cross)}`;
}

export const getCommand = defineCommand({
  name: 'get',
  summary: 'read one value of a content file (path dotted or a JSON pointer)',
  args: z.strictObject({ file: fileArg, path: pathArg }),
  flags: z.strictObject({}),
  run({ args }, ctx) {
    const file = openContentFile(ctx.cwd, args.file);
    const segments = parsePath(args.path);
    const value = getAt(file.doc, segments);
    return {
      exit: EXIT.ok,
      result: { file: file.file, kind: file.kind, ...spell(segments, file.doc), value },
    };
  },
  text: (result) => JSON.stringify(result.value, null, 2),
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
