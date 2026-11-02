import type { z } from 'zod';

/**
 * One problem with one content file, in a shape that stays the same whatever produced it (a Zod
 * schema, the text-grid parser or a `.txt` reader), so tools can print it, count it or match it.
 */
export interface ContentError {
  /** The file name the caller passed in, unchanged (usually a repo path). */
  file: string;
  /** The field, dotted: `frames.idle.2`, `pulse1`; `''` for the whole file. */
  path: string;
  /** The same field as a JSON pointer (RFC 6901): `/frames/idle/2`; `''` for the whole file. */
  pointer: string;
  message: string;
  /**
   * What kind of problem: a Zod issue code (`invalid_type`, `unrecognized_keys`, `too_small`, ...)
   * or one of the content codes (`ragged_row`, `unknown_char`, `invalid_mml`, `invalid_json`, ...).
   */
  code: string;
  /** Text grids: the row (0-based, the same number as the last part of `path`). */
  row?: number;
  /** Text grids: the column (0-based character index in the row). MML: the position in the string. */
  col?: number;
  /** `.txt` files: the line (1-based) the field came from, when the reader knows it. */
  line?: number;
}

export type ContentResult<T> = { ok: true; value: T; errors: [] } | { ok: false; errors: ContentError[] };

/** A path from Zod (or built by hand) as it appears in a content file. */
export type FieldPath = readonly PropertyKey[];

const PLAIN_KEY = /^[A-Za-z_$][\w$]*$/;

/** `['frames', 'idle', 2]` -> `frames.idle.2`. Keys that are not plain names are quoted: `legend["#"]`. */
export function dottedPath(path: FieldPath): string {
  let out = '';
  for (const part of path) {
    const key = typeof part === 'symbol' ? (part.description ?? '') : String(part);
    if (typeof part === 'number' || PLAIN_KEY.test(key)) out += out === '' ? key : `.${key}`;
    else out += `[${JSON.stringify(key)}]`;
  }
  return out;
}

/** `['frames', 'idle', 2]` -> `/frames/idle/2`, escaping `~` and `/` as RFC 6901 says. */
export function jsonPointer(path: FieldPath): string {
  return path
    .map((part) => {
      const key = typeof part === 'symbol' ? (part.description ?? '') : String(part);
      return `/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
    })
    .join('');
}

/** Builds one error for `file` at `path`. */
export function contentError(
  file: string,
  path: FieldPath,
  code: string,
  message: string,
  extra: Pick<ContentError, 'row' | 'col' | 'line'> = {},
): ContentError {
  return { file, path: dottedPath(path), pointer: jsonPointer(path), message, code, ...extra };
}

/**
 * Extra details a schema may put on a custom issue (`ctx.addIssue({ code: 'custom', params })`) to
 * give it a content code and a grid position. See `addGridIssues` in `text-grid.ts`.
 */
export interface IssueParams {
  code?: string;
  row?: number;
  col?: number;
}

function numberOrUndefined(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

/**
 * Zod says only "Invalid input" for a union; when every option failed with one issue on the value
 * itself, list what each option expected instead: `Invalid input: expected "clear", or expected number, received string`.
 */
function unionMessage(issue: z.core.$ZodIssueInvalidUnion): string {
  const options = issue.errors;
  const simple = options.length > 0 && options.every((o) => o.length === 1 && o[0]!.path.length === 0);
  if (!simple) return issue.message;
  const parts = options.map((o) => o[0]!.message.replace(/^Invalid input: /, ''));
  return `Invalid input: ${parts.join(', or ')}`;
}

/** Turns Zod issues into content errors, in Zod's (deterministic) order. */
export function issuesToErrors(file: string, issues: readonly z.core.$ZodIssue[]): ContentError[] {
  const out: ContentError[] = [];
  for (const issue of issues) {
    if (issue.code === 'unrecognized_keys') {
      // One error per unknown key, pointing at the key itself, so the path names the exact field.
      for (const key of issue.keys) {
        out.push(contentError(file, [...issue.path, key], issue.code, `unknown field "${key}"`));
      }
      continue;
    }
    if (issue.code === 'invalid_key' && issue.issues.length > 0) {
      // A bad record key: report the key schema's own issues at the key.
      const inner = issue.issues.map((i) => ({ ...i, path: [...issue.path, ...i.path] }));
      out.push(...issuesToErrors(file, inner as z.core.$ZodIssue[]));
      continue;
    }
    if (issue.code === 'invalid_union') {
      out.push(contentError(file, issue.path, issue.code, unionMessage(issue)));
      continue;
    }
    if (issue.code === 'custom') {
      const params = (issue.params ?? {}) as IssueParams;
      const extra: Pick<ContentError, 'row' | 'col'> = {};
      const row = numberOrUndefined(params.row);
      const col = numberOrUndefined(params.col);
      if (row !== undefined) extra.row = row;
      if (col !== undefined) extra.col = col;
      out.push(contentError(file, issue.path, params.code ?? 'custom', issue.message, extra));
      continue;
    }
    out.push(contentError(file, issue.path, issue.code, issue.message));
  }
  return out;
}

/**
 * Checks `data` (already parsed: an object from JSON or from a `.txt` reader) against `schema`.
 * Never throws for bad content; every problem comes back as a {@link ContentError} naming
 * `fileName` and the field.
 */
export function validate<S extends z.ZodType>(
  fileName: string,
  data: unknown,
  schema: S,
): ContentResult<z.output<S>> {
  const result = schema.safeParse(data);
  if (result.success) return { ok: true, value: result.data, errors: [] };
  return { ok: false, errors: issuesToErrors(fileName, result.error.issues) };
}

/** One line per error: `file: path: message`, for logs and thrown messages. */
export function formatErrors(errors: readonly ContentError[]): string {
  return errors
    .map((e) => {
      const where = e.line === undefined ? e.file : `${e.file}:${e.line}`;
      return `${where}: ${e.path === '' ? '(file)' : e.path}: ${e.message}`;
    })
    .join('\n');
}
