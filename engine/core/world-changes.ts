import { DEFAULT_TICKS_PER_HOUR, durationText } from './clock';
import type { MissionDef, MissionRecord } from './missions';
import { countText } from './plural';

/**
 * What changed in a world over a stretch of ticks, and what a mission card shows of a mission
 * (Engine 0.16 F5): the types the shell's in-picture mission screens read
 * (`shell/mission-screens.ts`), with the text they show. `engine/sim` computes both from the world
 * (`worldChanges(world, sinceTick)` over the event log, its causes and the key table, and
 * `missionCardFacts(world, def)`); the core only reads them, so a page never computes them in its
 * glue. Pure; nothing here is world state, a frame or a hash.
 *
 *   changeLines(worldChanges(world, 0), { title: (m, o) => outcomeTitle(m, o) })
 *   // ['Burn the siege engines: The ram burnt, ... (delegated)', 'Village: 2 soldiers', ...]
 */

/** One unit lost: destroyed, or a named person who died. */
export interface LostUnit {
  readonly entity: number;
  /** Its scenario key, or null. */
  readonly key: string | null;
  /** A named person's name, or null. */
  readonly name: string | null;
  /** Its unit type (`Unit.type`), or null. */
  readonly type: string | null;
}

/** The units one faction lost, ascending by entity id. */
export interface FactionLosses {
  readonly faction: string;
  readonly units: readonly LostUnit[];
}

/** A named person whose fate moved: where they were, where they are now and who did it. */
export interface PersonChange {
  readonly entity: number;
  readonly key: string | null;
  readonly name: string;
  readonly faction: string | null;
  /** The fate before the first move in the stretch (`active` when they had none). */
  readonly was: string;
  /** The fate now (`injured`, `captured`, `freed`, `dead`). */
  readonly fate: string;
  /** Who captured or killed them (a faction), or null. */
  readonly by: string | null;
}

/** A building that lost hit points or was destroyed. */
export interface BuildingChange {
  readonly entity: number;
  readonly key: string | null;
  /** Its building type (`Building.kind`). */
  readonly kind: string;
  readonly faction: string | null;
  readonly destroyed: boolean;
  /** Hit points now (0 when destroyed) and its maximum (null when it had no `Health`). */
  readonly hp: number;
  readonly max: number | null;
  /** Hit points lost over the stretch. */
  readonly lost: number;
}

/** What changed in a world from tick `since` to `tick`. */
export interface WorldChanges {
  readonly since: number;
  readonly tick: number;
  /** Units lost by faction, factions in name order. */
  readonly losses: readonly FactionLosses[];
  /** Named people whose fate moved (captives among them), ascending by entity id. */
  readonly people: readonly PersonChange[];
  /** Buildings damaged or destroyed, ascending by entity id. */
  readonly buildings: readonly BuildingChange[];
  /** The missions committed in the stretch, in commit order. */
  readonly records: readonly MissionRecord[];
}

/** An empty stretch at `tick`. */
export function noChanges(since: number, tick = since): WorldChanges {
  return { since, tick, losses: [], people: [], buildings: [], records: [] };
}

/** How the changes are written. */
export interface ChangeLineOptions {
  /** An outcome's title (the mission file's; its id by default). */
  title?(mission: string, outcome: string): string;
  /** A mission's title (its id by default). */
  missionTitle?(mission: string): string;
}

/** `Name` for a key or type: `north-wall` -> `North wall`. */
export function displayName(id: string): string {
  const words = id.replace(/[-_]+/g, ' ').trim();
  return words === '' ? id : words[0]!.toUpperCase() + words.slice(1);
}

/** One lost unit as the lists write it: a named person's name, else its type (or key). */
function unitText(u: LostUnit): string {
  return u.name ?? u.type ?? u.key ?? `#${u.entity}`;
}

/**
 * `2 soldiers, raider, Captain Hale`: units of the same type counted with the plural
 * (`plural.ts`), named people by name and never counted, in list order.
 */
