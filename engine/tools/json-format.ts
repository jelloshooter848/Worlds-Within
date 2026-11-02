import { format, resolveConfig } from 'prettier';
import type { JsonValue } from '@engine/core/headless';

/**
 * JSON files the way the repo's formatter (Prettier, `.prettierrc`) writes them, so an edit made by
 * the CLI passes `pnpm lint` and changes as little of the file as it can.
 *
 * Prettier keeps an object spread over lines when its first key starts on a new line, and puts
 * everything else on one line when it fits. So the file is read with {@link readJson}, which
 * remembers which objects were spread out; the edits change that tree in place (an object moved
 * by an edit keeps its look); and {@link writeJson} prints the tree with the same choice for each
 * object and lets Prettier do the rest.
 */

export interface ReadJson {
  value: JsonValue;
  /** The objects in `value` that the text spreads over lines. */
  expanded: WeakSet<object>;
}

/** Parses JSON text (already known to be valid: `JSON.parse` it first for the error message). */
export function readJson(text: string): ReadJson {
  const expanded = new WeakSet<object>();
  let i = 0;
  const space = () => {
    while (i < text.length && /\s/.test(text[i]!)) i++;
  };
  const string = (): string => {
    const start = i;
    i++;
    while (text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const value = (): JsonValue => {
    space();
    const ch = text[i];
    if (ch === '{') {
      const obj: { [key: string]: JsonValue } = {};
      const open = i;
      i++;
      space();
      if (text.slice(open + 1, i).includes('\n') && text[i] !== '}') expanded.add(obj);
      if (text[i] === '}') {
        i++;
        return obj;
      }
      for (;;) {
        space();
        const key = string();
        space();
        i++; // ':'
        obj[key] = value();
        space();
        if (text[i++] === '}') return obj;
      }
    }
    if (ch === '[') {
      const arr: JsonValue[] = [];
      i++;
      space();
      if (text[i] === ']') {
        i++;
        return arr;
      }
      for (;;) {
        arr.push(value());
        space();
        if (text[i++] === ']') return arr;
      }
    }
    if (ch === '"') return string();
    const start = i;
    while (i < text.length && /[^\s,\]}]/.test(text[i]!)) i++;
    return JSON.parse(text.slice(start, i)) as JsonValue;
  };
  return { value: value(), expanded };
}

/** The tree as JSON, each object spread out only when it is in `expanded`. */
function print(value: JsonValue, expanded: WeakSet<object>, indent: string): string {
  if (Array.isArray(value)) return `[${value.map((v) => print(v, expanded, indent)).join(', ')}]`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';
  if (!expanded.has(value)) {
    return `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${print(v, expanded, indent)}`).join(', ')} }`;
  }
  const inner = `${indent}  `;
  const body = entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${print(v, expanded, inner)}`);
  return `{\n${body.join(',\n')}\n${indent}}`;
}

/** The text for `value`, formatted by Prettier with the repo's settings for `absPath`. */
export async function writeJson(
  value: JsonValue,
  expanded: WeakSet<object>,
  absPath: string,
): Promise<string> {
  const config = (await resolveConfig(absPath, { editorconfig: true })) ?? {};
  return format(print(value, expanded, ''), { ...config, parser: 'json', filepath: absPath });
}
