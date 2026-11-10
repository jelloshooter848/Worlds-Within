import type { JsonValue } from '../core/headless';
import type { MissionDef } from '../core/missions';
import type {
  BuildingChange,
  FactionLosses,
  LostUnit,
  MissionCardFacts,
  PersonChange,
  WorldChanges,
} from '../core/world-changes';
import { lossText } from '../core/world-changes';
import { CARRY_CAUSE } from './carry';
import type { Change } from './events';
import { worldKeys } from './keys';
import { missionRecords } from './mission';
import { opportunitiesOf } from './opportunity';
import type { Entity, World } from './world';

/**
 * What changed in a world since a tick, and what a mission card shows of a mission (Engine 0.16
 * F5): read from the world only (its event log, the causes in it, its key table, its missions and
 * opportunities), never written. The shell's in-picture mission screens show them through a page's
 * `MissionScreens` options, so no game computes them in its glue. The types and their text are
 * `engine/core/world-changes.ts`.
 *
 * `worldChanges(world, sinceTick)` walks the log's changes from `sinceTick` (the world must keep
 * them: the default log keeps everything), skipping the changes that build the world
 * (`SETUP_CAUSES`: the scenario and its carry-over, both at tick 0):
 *
 * - **losses**: every unit (`Unit`) destroyed, by the faction its `Owner` said, and every named
 *   person whose `Fate` became `dead` (a dead record stays in the world);
 * - **people**: every named person whose `Fate` moved, from the state before the first move to the
 *   state now, and by whom (captives are those now `captured`);
 * - **buildings**: every `Building` whose `Health` fell, or that was destroyed;
 * - **records**: the missions committed at or after `sinceTick`.
 *
 * Names come from the key table (`worldKeys`) and `Member`; a destroyed entity's components are
 * read from the `remove` changes the log keeps before its `destroy`.
 */

/** Causes whose changes build the world rather than happen in it (left out of `worldChanges`). */
export const SETUP_CAUSES: readonly string[] = Object.freeze(['scenario', CARRY_CAUSE, 'load']);

type Obj = Readonly<Record<string, JsonValue>>;
const obj = (v: JsonValue | undefined): Obj | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? v : null;
const str = (v: JsonValue | undefined): string | null => (typeof v === 'string' ? v : null);
const num = (v: JsonValue | undefined): number | null => (typeof v === 'number' ? v : null);

/** Each entity's first scenario key (keys in sorted order). */
function keyNames(world: World): Map<Entity, string> {
  const out = new Map<Entity, string>();
  const keys = worldKeys(world);
  for (const key of Object.keys(keys)) if (!out.has(keys[key]!)) out.set(keys[key]!, key);
  return out;
}

/** An entity's component now, or the last value the log saw it lose. */
function component(world: World, gone: Map<Entity, Map<string, JsonValue>>, id: Entity, name: string) {
  if (world.alive(id) && world.registered(name)) {
    const v = world.get(id, name);
    if (v !== undefined) return v;
  }
  return gone.get(id)?.get(name);
}

/** What changed in `world` from `sinceTick` (inclusive) to now. Reads only. */
export function worldChanges(world: World, sinceTick = 0): WorldChanges {
  const setup = new Set(SETUP_CAUSES);
  const log: Change[] = world.events(sinceTick).filter((c) => !setup.has(c.cause));
  const keys = keyNames(world);
  const gone = new Map<Entity, Map<string, JsonValue>>();
  const destroyed = new Set<Entity>();
  const fates = new Map<Entity, { was: string }>();
  const dead = new Set<Entity>();
  const hpBefore = new Map<Entity, number>();
  for (const c of log) {
    if (c.op === 'remove' && c.component !== undefined && c.before !== undefined) {
      const own = gone.get(c.entity) ?? new Map<string, JsonValue>();
      own.set(c.component, c.before);
      gone.set(c.entity, own);
    } else if (c.op === 'destroy') destroyed.add(c.entity);
    if ((c.op === 'add' || c.op === 'set') && c.component === 'Fate') {
      if (!fates.has(c.entity)) fates.set(c.entity, { was: str(obj(c.before)?.['state']) ?? 'active' });
      if (str(obj(c.value)?.['state']) === 'dead') dead.add(c.entity);
    }
    if (c.op === 'set' && c.component === 'Health' && !hpBefore.has(c.entity)) {
      const hp = num(obj(c.before)?.['hp']);
      if (hp !== null) hpBefore.set(c.entity, hp);
    }
  }
  const comp = (id: Entity, name: string) => component(world, gone, id, name);
  const faction = (id: Entity) => str(obj(comp(id, 'Owner'))?.['faction']);
  const name = (id: Entity) => str(obj(comp(id, 'Member'))?.['name']);

  const lost = new Map<string, LostUnit[]>();
  const lose = (id: Entity) => {
    const f = faction(id) ?? '';
    const list = lost.get(f) ?? [];
    list.push({
      entity: id,
      key: keys.get(id) ?? null,
      name: name(id),
      type: str(obj(comp(id, 'Unit'))?.['type']),
    });
    lost.set(f, list);
  };
  const units = [...new Set([...destroyed, ...dead])].sort((a, b) => a - b);
  for (const id of units) {
    if (comp(id, 'Building') !== undefined) continue;
    if (dead.has(id) || comp(id, 'Unit') !== undefined) lose(id);
  }
  const losses: FactionLosses[] = [...lost.keys()].sort().map((f) => ({ faction: f, units: lost.get(f)! }));

  const people: PersonChange[] = [...fates.keys()]
    .sort((a, b) => a - b)
    .flatMap((id): PersonChange[] => {
      const fate = obj(comp(id, 'Fate'));
      const state = str(fate?.['state']);
      if (state === null) return [];
      return [
        {
          entity: id,
          key: keys.get(id) ?? null,
          name: name(id) ?? keys.get(id) ?? `#${id}`,
          faction: faction(id),
          was: fates.get(id)!.was,
          fate: state,
          by: str(fate?.['by']),
        },
      ];
    });

  const buildings: BuildingChange[] = [...new Set([...hpBefore.keys(), ...destroyed])]
    .sort((a, b) => a - b)
    .flatMap((id): BuildingChange[] => {
      const building = obj(comp(id, 'Building'));
      if (building === null) return [];
      const health = obj(comp(id, 'Health'));
      const isGone = destroyed.has(id) && !world.alive(id);
      const hp = isGone ? 0 : (num(health?.['hp']) ?? 0);
      const before = hpBefore.get(id) ?? num(health?.['hp']) ?? 0;
      if (!isGone && hp >= before) return [];
      return [
        {
          entity: id,
          key: keys.get(id) ?? null,
          kind: str(building['kind']) ?? 'building',
          faction: faction(id),
          destroyed: isGone,
          hp,
          max: num(health?.['max']),
          lost: Math.max(0, before - hp),
        },
      ];
    });

  const records = missionRecords(world).filter((r) => r.commitTick >= sinceTick);
  return { since: sinceTick, tick: world.tick, losses, people, buildings, records };
}

