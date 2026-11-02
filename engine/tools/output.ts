import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * The output cap: a result longer than the cap is cut, and the whole of it goes to a file under
 * the tools output folder (`.ww-out/`, git-ignored) whose path is in the result, so an agent never
 * gets a flood on stdout and can still read every line.
 *
 * - `--json`: the result's top-level arrays are cut (the longest first, halving) until the JSON
 *   fits. The capped result gets `truncated: true`, `fullOutput` (the file with the whole result,
 *   as JSON) and `omitted` (how many items each array lost).
 * - Text: the first lines that fit are printed, then one line naming the file with the rest.
 *
 * The file name comes from the command and a hash of the content, so the same run writes the same
 * file and nothing depends on the clock.
 */

/** The default cap: 32 KiB. Change it per call with `--max-output <bytes>`. */
export const DEFAULT_MAX_OUTPUT = 32 * 1024;

/** The tools output folder, relative to the working folder. */
export const OUTPUT_DIR = '.ww-out';

/** Writes `text` to `<outDir>/<command>-<hash>.<ext>` and returns its path relative to `cwd`. */
export function writeFullOutput(
  cwd: string,
  outDir: string,
  command: string,
  text: string,
  ext: 'json' | 'txt',
): string {
  const dir = resolve(cwd, outDir);
  mkdirSync(dir, { recursive: true });
  const hash = createHash('sha256').update(text).digest('hex').slice(0, 12);
  const file = join(dir, `${command}-${hash}.${ext}`);
  writeFileSync(file, text);
  return relative(cwd, file).replaceAll('\\', '/');
}

const bytes = (text: string) => Buffer.byteLength(text, 'utf8');

/**
 * `result` as one JSON line no longer than `max` bytes. When it does not fit, `writeFull` is called
 * with the whole result (pretty JSON) and returns the path that goes in `fullOutput`.
 */
export function capJson(
  result: Record<string, unknown>,
  max: number,
  writeFull: (text: string) => string,
): string {
  const full = JSON.stringify(result);
  if (bytes(full) <= max) return full;
  const fullOutput = writeFull(`${JSON.stringify(result, null, 2)}\n`);
  const capped: Record<string, unknown> = { ...result, truncated: true, fullOutput };
  const omitted: Record<string, number> = {};
  capped.omitted = omitted;
  for (;;) {
    const text = JSON.stringify(capped);
    if (bytes(text) <= max) return text;
    let longest: string | undefined;
    for (const [key, value] of Object.entries(capped)) {
      if (!Array.isArray(value) || value.length === 0) continue;
      if (longest === undefined || value.length > (capped[longest] as unknown[]).length) longest = key;
    }
    if (longest === undefined) break;
    const list = capped[longest] as unknown[];
    const keep = Math.floor(list.length / 2);
    omitted[longest] = (omitted[longest] ?? 0) + list.length - keep;
    capped[longest] = list.slice(0, keep);
  }
  // Nothing left to cut and still too long (a huge single field): keep only the envelope.
  const envelope: Record<string, unknown> = { truncated: true, fullOutput };
  for (const key of ['ok', 'command', 'exitCode']) if (key in result) envelope[key] = result[key];
  return JSON.stringify(envelope);
}

/** `text` cut to at most `max` bytes at a line break, with a last line naming the file with all of it. */
export function capText(text: string, max: number, writeFull: (text: string) => string): string {
  if (bytes(text) <= max) return text;
  const path = writeFull(text);
  const lines = text.split('\n');
  const note = (n: number) => `... ${n} more line(s): the full output is in ${path}`;
  const kept: string[] = [];
  let size = bytes(note(lines.length)) + 1;
  for (const line of lines) {
    const next = size + bytes(line) + 1;
    if (next > max) break;
    kept.push(line);
    size = next;
  }
  return [...kept, note(lines.length - kept.length)].join('\n');
}
