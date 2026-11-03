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

/**
 * The kits a game uses (Engine 0.14, gap G12, decision 8): its `kit` first, then each kit in
 * `uses`, in that order. Throws for an unknown kit (`validate` reports those first).
 */
export function gameKits(manifest: { kit: string; uses?: readonly string[] | undefined }): KitDef[] {
  return [manifest.kit, ...(manifest.uses ?? [])].map(loadKit);
}

/** One rule of one of a game's kits. */
export interface KitRuleRef {
  /** The kit the rule belongs to. */
  kit: string;
  /** The rule's id in that kit's list. */
  id: string;
}

/**
 * A rule id as the tools write it for a game whose main kit is `mainKit`: the bare id for a rule
 * of the main kit (so every run file and result from before Engine 0.14 reads the same), `kit:id`
 * for a rule of a kit the game `uses`.
 */
export function qualifiedRuleId(rule: KitRuleRef, mainKit: string): string {
  return rule.kit === mainKit ? rule.id : `${rule.kit}:${rule.id}`;
}

/**
 * Which rule a run file's (or `--disable-rule`'s) id names in a game on `kits` (`gameKits`, the
 * main kit first): `kit:id` names rule `id` of that kit, a bare id the main kit's rule. A kit the
 * game does not use, or a rule its kit does not name, gives the reason instead (`where`, such as
 * ` in "guards"`, goes after the id).
 */
export function lookupRuleId(
  raw: string,
  kits: readonly KitDef[],
  where = '',
): { ok: true; rule: KitRuleRef } | { ok: false; message: string } {
  const colon = raw.indexOf(':');
  const kitName = colon < 0 ? kits[0]!.name : raw.slice(0, colon);
  const id = colon < 0 ? raw : raw.slice(colon + 1);
  const kit = kits.find((k) => k.name === kitName);
  if (kit === undefined)
    return {
      ok: false,
      message: `the game uses no kit "${kitName}" (rule "${raw}"${where}; its kits: ${kits.map((k) => k.name).join(', ')})`,
    };
  if (!kit.rules.some((r) => r.id === id))
    return {
      ok: false,
      message: `kit "${kit.name}" has no rule "${id}"${where} (known: ${kit.rules.map((r) => r.id).join(', ') || 'none'})`,
    };
  return { ok: true, rule: { kit: kit.name, id } };
}
