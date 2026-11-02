import type { z } from 'zod';
import { gridRows } from './text-grid';
import {
  contentError,
  jsonPointer,
  validate,
  type ContentError,
  type ContentResult,
  type FieldPath,
} from './validate';

/**
 * Content-file kinds: each kind of content file (a song, a sprite, a room...) names its schema and
 * how to read its text. JSON files are read with `JSON.parse`; a kind that also has a text format
 * (`.txt`, such as text-grid pixel art) gives a reader that turns the text into the plain object
 * the schema checks. Nothing here touches the file system: callers pass the file name and text.
 */

/** Where a field came from in a `.txt` file: JSON pointer -> 1-based line. */
export type LineMap = Readonly<Record<string, number>>;

export type TextReadResult =
  { ok: true; data: unknown; lines?: LineMap } | { ok: false; errors: Omit<ContentError, 'file'>[] };

/**
 * A problem a kind's {@link ContentKind.checkAll} finds across its files: in the file of the entry
 * called `name`, at the field `path` (a field kept in a grid part, such as `['map', 3]`, names the
 * part file and its line).
 */
export interface KindIssue {
  name: string;
  path: FieldPath;
  code: string;
  message: string;
  row?: number;
  col?: number;
}

/** What a kind's `.txt` writer gives: the new text, or why the data has no text form. */
export type TextWriteResult = { ok: true; text: string } | { ok: false; message: string };

export interface ContentKind<S extends z.ZodType = z.ZodType> {
  /** Short name, such as `song` or `sprite`. */
  name: string;
  /** One line for docs and CLI help. */
  description: string;
  schema: S;
  /** Reads the kind's `.txt` format. Kinds without one accept only `.json`. */
  readText?: (text: string) => TextReadResult;
  /**
   * Writes data (already checked by `schema`, in the shape `readText` gives) back in the kind's
   * `.txt` format, for the CLI's editing verbs. `previous` is the file's old text, so the writer
   * can keep what the data does not hold (a leading comment). Kinds without one are read-only as
   * `.txt`.
   */
  writeText?: (data: unknown, previous: string) => TextWriteResult;
  /**
   * Fields kept in a sibling text-grid file next to a `.json` file: field -> file suffix. With
   * `{ map: '.map.txt' }`, `rooms/hall.map.txt` is read (as rows, see `gridRows`) into the `map`
   * field of `rooms/hall.json`, and errors in that field name the `.map.txt` file and its line.
   */
  gridParts?: Readonly<Record<string, string>>;
  /**
   * Checks across every file of the kind, once each has passed its schema (the loader runs it only
   * when the game has no other errors): rooms whose doors must line up, one player start. Each
   * problem names the entry (`name`, the file name) and the field it is about.
   */
  checkAll?(entries: readonly { name: string; value: z.output<S> }[], others: ContentLookup): KindIssue[];
}

/**
 * The game's other checked content, for a kind's `checkAll` that checks references across kinds
 * (a skin naming sprites and sounds): `others('sprite')` is every sprite entry, by file name. A
 * kind the game does not claim gives none.
 */
export type ContentLookup = (kind: string) => readonly { name: string; value: unknown }[];

/** A sibling file holding one field of a content file (see {@link ContentKind.gridParts}). */
export interface ContentPart {
  file: string;
  text: string;
}

/** The sibling file of `fileName` (a `.json` file) for a part suffix: `a/hall.json` -> `a/hall.map.txt`. */
export function partFileName(fileName: string, suffix: string): string {
  return fileName.replace(/\.json$/i, '') + suffix;
}

/** How many blank lines `gridRows` drops from the start of `text` (so row N sits on line N + this + 1). */
function leadingBlankLines(text: string): number {
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length && lines[i]!.trim() === '') i++;
  return i;
}

export type Extension = '.json' | '.txt';

/** The extension content code cares about, or null for anything else. */
export function extensionOf(fileName: string): Extension | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.json')) return '.json';
  if (lower.endsWith('.txt')) return '.txt';
  return null;
}

/** The line a field came from: the longest pointer in `lines` that is the field or one of its parents. */
function lineFor(pointer: string, lines: LineMap): number | undefined {
  let best: string | undefined;
  for (const key of Object.keys(lines)) {
    const covers = key === pointer || key === '' || pointer.startsWith(`${key}/`);
    if (covers && (best === undefined || key.length > best.length)) best = key;
  }
  return best === undefined ? undefined : lines[best];
}

