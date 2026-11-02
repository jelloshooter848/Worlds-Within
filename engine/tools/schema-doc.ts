import { z } from 'zod';

/**
 * A Zod schema as rows of a field table, for the generated schema docs (`docs-gen.ts`). The schema
 * goes through Zod's own `toJSONSchema` (as the input a file holds: defaults make a field optional),
 * and this walks the JSON Schema that comes back: one row per field, nested fields under their
 * parent's path (`input.steps[].frame`, `frames.<key>`), each with its type, whether it is
 * required, its default, its limits and its `.describe()` text.
 */

/** One field of a schema, as the docs show it. */
export interface FieldRow {
  /** Dotted from the top: `ticks`, `input.steps[].hold`, `content.<key>`. */
  path: string;
  /** Short and readable: `integer`, `string[]`, `"eq" | "ne"`, `[integer, integer]`, `JSON`. */
  type: string;
  required: boolean;
  /** The default as JSON text, when the field has one. */
  default?: string;
  /** Limits the type does not say: `>= 0`, `1-36 items`, `pattern ^#...`. Empty when none. */
  limits: string;
  description: string;
}

/** The part of a JSON Schema node this walker reads. */
interface Node {
  type?: string;
  $ref?: string;
  enum?: unknown[];
  const?: unknown;
  anyOf?: Node[];
  oneOf?: Node[];
  items?: Node | false;
  prefixItems?: Node[];
  properties?: Record<string, Node>;
  required?: string[];
  additionalProperties?: Node | boolean;
  propertyNames?: Node;
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
}

/** The JSON Schema of `schema` as the input a file holds. Transforms and refinements are left out. */
export function jsonSchemaOf(schema: z.ZodType): Node {
  return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Node;
}

const isNode = (v: Node | boolean | undefined): v is Node => typeof v === 'object' && v !== null;

/** A record (an object with free keys and one value schema), as opposed to an object with fields. */
function recordValue(node: Node): Node | undefined {
  return node.type === 'object' && !node.properties && isNode(node.additionalProperties)
    ? node.additionalProperties
    : undefined;
}

/** The node's type, short: what a reader writes in the file. */
export function typeName(node: Node): string {
  if (node.$ref !== undefined) return 'JSON';
  if (node.enum) return node.enum.map((v) => JSON.stringify(v)).join(' | ');
  if (node.const !== undefined) return JSON.stringify(node.const);
  const union = node.anyOf ?? node.oneOf;
  if (union) return union.map(typeName).join(' | ');
  if (node.type === 'array') {
    if (node.prefixItems) return `[${node.prefixItems.map(typeName).join(', ')}]`;
    if (!isNode(node.items)) return 'array';
    const item = typeName(node.items);
    return item.includes(' ') ? `(${item})[]` : `${item}[]`;
  }
  const value = recordValue(node);
  if (value) return `{ <key>: ${typeName(value)} }`;
  return node.type ?? 'any';
}

/** The limits on a node that its type name does not show. */
export function limitsOf(node: Node): string {
  const out: string[] = [];
  const safe = (n: number | undefined): n is number =>
    n !== undefined && Math.abs(n) < Number.MAX_SAFE_INTEGER;
  if (safe(node.minimum) && safe(node.maximum)) out.push(`${node.minimum} to ${node.maximum}`);
  else if (safe(node.minimum)) out.push(`>= ${node.minimum}`);
  else if (safe(node.maximum)) out.push(`<= ${node.maximum}`);
  if (safe(node.exclusiveMinimum)) out.push(`> ${node.exclusiveMinimum}`);
  if (safe(node.exclusiveMaximum)) out.push(`< ${node.exclusiveMaximum}`);
  if (node.minLength !== undefined)
    out.push(node.minLength === 1 ? 'not empty' : `length >= ${node.minLength}`);
  if (node.maxLength !== undefined) out.push(`length <= ${node.maxLength}`);
  if (!node.prefixItems) {
    if (node.minItems !== undefined && node.maxItems !== undefined)
      out.push(`${node.minItems} to ${node.maxItems} items`);
    else if (node.minItems !== undefined)
      out.push(`at least ${node.minItems} item${node.minItems === 1 ? '' : 's'}`);
    else if (node.maxItems !== undefined) out.push(`at most ${node.maxItems} items`);
  }
  if (node.pattern !== undefined) out.push(`matches \`${node.pattern}\``);
  const keys = recordValue(node) ? node.propertyNames : undefined;
  if (keys) {
    const k = limitsOf(keys);
    if (k) out.push(`keys: ${k}`);
  }
  // An array's items carry their own limits (a palette's colours, a manifest's paths).
  if (node.type === 'array' && isNode(node.items) && !node.items.properties) {
    const k = limitsOf(node.items);
    if (k) out.push(`items: ${k}`);
  }
  return out.join('; ');
}

/** Every field of an object schema, depth first, in the schema's key order. */
export function fieldRows(schema: z.ZodType): FieldRow[] {
  const rows: FieldRow[] = [];
  const walk = (node: Node, prefix: string): void => {
    const required = new Set(node.required ?? []);
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      const path = prefix + key;
      const row: FieldRow = {
        path,
        type: typeName(child),
        required: required.has(key),
        limits: limitsOf(child),
        description: child.description ?? '',
      };
      if (child.default !== undefined) row.default = JSON.stringify(child.default);
      rows.push(row);
      inner(child, path);
    }
  };
  /** Fields inside a field: an object's, an array's items', a record's values'. */
  const inner = (node: Node, path: string): void => {
    if (node.properties) return walk(node, `${path}.`);
    if (node.type === 'array' && isNode(node.items) && node.items.properties)
      return walk(node.items, `${path}[].`);
    const value = recordValue(node);
    if (!value) return;
    if (value.properties) return walk(value, `${path}.<key>.`);
    if (value.description === undefined) return;
    rows.push({
      path: `${path}.<key>`,
      type: typeName(value),
      required: false,
      limits: limitsOf(value),
      description: value.description,
    });
    inner(value, `${path}.<key>`);
  };
  walk(jsonSchemaOf(schema), '');
  return rows;
}