/** A mission round's selector as the rounds' params share it (`faction`, `types`, `member`, `squad`, `event`). */
interface Select {
  event?: string;
  faction?: string;
  types?: readonly string[];
  member?: string;
  squad?: string | number;
}

function selectOf(v: JsonValue | undefined): Select | null {
  const s = obj(v);
  if (s === null) return null;
  const types = s['types'];
  return {
    ...(str(s['event']) !== null && { event: str(s['event'])! }),
    ...(str(s['faction']) !== null && { faction: str(s['faction'])! }),
    ...(Array.isArray(types) && { types: types.filter((t): t is string => typeof t === 'string') }),
    ...(str(s['member']) !== null && { member: str(s['member'])! }),
    ...((typeof s['squad'] === 'string' || typeof s['squad'] === 'number') && { squad: s['squad'] }),
  };
}

/** The entities on the map (placed, not captured or dead, above 0 hp) that `select` picks. */
function picked(world: World, select: Select): Entity[] {
  const keys = worldKeys(world);
  const squad =
    select.squad === undefined
      ? undefined
      : typeof select.squad === 'number'
        ? select.squad
        : keys[select.squad];
  return world.entities().filter((id) => {
    if (!world.registered('Position') || !world.has(id, 'Position')) return false;
    const fate = str(obj(world.registered('Fate') ? world.get(id, 'Fate') : undefined)?.['state']);
    if (fate === 'captured' || fate === 'dead') return false;
    const hp = num(obj(world.registered('Health') ? world.get(id, 'Health') : undefined)?.['hp']);
    if (hp !== null && hp <= 0) return false;
    const read = (c: string, f: string) => (world.registered(c) ? obj(world.get(id, c))?.[f] : undefined);
    if (select.event !== undefined && read('EventMember', 'event') !== select.event) return false;
    if (select.faction !== undefined && read('Owner', 'faction') !== select.faction) return false;
    if (select.types !== undefined && !select.types.includes(str(read('Unit', 'type')) ?? '')) return false;
    if (select.member !== undefined && read('Member', 'role') !== select.member) return false;
    if (squad !== undefined && read('Member', 'squad') !== squad) return false;
    return true;
  });
}

/**
 * What a mission card shows of mission `def` in `world` now: the hero its `params.hero.select`
 * picks (by name; null without one or when it picks no one), the foes each `params.foes[].select`
 * picks (the mission's `event` when the selector names none; counted by type, named people by
 * name), and the ticks until the offered window for it closes. Params of another shape show no
 * hero and no foes. Reads only.
 */
export function missionCardFacts(world: World, def: MissionDef): MissionCardFacts {
  const params = obj(def.params as JsonValue | undefined);
  const heroSelect = selectOf(obj(params?.['hero'])?.['select']);
  const unit = (id: Entity): LostUnit => ({
    entity: id,
    key: null,
    name: str(obj(world.registered('Member') ? world.get(id, 'Member') : undefined)?.['name']),
    type: str(obj(world.registered('Unit') ? world.get(id, 'Unit') : undefined)?.['type']),
  });
  const heroIds = heroSelect === null ? [] : picked(world, heroSelect);
  const hero = heroIds.length === 1 ? (unit(heroIds[0]!).name ?? unit(heroIds[0]!).type) : null;
  const foeSpecs = Array.isArray(params?.['foes']) ? (params['foes'] as JsonValue[]) : [];
  const foes: Entity[] = [];
  for (const spec of foeSpecs) {
    const select = selectOf(obj(spec)?.['select']) ?? {};
    const withEvent =
      select.event === undefined && def.event !== undefined ? { ...select, event: def.event } : select;
    for (const id of picked(world, withEvent)) if (!foes.includes(id)) foes.push(id);
  }
  let ticksLeft: number | null = null;
  if (world.registered('Opportunities')) {
    const offer = opportunitiesOf(world)
      .offered()
      .find((o) => o.def.mission === def.id);
    if (offer?.closes !== null && offer?.closes !== undefined)
      ticksLeft = Math.max(0, offer.closes - world.tick);
  }
  return { hero, foes: lossText(foes.map(unit)), ticksLeft };
}
