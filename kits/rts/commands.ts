import type { MissionStepRefusal } from '@engine/core/headless';
import type { Order } from '@engine/core/orders';
import type { RuleSwitch } from '@engine/core/rules';
import { cellOf, type Selection, type WorldPoint } from './selection';
import { isFinished, thingAt, type RtsView } from './snapshot';

/**
 * The command mapper (Engine 0.9, the RTS view): a player's command on the selection becomes an
 * order as plain data (`engine/core/orders.ts`, item 122), without its `id`: an
 * {@link OrderDraft}. The game's adapter (`game.ts`) stamps the id when it applies it, so ids count
 * up from 1 across both sides in the order they are applied.
 *
 * - A **command** (right click, or a touch long-press) on a cell, with own units selected: on an
 *   enemy unit or building, `attack` it (rule `command-attacks-enemies`); on a resource node,
 *   the selected gatherers `gather` it (rule `command-gathers-resources`; the others move there);
 *   anywhere else, `move` there.
 * - **Build placement**: `buildCommand` sends the selected builders (units with `Worker`) to put
 *   up a building with its north-west corner on a cell.
 * - **Train buttons**: `trainCommand` queues one unit at each selected finished building that
 *   trains it.
 * - `stopCommand` stops the selected units.
 *
 * - **The launch command** (Engine 0.11, decision 4, item 175): `missionRequest` turns the
 *   player's click on an offered mission into a {@link MissionRequest}, and `launchMission` hands
 *   it to the game's mission host. A request is not an order and the kit opens nothing: the host
 *   (and the sim behind it) decides, and its refusal is reported, never thrown.
 *
 * Each returns null when nothing in the selection can take the command. Whether the order can be
 * carried out (a way there, the money for it) is the simulation's answer, never the kit's: it
 * refuses what it cannot do and the refusal is reported, not an error.
 */

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** An order without its `id` (stamped when it is applied). */
export type OrderDraft = DistributiveOmit<Order, 'id'>;

/** A draft with its id: the order as `engine/core/orders.ts` defines it. */
export function stampOrder(draft: OrderDraft, id: number): Order {
  return { id, ...draft } as Order;
}

/** The command on world point `p` for the selection (see the file comment), or null. */
export function commandAt(
  view: RtsView,
  selection: Selection,
  p: WorldPoint,
  tileSize: number,
  rules: RuleSwitch | null = null,
): OrderDraft | null {
  const units = selection.ownUnits(view);
  if (units.length === 0) return null;
  const faction = selection.faction;
  const ids = units.map((u) => u.id);
  const cell = cellOf(p, tileSize);
  const on = (id: string) => rules === null || rules.isOn(id);
  const thing = thingAt(view, cell.x, cell.y, faction);
  if (thing !== null && on('command-attacks-enemies')) {
    const enemy =
      thing.what === 'unit' && thing.unit.faction !== faction
        ? thing.unit.id
        : thing.what === 'building' && thing.building.faction !== faction
          ? thing.building.id
          : null;
    if (enemy !== null) return { faction, type: 'attack', units: ids, target: enemy };
  }
  if (thing?.what === 'resource' && on('command-gathers-resources')) {
    const gatherers = units.filter((u) => u.gatherer).map((u) => u.id);
    if (gatherers.length > 0) return { faction, type: 'gather', units: gatherers, target: thing.resource.id };
  }
  return { faction, type: 'move', units: ids, target: { x: cell.x, y: cell.y } };
}

/** Selected builders put up a `building` with its north-west cell at `cell`, or null when none can build. */
export function buildCommand(
  view: RtsView,
  selection: Selection,
  building: string,
  cell: { x: number; y: number },
): OrderDraft | null {
  const builders = selection.ownUnits(view).filter((u) => u.worker);
  if (builders.length === 0) return null;
  return {
    faction: selection.faction,
    type: 'build',
    units: builders.map((u) => u.id),
    target: { x: cell.x, y: cell.y },
    building,
  };
}

/** One `unit` queued at each selected finished building that trains it, or null when none does. */
export function trainCommand(view: RtsView, selection: Selection, unit: string): OrderDraft | null {
  const at = selection
    .ownBuildings(view)
    .filter((b) => isFinished(b) && b.producer !== null && b.producer.trains.includes(unit));
  if (at.length === 0) return null;
  return { faction: selection.faction, type: 'train', units: at.map((b) => b.id), target: unit };
}

/** The selected own units stop, or null when none is selected. */
export function stopCommand(view: RtsView, selection: Selection): OrderDraft | null {
  const units = selection.ownUnits(view);
  if (units.length === 0) return null;
  return { faction: selection.faction, type: 'stop', units: units.map((u) => u.id) };
}

/**
 * The train buttons for the selection: each unit type the selected finished own buildings can
 * train, in the order their `trains` lists give them (first building first), each once.
 */
export function trainButtons(view: RtsView, selection: Selection): string[] {
  const out: string[] = [];
  for (const b of selection.ownBuildings(view)) {
    if (!isFinished(b) || b.producer === null) continue;
    for (const unit of b.producer.trains) if (!out.includes(unit)) out.push(unit);
  }
  return out;
}

/** The player's request to launch a mission, through the opportunity offered now (null when none names it). */
export interface MissionRequest {
  mission: string;
  opportunity: string | null;
}

/**
 * The request to launch mission `id`, or null when the world gates it behind opportunities and
 * none of them is offered now (not yet open, run out, taken or closed). A mission no opportunity
 * names asks without one. Whether it can open (already open, committed, its event frozen by
 * another) is the sim's answer, given when the request is carried out.
 */
export function missionRequest(view: RtsView, id: string): MissionRequest | null {
  const offer = view.missions.offered.find((o) => o.mission === id);
  if (offer) return { mission: id, opportunity: offer.opportunity };
  return view.missions.gated.includes(id) ? null : { mission: id, opportunity: null };
}

/** The mission buttons: each mission offered now, in opportunity order, each once. */
export function missionButtons(view: RtsView): string[] {
  return [...new Set(view.missions.offered.map((o) => o.mission))];
}

/** What carries a launch out: a game's mission host (`MissionHost.launch` from `engine/core`). */
export interface MissionLauncher {
  launch(id: string): MissionStepRefusal | null;
}

/** A launch carried out, or refused with a code and a one-line reason. */
export type LaunchResult =
  | { ok: true; request: MissionRequest }
  | { ok: false; request: MissionRequest | null; code: string; error: string };

/**
 * The launch command: the request for mission `id` (`missionRequest`) carried out by `launcher`.
 * Not offered now: refused `not_offered` without asking the launcher. Otherwise the launcher's
 * answer: its refusal (the host's or the sim's code, e.g. `mission_open`, `opportunity_closed`,
 * `round_hosted`) comes back as the result, not as an error.
 */
export function launchMission(view: RtsView, id: string, launcher: MissionLauncher): LaunchResult {
  const request = missionRequest(view, id);
  if (request === null)
    return { ok: false, request, code: 'not_offered', error: `mission "${id}" is not offered now` };
  const refused = launcher.launch(request.mission);
  return refused === null
    ? { ok: true, request }
    : { ok: false, request, code: refused.code, error: refused.error };
}
