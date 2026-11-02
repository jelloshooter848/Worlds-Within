import type { z } from 'zod';
import type { JsonValue } from '../core/headless';

/**
 * A component kind: a name and the Zod schema its data must match. Component data is plain
 * JSON-safe data (objects, arrays, strings, finite numbers, booleans, null), never a class
 * instance, `Map` or function, so a world snapshot can be written out, hashed and read back.
 * The schema is what save/load and scenario files use to check that data.
 *
 *   const Position = defineComponent('Position', z.strictObject({ x: z.int(), y: z.int() }));
 */
export interface ComponentDef<T extends JsonValue = JsonValue> {
  readonly name: string;
  readonly schema: z.ZodType<T>;
  /**
   * True: the kind is left out of snapshots (and saves) while no entity has it, so registering it
   * changes nothing until it is used (Engine 0.10: the time components, kept out of the 0.8 and
   * 0.9 golden hashes). False (the default): listed always, empty or not.
   */
  readonly omitWhenEmpty: boolean;
}

export interface ComponentOptions {
  /** See `ComponentDef.omitWhenEmpty`. Default false. */
  readonly omitWhenEmpty?: boolean;
}

/** Names are identifiers (a letter, then letters, digits or `_`), so they read well in a snapshot. */
const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/** A component kind named `name` whose data matches `schema`. */
export function defineComponent<T extends JsonValue>(
  name: string,
  schema: z.ZodType<T>,
  options: ComponentOptions = {},
): ComponentDef<T> {
  if (!NAME.test(name))
    throw new Error(`component name "${name}" must be a letter followed by letters, digits or _`);
  return Object.freeze({ name, schema, omitWhenEmpty: options.omitWhenEmpty ?? false });
}
