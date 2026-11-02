import type { z } from 'zod';
import { contentError, validate, type ContentError, type ContentResult } from './validate';

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

export interface ContentKind<S extends z.ZodType = z.ZodType> {
  /** Short name, such as `song` or `sprite`. */
  name: string;
  /** One line for docs and CLI help. */
  description: string;
  schema: S;
  /** Reads the kind's `.txt` format. Kinds without one accept only `.json`. */
  readText?: (text: string) => TextReadResult;
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
 */
export function parseContent<S extends z.ZodType>(
  kind: ContentKind<S>,
  fileName: string,
  text: string,
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
  if (result.ok || lines === undefined) return result;
  const map = lines;
  return {
    ok: false,
    errors: result.errors.map((e) => {
      const line = lineFor(e.pointer, map);
      return line === undefined ? e : { ...e, line };
    }),
  };
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
