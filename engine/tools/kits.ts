import type { ContentKind } from '@engine/core/content/kinds';
import type { KitDef } from '@engine/core/kit';
import type { RuleList } from '@engine/core/rules';
import { KIT_HOOKS } from './kit-list';

/**
 * The kits the tools know, found by the kit names a `game.json` gives in `kit` (and `uses`). Each kit says what it
 * adds through its own hook (`kits/<name>/kit.ts`, a `KitDef` from `engine/core/kit.ts`): its
 * content kinds, its named rules and whether it opts in to strict mutants. The hooks come from
 * `kit-list.ts`, which `pnpm docs:gen` generates from the kit folders, so there is no table of
 * kits to edit here.
 */

const BY_NAME: ReadonlyMap<string, KitDef> = new Map(KIT_HOOKS.map((k) => [k.name, k]));

/** Every kit's hook, by name. */
export function allKits(): readonly KitDef[] {
  return KIT_HOOKS;
}

/** The names of every kit, by name. */
export function kitNames(): string[] {
  return KIT_HOOKS.map((k) => k.name);
}

/** The hook of kit `name`, or undefined for a name no kit has. */
export function findKit(name: string): KitDef | undefined {
  return BY_NAME.get(name);
}

/**
 * What to say about a kit name no kit has: the name, the field of `game.json` it is in (`kit`, or
 * `uses.1` for a kit the game also uses) and the kits there are.
 */
export function unknownKitMessage(name: string, field = 'kit'): string {
  return `unknown kit "${name}" in "${field}": there is no kits/${name}/kit.ts (known: ${kitNames().join(', ') || 'none'})`;
}

/** The hook of kit `name`; throws (see {@link unknownKitMessage}) for a name no kit has. */
export function loadKit(name: string): KitDef {
  const kit = findKit(name);
  if (!kit) throw new Error(unknownKitMessage(name));
  return kit;
}

/** The content kinds kit `name` adds to the engine's own. Throws for an unknown kit. */
export function kitKinds(name: string): readonly ContentKind[] {
  return loadKit(name).kinds();
}

/** The named rules of kit `name` (none for a kit that names none). Throws for an unknown kit. */
export function kitRules(name: string): RuleList {
  return loadKit(name).rules;
}
