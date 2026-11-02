import type { JsonValue } from '@engine/core/headless';
import { dottedPath, jsonPointer } from '@engine/core/content/validate';
import { UsageError } from './exit-codes';

/**
 * Paths into a content file, for the editing verbs (`get`, `set`, `add`, `remove`), and the edits
 * themselves on a parsed file.
 *
 * Two spellings, the same as a `ContentError`'s `path` and `pointer`:
 *
 * - dotted: `frames.idle.2`, `content.room.0`, `legend["#"]` (a key that is not a plain name, or
 *   holds a `.`, goes in `["..."]` as a JSON string; `[2]` is the same as `.2`);
 * - a JSON pointer (RFC 6901), starting with `/`: `/frames/idle/2`, `/legend/#` (`~1` is `/`,
 *   `~0` is `~`).
 *
 * `''` or `.` is the whole file. A number picks an array item; after a string it picks one
 * character, so `rows.3.5` is the cell in column 5 of row 3 of a text grid (a cell can only be
 * read or set, to one character). In `add`, `-` as the last part means the end of an array.
 */

export type Segment = string;

/** Parses a path in either spelling into its parts. A malformed path is a usage error. */
export function parsePath(path: string): Segment[] {
  if (path === '' || path === '.') return [];
  if (path.startsWith('/')) {
    return path
      .slice(1)
      .split('/')
      .map((part) => {
        if (/~(?![01])/.test(part)) throw new UsageError(`bad JSON pointer ${path}: "~" must be ~0 or ~1`);
        return part.replaceAll('~1', '/').replaceAll('~0', '~');
      });
  }
  const out: Segment[] = [];
  let i = 0;
  const bad = (why: string) => new UsageError(`bad path ${JSON.stringify(path)}: ${why}`);
  while (i < path.length) {
    if (path[i] === '[') {
      const close = path.indexOf(']', path[i + 1] === '"' ? closingQuote(path, i + 1, bad) : i);
      if (close < 0) throw bad('a "[" is not closed');
      const inner = path.slice(i + 1, close);
      if (/^\d+$/.test(inner)) out.push(inner);
      else if (inner.startsWith('"')) {
        try {
          out.push(JSON.parse(inner) as string);
        } catch {
          throw bad(`${inner} is not a JSON string`);
        }
      } else throw bad(`[${inner}] must be a number or a JSON string`);
      i = close + 1;
      if (i < path.length && path[i] === '.') {
        i++;
        if (i === path.length) throw bad('it ends with "."');
      }
      continue;
    }
    let end = i;
    while (end < path.length && path[end] !== '.' && path[end] !== '[') end++;
    const key = path.slice(i, end);
    if (key === '') throw bad('an empty part (two dots, or a leading dot)');
    out.push(key);
    i = end;
    if (path[i] === '.') {
      i++;
      if (i === path.length) throw bad('it ends with "."');
    }
  }
  return out;
}

/** The index just past the JSON string starting at `start` (a `"`). */
function closingQuote(path: string, start: number, bad: (why: string) => UsageError): number {
  for (let i = start + 1; i < path.length; i++) {
    if (path[i] === '\\') i++;
    else if (path[i] === '"') return i + 1;
  }
  throw bad('a quoted key is not closed');
}

/** Array indexes and string cells are numbers in errors and results; keys stay strings. */
function asFieldPath(segments: readonly Segment[], doc: JsonValue): (string | number)[] {
  const out: (string | number)[] = [];
  let at: JsonValue | undefined = doc;
  for (const s of segments) {
    const indexed = (Array.isArray(at) || typeof at === 'string') && /^\d+$/.test(s);
    out.push(indexed ? Number(s) : s);
    at = step(at, s);
  }
  return out;
}

/** The path as the results spell it: `{ path: dotted, pointer }`. */
export function spell(segments: readonly Segment[], doc: JsonValue): { path: string; pointer: string } {
  const field = asFieldPath(segments, doc);
  return { path: dottedPath(field), pointer: jsonPointer(field) };
}

