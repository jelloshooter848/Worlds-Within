import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { canonicalJson, type JsonValue } from '@engine/core/headless';
import { globToRegExp } from '@engine/core/content/bundle';
import {
  extensionOf,
  parseContent,
  partFileName,
  type ContentKind,
  type ContentPart,
} from '@engine/core/content/kinds';
import { gameManifestSchema, MANIFEST_FILE } from '@engine/core/content/manifest';
import { gridRows } from '@engine/core/content/text-grid';
import { contentError, validate, type ContentError } from '@engine/core/content/validate';
import { readGameFiles } from '@engine/core/node/game-files';
import { UsageError } from './exit-codes';
import { checkGameTexts, gameKinds } from './game-loader';
import { readJson, writeJson } from './json-format';
import { runFileSchema } from './run-file';

/**
 * One editable file for the editing verbs: where it is, what kind it is, how its text turns into a
 * JSON tree to edit and back, and how a new text is checked before it is written.
 *
 * Editable files are a game's `game.json`, its content files (as `game.json` claims them: JSON, or
 * a kind's `.txt` form when the kind can write it), the text-grid part files next to them (such as
 * `rooms/hall.map.txt`, edited as `{ rows: [...] }`), and run files (`*.run.json`).
 */

export type FileForm =
  /** JSON, written with the repo's Prettier settings. */
  | 'json'
  /** A text-grid part file: the tree is `{ rows: string[] }`, one row per line. */
  | 'grid'
  /** A kind's own `.txt` format, read with `readText` and written with `writeText`. */
  | 'text';

export interface ContentFile {
  /** Absolute path. */
  abs: string;
  /** The path relative to the working folder, with `/` (as errors name it). */
  file: string;
  /** The kind: a content kind's name, `manifest` (`game.json`) or `run` (a run file). */
  kind: string;
  form: FileForm;
  text: string;
  /** The parsed tree, and for JSON the objects spread over lines (see `json-format.ts`). */
  doc: JsonValue;
  expanded: WeakSet<object>;
  /** Checks a new text: the errors that would make it invalid, empty when it may be written. */
  check(text: string, doc: JsonValue): ContentError[];
  /**
   * The cross-file problems (each kind's `checkAll`, such as the top-down rooms' `invalid_dungeon`)
   * the game has with the new text. They never stop a write: a change to how rooms connect needs
   * edits to two files, and the game is broken between them. `validate` and `run` still fail on them.
   */
  crossErrors(text: string): ContentError[];
  /** The text for an edited tree, or the errors that stop it being written. */
  render(doc: JsonValue): Promise<{ ok: true; text: string } | { ok: false; errors: ContentError[] }>;
  /** Parses a text in this file's form (to read a written file back). */
  parse(text: string): JsonValue;
}

const gridDocSchema = z.strictObject({
  rows: z.array(
    z.string().refine((row) => !/[\r\n]/.test(row), {
      message: 'a row is one line: no line breaks',
      params: { code: 'multiline_row' },
    }),
  ),
});

/** The nearest folder at or above `dir` holding a `game.json`, or null. */
function gameFolderOf(dir: string): string | null {
  for (let at = dir; ; at = dirname(at)) {
    if (existsSync(join(at, MANIFEST_FILE))) return at;
    if (dirname(at) === at) return null;
  }
}

const slash = (p: string) => p.replaceAll('\\', '/');

/** A key for an error, to tell new errors from ones the game already had. */
const errorKey = (e: ContentError) => `${e.file}\u0000${e.pointer}\u0000${e.code}\u0000${e.message}`;