/**
 * Reads and checks one content file of a known kind. Bad JSON, a bad `.txt` file, an extension the
 * kind cannot read, and schema failures all come back as errors naming the file and the field.
 * `parts` holds the text of sibling files for the kind's `gridParts`, by field; an error in such a
 * field names the sibling file (and, for a row, its line).
 */
export function parseContent<S extends z.ZodType>(
  kind: ContentKind<S>,
  fileName: string,
  text: string,
  parts: Readonly<Record<string, ContentPart>> = {},
): ContentResult<z.output<S>> {
  const ext = extensionOf(fileName);
  let data: unknown;
  let lines: LineMap | undefined;
  if (ext === '.json') {
    try {
      data = JSON.parse(text);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      return { ok: false, errors: [contentError(fileName, [], 'invalid_json', `not valid JSON: ${why}`)] };
    }
    const merged = mergeParts(fileName, data, parts);
    if (!merged.ok) return { ok: false, errors: merged.errors };
    data = merged.data;
  } else if (ext === '.txt' && kind.readText) {
    const read = kind.readText(text);
    if (!read.ok) return { ok: false, errors: read.errors.map((e) => ({ file: fileName, ...e })) };
    data = read.data;
    lines = read.lines;
  } else {
    const can = kind.readText ? '.json or .txt' : '.json';
    const msg = `a ${kind.name} file must be ${can}`;
    return { ok: false, errors: [contentError(fileName, [], 'unsupported_extension', msg)] };
  }
  const result = validate(fileName, data, kind.schema);
  if (result.ok) return result;
  if (Object.keys(parts).length > 0) return { ok: false, errors: result.errors.map((e) => inPart(e, parts)) };
  if (lines === undefined) return result;
  const map = lines;
  return {
    ok: false,
    errors: result.errors.map((e) => {
      const line = lineFor(e.pointer, map);
      return line === undefined ? e : { ...e, line };
    }),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Puts each part's rows into its field; a field given in both places is a `duplicate_field` error. */
function mergeParts(
  fileName: string,
  data: unknown,
  parts: Readonly<Record<string, ContentPart>>,
): { ok: true; data: unknown } | { ok: false; errors: ContentError[] } {
  const fields = Object.keys(parts);
  if (fields.length === 0 || !isRecord(data)) return { ok: true, data };
  const errors: ContentError[] = [];
  const out: Record<string, unknown> = { ...data };
  for (const field of fields) {
    const part = parts[field]!;
    if (Object.hasOwn(data, field)) {
      const msg = `"${field}" is given both here and in ${part.file}; keep one`;
      errors.push(contentError(fileName, [field], 'duplicate_field', msg));
      continue;
    }
    out[field] = gridRows(part.text);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, data: out };
}

/** Re-points an error in a part's field at the part file, with the line of the row it names. */
export function inPart(e: ContentError, parts: Readonly<Record<string, ContentPart>>): ContentError {
  for (const [field, part] of Object.entries(parts)) {
    const top = jsonPointer([field]);
    if (e.pointer !== top && !e.pointer.startsWith(`${top}/`)) continue;
    const row = /^\/(\d+)/.exec(e.pointer.slice(top.length));
    const out: ContentError = { ...e, file: part.file };
    if (row) out.line = leadingBlankLines(part.text) + Number(row[1]) + 1;
    return out;
  }
  return e;
}

/** A registry of kinds by name. Engine kinds come from `engineContentKinds()`; games add their own. */
export class ContentKinds {
  private readonly kinds = new Map<string, ContentKind>();

  /** Adds a kind; a second kind with the same name is an error. Returns `this` for chaining. */
  register(kind: ContentKind): this {
    if (this.kinds.has(kind.name)) throw new Error(`content kind "${kind.name}" is already registered`);
    this.kinds.set(kind.name, kind);
    return this;
  }

  has(name: string): boolean {
    return this.kinds.has(name);
  }

  get(name: string): ContentKind | undefined {
    return this.kinds.get(name);
  }

  /** Every kind, sorted by name (so listings are stable). */
  list(): ContentKind[] {
    return [...this.kinds.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  /** Reads and checks one file as the named kind; an unknown kind is an `unknown_kind` error. */
  parse(name: string, fileName: string, text: string): ContentResult<unknown> {
    const kind = this.kinds.get(name);
    if (!kind) {
      const known = this.list()
        .map((k) => k.name)
        .join(', ');
      const msg = `unknown content kind "${name}" (known: ${known || 'none'})`;
      return { ok: false, errors: [contentError(fileName, [], 'unknown_kind', msg)] };
    }
    return parseContent(kind, fileName, text);
  }
}