function isObject(v: JsonValue | undefined): v is { [key: string]: JsonValue } {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function index(s: Segment): number | undefined {
  return /^(0|[1-9]\d*)$/.test(s) ? Number(s) : undefined;
}

/** One step down, or undefined when there is nothing there. */
function step(at: JsonValue | undefined, s: Segment): JsonValue | undefined {
  if (Array.isArray(at)) {
    const i = index(s);
    return i === undefined ? undefined : at[i];
  }
  if (typeof at === 'string') {
    const i = index(s);
    return i === undefined ? undefined : [...at][i];
  }
  if (isObject(at) && Object.hasOwn(at, s)) return at[s];
  return undefined;
}

function describe(v: JsonValue | undefined): string {
  if (Array.isArray(v)) return `an array of ${v.length}`;
  if (v === null) return 'null';
  if (typeof v === 'string') return `a string of ${[...v].length} character(s)`;
  return typeof v === 'object' ? 'an object' : `a ${typeof v}`;
}

/** Why `s` is not under `at`, for a usage error. */
function missing(
  segments: readonly Segment[],
  depth: number,
  at: JsonValue | undefined,
  doc: JsonValue,
): UsageError {
  const where = depth === 0 ? 'the file' : spell(segments.slice(0, depth), doc).path;
  const s = segments[depth]!;
  let hint = '';
  if (isObject(at)) {
    const keys = Object.keys(at);
    const shown = keys.slice(0, 20).join(', ');
    hint =
      keys.length === 0 ? ' (it has no keys)' : ` (its keys: ${shown}${keys.length > 20 ? ', ...' : ''})`;
  } else if (Array.isArray(at) || typeof at === 'string') {
    const n = Array.isArray(at) ? at.length : [...at].length;
    hint = ` (indexes 0 to ${n - 1})`;
  }
  return new UsageError(`no value at ${JSON.stringify(s)} in ${where}, which is ${describe(at)}${hint}`);
}

/** The value at `segments`; a path that is not there is a usage error naming where it stops. */
export function getAt(doc: JsonValue, segments: readonly Segment[]): JsonValue {
  let at: JsonValue = doc;
  segments.forEach((s, depth) => {
    const next = step(at, s);
    if (next === undefined) throw missing(segments, depth, at, doc);
    at = next;
  });
  return at;
}

/** What one edit did: where (`at`), and the value there before and after (null when absent). */
export interface Edit {
  /** The edited place: for an `add` to an array, the new item's index. */
  at: Segment[];
  before: JsonValue | null;
  after: JsonValue | null;
}

function replaceCell(row: string, i: number, value: JsonValue): string {
  if (typeof value !== 'string' || [...value].length !== 1)
    throw new UsageError(`a cell is one character; got ${JSON.stringify(value)}`);
  const cells = [...row];
  cells[i] = value;
  return cells.join('');
}

/** Holds the document so the root itself can be replaced. */
interface Holder {
  root: JsonValue;
}

/** The container of the last part, and the holder for setting a string cell's row. */
function parentOf(holder: Holder, segments: readonly Segment[]): JsonValue {
  return getAt(holder.root, segments.slice(0, -1));
}

/** Writes `value` into `parent` at `key` (an existing place); a string parent writes back its row. */
function put(holder: Holder, segments: readonly Segment[], value: JsonValue): void {
  const parent = parentOf(holder, segments);
  const key = segments[segments.length - 1]!;
  if (Array.isArray(parent)) parent[index(key)!] = value;
  else if (isObject(parent)) parent[key] = value;
  else if (typeof parent === 'string')
    put(holder, segments.slice(0, -1), replaceCell(parent, index(key)!, value));
}

/** `set`: replaces the value at an existing path (the whole file for `''`). Edits `holder` in place. */
export function setAt(holder: Holder, segments: readonly Segment[], value: JsonValue): Edit {
  const before = getAt(holder.root, segments);
  if (segments.length === 0) holder.root = value;
  else put(holder, segments, value);
  return { at: [...segments], before, after: getAt(holder.root, segments) };
}

/**
 * `add`: appends `value` to the array at `segments`; or inserts it into an array at an index from
 * 0 to its length (`-` is the end); or adds a key an object does not have yet.
 */
export function addAt(holder: Holder, segments: readonly Segment[], value: JsonValue): Edit {
  const target = segments.length === 0 ? holder.root : step(parentOf(holder, segments), segments.at(-1)!);
  if (Array.isArray(target)) {
    target.push(value);
    return { at: [...segments, String(target.length - 1)], before: null, after: value };
  }
  if (segments.length === 0) throw new UsageError('add needs a path to an array, or to a new key or index');
  const parent = parentOf(holder, segments);
  const key = segments.at(-1)!;
  const where = segments.length === 1 ? 'the file' : spell(segments.slice(0, -1), holder.root).path;
  if (Array.isArray(parent)) {
    const i = key === '-' ? parent.length : index(key);
    if (i === undefined || i > parent.length)
      throw new UsageError(`add into ${where}: the index must be 0 to ${parent.length}, or "-" for the end`);
    parent.splice(i, 0, value);
    return { at: [...segments.slice(0, -1), String(i)], before: null, after: value };
  }
  if (isObject(parent)) {
    if (Object.hasOwn(parent, key))
      throw new UsageError(
        `${spell(segments, holder.root).path} is already there and is not an array; use set`,
      );
    parent[key] = value;
    return { at: [...segments], before: null, after: value };
  }
  if (typeof parent === 'string')
    throw new UsageError(`${where} is a string: a cell can only be set (a row's width is fixed)`);
  throw new UsageError(`add into ${where}: it is ${describe(parent)}, not an array or an object`);
}

/** `remove`: deletes a key from an object or an item from an array. */
export function removeAt(holder: Holder, segments: readonly Segment[]): Edit {
  if (segments.length === 0) throw new UsageError('remove needs a path: the whole file cannot be removed');
  const before = getAt(holder.root, segments);
  const parent = parentOf(holder, segments);
  const key = segments.at(-1)!;
  if (Array.isArray(parent)) parent.splice(index(key)!, 1);
  else if (isObject(parent)) delete parent[key];
  else throw new UsageError("a cell can only be set (a row's width is fixed); remove the row or set it");
  return { at: [...segments], before, after: null };
}

/** A command-line value: JSON when it parses, else the text itself as a string. */
export function parseValue(text: string): JsonValue {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return text;
  }
}