export function lossText(units: readonly LostUnit[]): string {
  const entries: { text: string; n: number; counted: boolean }[] = [];
  for (const u of units) {
    const text = unitText(u);
    const counted = u.name === null;
    const same = counted ? entries.find((e) => e.counted && e.text === text) : undefined;
    if (same !== undefined) same.n += 1;
    else entries.push({ text, n: 1, counted });
  }
  return entries.map((e) => (e.counted ? countText(e.n, e.text) : e.text)).join(', ');
}

/** A person's change: `Captain Hale: captured by raiders`. */
export function personText(p: PersonChange): string {
  return `${p.name}: ${p.fate}${p.by !== null && (p.fate === 'captured' || p.fate === 'dead') ? ` by ${p.by}` : ''}`;
}

/** A building's change: `Hall: destroyed`, `North wall: 40 hp lost (40/80)`. */
export function buildingText(b: BuildingChange): string {
  const name = displayName(b.key ?? b.kind);
  if (b.destroyed) return `${name}: destroyed`;
  return `${name}: ${b.lost} hp lost${b.max !== null ? ` (${b.hp}/${b.max})` : ''}`;
}

/** A record: `<outcome title> (delegated)`, with the mission's title when one is given. */
export function recordText(r: MissionRecord, opts: ChangeLineOptions = {}): string {
  const title = opts.title?.(r.mission, r.outcome) ?? r.outcome;
  return `${title} (${r.resolution})`;
}

/** The changes as the results screen's sections, each a heading and its lines (empty sections left out). */
export function changeSections(
  changes: WorldChanges,
  opts: ChangeLineOptions = {},
): { heading: string; lines: string[] }[] {
  const sections = [
    { heading: 'Missions', lines: changes.records.map((r) => recordText(r, opts)) },
    {
      heading: 'Losses',
      lines: changes.losses.map((l) => `${displayName(l.faction)}: ${lossText(l.units)}`),
    },
    { heading: 'People', lines: changes.people.map(personText) },
    { heading: 'Buildings', lines: changes.buildings.map(buildingText) },
  ];
  return sections.filter((s) => s.lines.length > 0);
}

/** Every change as one line each, sections in order (records, losses, people, buildings). */
export function changeLines(changes: WorldChanges, opts: ChangeLineOptions = {}): string[] {
  return changeSections(changes, opts).flatMap((s) => s.lines);
}

/** What a mission card shows of a mission besides its file: who goes, who stands against them, how long the window stays. */
export interface MissionCardFacts {
  /** The hero's name (the mission's `params.hero`), or null when it has none. */
  readonly hero: string | null;
  /** The foes (the mission's `params.foes`) as `lossText` writes units: `ram, catapult, Grell`. */
  readonly foes: string;
  /** World ticks until the window that offers it closes, or null (not offered, or no end). */
  readonly ticksLeft: number | null;
}

/** No facts: no hero, no foes, no window. */
export const NO_CARD_FACTS: MissionCardFacts = Object.freeze({ hero: null, foes: '', ticksLeft: null });

/** The mission card's chips, in order: the world time it costs, the hero, the foes. */
export function missionChips(
  def: MissionDef,
  facts: MissionCardFacts,
  ticksPerHour: number = DEFAULT_TICKS_PER_HOUR,
): string[] {
  return [
    `Costs ${durationText(def.worldTimeCost, ticksPerHour)} of world time`,
    facts.hero === null ? '' : `Hero ${facts.hero}`,
    facts.foes === '' ? '' : `Foes ${facts.foes}`,
  ].filter((s) => s !== '');
}

/** The window's line: `Window closes in 136 ticks`, or '' without one. */
export function windowText(facts: MissionCardFacts): string {
  if (facts.ticksLeft === null) return '';
  return `Window closes in ${facts.ticksLeft} tick${facts.ticksLeft === 1 ? '' : 's'}`;
}