function uniqueErrors(errors: ContentError[]): ContentError[] {
  const seen = new Set<string>();
  return errors.filter((e) => {
    const key = errorKey(e);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseJsonText(file: string, text: string): JsonValue {
  try {
    return JSON.parse(text) as JsonValue;
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    throw new UsageError(`${file} is not valid JSON (${why}); fix it by hand first`);
  }
}

/** Opens `path` (relative to `cwd`) for editing. Anything that cannot be edited is a usage error. */
export function openContentFile(cwd: string, path: string): ContentFile {
  const abs = resolve(cwd, path);
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new UsageError(`no file at ${path}`);
  const file = slash(relative(cwd, abs));
  const text = readFileSync(abs, 'utf8');

  if (abs.endsWith('.run.json')) {
    parseJsonText(file, text);
    return jsonFile(
      abs,
      file,
      'run',
      text,
      (newText) => {
        const result = validate(file, JSON.parse(newText), runFileSchema);
        return result.ok ? [] : result.errors;
      },
      () => [],
    );
  }

  const gameAbs = gameFolderOf(dirname(abs));
  if (gameAbs === null)
    throw new UsageError(`${path} is not in a game folder (no ${MANIFEST_FILE} above it)`);
  const gameDir = slash(relative(cwd, gameAbs)) || '.';
  const root = gameDir === '.' ? '' : `${gameDir}/`;
  const rel = slash(relative(gameAbs, abs));
  const texts = readGameFiles(gameAbs);
  if (texts[rel] === undefined) {
    throw new UsageError(
      `${path} is not a content file: only ${MANIFEST_FILE}, files under content/ and run files can be edited`,
    );
  }
  // Cross-file checks are left out here: they are reported by `crossErrors`, never refused.
  const before = checkGameTexts(texts, root, { checkAll: false });
  const beforeKeys = new Set(before.ok ? [] : before.errors.map(errorKey));
  /** Errors the edited game would have that it does not have now (cross-file checks aside). */
  const newGameErrors = (newText: string): ContentError[] => {
    const after = checkGameTexts({ ...texts, [rel]: newText }, root, { checkAll: false });
    return after.ok ? [] : after.errors.filter((e) => !beforeKeys.has(errorKey(e)));
  };
  /** The cross-file problems of the edited game, once it has no other error. */
  const crossErrors = (newText: string): ContentError[] => {
    const edited = { ...texts, [rel]: newText };
    if (!checkGameTexts(edited, root, { checkAll: false }).ok) return [];
    const after = checkGameTexts(edited, root);
    return after.ok ? [] : after.errors;
  };

  if (rel === MANIFEST_FILE) {
    parseJsonText(file, text);
    return jsonFile(
      abs,
      file,
      'manifest',
      text,
      (newText) => {
        const own = validate(file, JSON.parse(newText), gameManifestSchema);
        return uniqueErrors([...(own.ok ? [] : own.errors), ...newGameErrors(newText)]);
      },
      crossErrors,
    );
  }

  const manifest = validate(`${root}${MANIFEST_FILE}`, JSON.parse(texts[MANIFEST_FILE]!), gameManifestSchema);
  if (!manifest.ok) {
    throw new UsageError(
      `${root}${MANIFEST_FILE} is not valid, so the kind of ${path} is unknown: fix it first`,
    );
  }
  const { kinds } = gameKinds(texts[MANIFEST_FILE], root);
  /** The kind whose patterns in game.json claim `p`. */
  const kindOf = (p: string): ContentKind | undefined => {
    for (const [name, patterns] of Object.entries(manifest.value.content)) {
      if (patterns.some((pattern) => globToRegExp(pattern).test(p))) return kinds.get(name);
    }
    return undefined;
  };
  const partsOf = (kind: ContentKind, p: string, override?: { field: string; text: string }) => {
    const parts: Record<string, ContentPart> = {};
    for (const [field, suffix] of Object.entries(kind.gridParts ?? {})) {
      if (!/\.json$/i.test(p)) continue;
      const partPath = partFileName(p, suffix);
      const partText = override?.field === field ? override.text : texts[partPath];
      if (partText !== undefined) parts[field] = { file: `${root}${partPath}`, text: partText };
    }
    return parts;
  };

  const kind = kindOf(rel);
  if (kind) {
    const own = (newText: string) => {
      const result = parseContent(kind, file, newText, partsOf(kind, rel));
      return result.ok ? [] : result.errors;
    };
    const check = (newText: string) => uniqueErrors([...own(newText), ...newGameErrors(newText)]);
    if (extensionOf(rel) === '.json') {
      parseJsonText(file, text);
      return jsonFile(abs, file, kind.name, text, check, crossErrors);
    }
    return textFile(abs, file, kind, text, check, crossErrors);
  }

  // A text-grid part of a claimed `.json` file.
  for (const p of Object.keys(texts)) {
    const owner = kindOf(p);
    for (const [field, suffix] of Object.entries(owner?.gridParts ?? {})) {
      if (!owner || !/\.json$/i.test(p) || partFileName(p, suffix) !== rel) continue;
      const check = (newText: string, doc: JsonValue) => {
        const shape = validate(file, doc, gridDocSchema);
        if (!shape.ok) return shape.errors;
        const result = parseContent(
          owner,
          `${root}${p}`,
          texts[p]!,
          partsOf(owner, p, { field, text: newText }),
        );
        return uniqueErrors([...(result.ok ? [] : result.errors), ...newGameErrors(newText)]);
      };
      return gridFile(abs, file, owner.name, text, check, crossErrors);
    }
  }
  throw new UsageError(
    `no content kind in ${root}${MANIFEST_FILE} claims ${path}, so it has no schema to edit it by`,
  );
}

function jsonFile(
  abs: string,
  file: string,
  kind: string,
  text: string,
  check: (text: string) => ContentError[],
  crossErrors: (text: string) => ContentError[],
): ContentFile {
  const { value, expanded } = readJson(text);
  return {
    abs,
    file,
    kind,
    form: 'json',
    text,
    doc: value,
    expanded,
    check,
    crossErrors,
    async render(doc) {
      return { ok: true, text: await writeJson(doc, expanded, abs) };
    },
    parse: (t) => JSON.parse(t) as JsonValue,
  };
}

function gridFile(
  abs: string,
  file: string,
  kind: string,
  text: string,
  check: (text: string, doc: JsonValue) => ContentError[],
  crossErrors: (text: string) => ContentError[],
): ContentFile {
  const parse = (t: string): JsonValue => ({ rows: gridRows(t) });
  return {
    abs,
    file,
    kind,
    form: 'grid',
    text,
    doc: parse(text),
    expanded: new WeakSet(),
    check,
    crossErrors,
    render(doc) {
      const shape = validate(file, doc, gridDocSchema);
      if (!shape.ok) return Promise.resolve({ ok: false, errors: shape.errors });
      return Promise.resolve({ ok: true, text: `${shape.value.rows.join('\n')}\n` });
    },
    parse,
  };
}

function textFile(
  abs: string,
  file: string,
  kind: ContentKind,
  text: string,
  check: (text: string) => ContentError[],
  crossErrors: (text: string) => ContentError[],
): ContentFile {
  const parse = (t: string): JsonValue => {
    const read = kind.readText!(t);
    if (!read.ok) throw new UsageError(`${file} does not read as a ${kind.name} file; fix it by hand first`);
    return read.data as JsonValue;
  };
  return {
    abs,
    file,
    kind: kind.name,
    form: 'text',
    text,
    doc: parse(text),
    expanded: new WeakSet(),
    check,
    crossErrors,
    render(doc) {
      if (!kind.writeText) {
        throw new UsageError(`${kind.name} .txt files cannot be written by the CLI; edit ${file} by hand`);
      }
      // The writer takes schema-checked data, so check the tree first.
      const shape = validate(file, doc, kind.schema);
      if (!shape.ok) return Promise.resolve({ ok: false, errors: shape.errors });
      const written = kind.writeText(doc, text);
      if (!written.ok) {
        return Promise.resolve({
          ok: false,
          errors: [contentError(file, [], 'not_writable', written.message)],
        });
      }
      // The text must read back as the same tree, or the text form cannot hold the edit.
      const back = kind.readText!(written.text);
      if (!back.ok || canonicalJson(back.data) !== canonicalJson(doc)) {
        const msg = `the edit has no exact ${kind.name} text form (it would not read back the same)`;
        return Promise.resolve({ ok: false, errors: [contentError(file, [], 'not_writable', msg)] });
      }
      return Promise.resolve({ ok: true, text: written.text });
    },
    parse,
  };
}

/** Writes `text` to the file. */
export function writeContentFile(file: ContentFile, text: string): void {
  writeFileSync(file.abs, text, 'utf8');
}

/** Reads the file back from disk. */
export function rereadContentFile(file: ContentFile): string {
  return readFileSync(file.abs, 'utf8');
}
