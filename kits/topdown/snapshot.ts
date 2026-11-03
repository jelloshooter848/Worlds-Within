import type { HeadlessGame, JsonObject, JsonValue } from '@engine/core/headless';
import type { InputFrame } from '@engine/core/input/input-manager';
import type { TdEntity } from './entity';
import { typeNameOf } from './type-names';
import type { TopDownWorld } from './world';

/**
 * A read-only snapshot of a top-down world: plain JSON-safe data for the tools (`pnpm cli run`
 * and `dump`), state hashes and run-file checks. It reads the world and never changes it.
 *
 * Paths a run file can check (see `engine/tools/CLAUDE.md`):
 * - `frame`, `room` (the room on screen), `rng` (the RNG's state), `keys`, `found`, `visited`,
 *   `sliding` (the side of a room slide in progress, or null), `sealed`, `exited`;
 * - `hero.room`, `hero.x`, `hero.y` (room pixels), `hero.facing`, `hero.hp`, `hero.maxHp` (half
 *   hearts), `hero.attacking`, `hero.invuln`, `hero.dying`, `hero.dead`;
 * - `inventory.owned`, `inventory.current` (the item in the slot, or null), `inventory.ammo.<id>`;
 * - `entities` (the room's things, in update order): `{ kind, x, y, key, hp? }`, where `kind` is
 *   the enemy or pickup kind when it has one and the class name otherwise (`PushBlock`);
 * - `enemies`: how many living enemies are in the room;
 * - `events`: what happened on the last step (`TdEvent`s), when the snapshot comes from
 *   {@link topdownGame}.
 */
export interface TdSnapshot extends JsonObject {
  frame: number;
  room: string;
  rng: number;
  keys: number;
  found: string[];
  visited: string[];
  sliding: string | null;
  sealed: boolean;
  exited: boolean;
  hero: {
    room: string;
    x: number;
    y: number;
    facing: string;
    hp: number;
    maxHp: number;
    attacking: boolean;
    invuln: number;
    dying: boolean;
    dead: boolean;
  };
  inventory: { owned: string[]; current: string | null; ammo: { [id: string]: number } };
  entities: { kind: string; x: number; y: number; key: string | null; hp?: number }[];
  enemies: number;
  events: JsonObject[];
}

/** An entity's kind for a snapshot: its own `kind` (enemies, pickups, switches) or its class name (`typeNameOf`). */
function kindOf(e: TdEntity): string {
  const kind = (e as { kind?: unknown }).kind;
  return typeof kind === 'string' ? kind : typeNameOf(e);
}

/** Copies an event into plain JSON, dropping anything that is not JSON-safe (it never should be). */
function plainEvent(event: object): JsonObject {
  const out: JsonObject = {};
  for (const [k, v] of Object.entries(event)) {
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = v as JsonValue;
  }
  return out;
}

/** The world's state now, as JSON-safe data. `events` are the ones given (default: none). */
export function snapshotWorld(world: TopDownWorld, events: readonly object[] = []): TdSnapshot {
  const hero = world.hero;
  const inv = world.inv;
  const ammo: { [id: string]: number } = {};
  for (const item of inv.withAmmo()) ammo[item.id] = inv.count(item.id);
  return {
    frame: world.frame,
    room: world.room.id,
    rng: world.rng.state(),
    keys: world.keys,
    found: [...world.found].sort(),
    visited: world.visited().sort(),
    sliding: world.transition?.side ?? null,
    sealed: world.sealed,
    exited: world.exited,
    hero: {
      room: world.room.id,
      x: hero.x,
      y: hero.y,
      facing: hero.facing,
      hp: hero.hp,
      maxHp: hero.maxHp,
      attacking: hero.attacking,
      invuln: hero.invuln,
      dying: hero.dying > 0,
      dead: hero.dead,
    },
    inventory: { owned: [...inv.owned], current: inv.current?.id ?? null, ammo },
    entities: world.entities.map((e) => {
      const entry: TdSnapshot['entities'][number] = { kind: kindOf(e), x: e.x, y: e.y, key: e.key };
      const hp = (e as { hp?: unknown }).hp;
      if (typeof hp === 'number') entry.hp = hp;
      return entry;
    }),
    enemies: world.enemies().length,
    events: events.map(plainEvent),
  };
}

/**
 * A top-down world as a {@link HeadlessGame}: each step updates the world with the input and takes
 * the events it emitted (as a game's scene does each frame), so the snapshot lists the last
 * step's events.
 */
export function topdownGame(world: TopDownWorld): HeadlessGame {
  let last: object[] = world.events.splice(0);
  return {
    step(input: InputFrame) {
      world.update(input);
      last = world.events.splice(0);
    },
    snapshot: () => snapshotWorld(world, last),
  };
}
