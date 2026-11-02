import type { HeadlessGame, JsonObject } from '@engine/core/headless';
import type { InputFrame } from '@engine/core/input/input-manager';
import type { PlatformerEvent, PlatformerWorld } from './world';

/**
 * A read-only snapshot of a platformer world: plain JSON-safe data for the tools (`pnpm cli run`
 * and `dump`), state hashes and run-file checks. It reads the world and never changes it, and it
 * holds state only (no poses, frames or colours). Every number is a whole number.
 *
 * Paths a run file can check:
 * - `frame`, `level` (its id), `rng` (the RNG's state), `outcome` (`playing`, `cleared` or
 *   `failed`), `coins`, `lives`, `scrollX` (the view's left edge, sub-pixels);
 * - `player.x`, `player.y`: the body position in sub-pixels (1/256 px), the bottom centre of its
 *   box, as the profile's `box` is placed; `player.vx`, `player.vy` in 1/4096 px per tick (down is
 *   positive); `player.onGround`, `player.facing` (-1 or 1), `player.jumping`, `player.skidding`,
 *   `player.runTimer` (ticks), `player.tier` (the jump tier's index in the profile's `jumps`),
 *   `player.hp`, `player.invuln` (ticks left);
 * - `actors`: every actor in the level, in spawn order: `id`, `type`, `x`/`y` (bottom centre),
 *   `vx`, `vy`, `dir`, `speed`, `active`, `onGround`, `grace`;
 * - `tiles`: the cells changed since the start, in reading order (`col`, `row`, `cell`);
 * - `events`: what happened on the last step (`PlatformerEvent`s), when the snapshot comes from
 *   {@link platformerGame}.
 */
export interface PlatformerSnapshot extends JsonObject {
  frame: number;
  level: string;
  rng: number;
  outcome: string;
  coins: number;
  lives: number;
  scrollX: number;
  player: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    onGround: boolean;
    facing: number;
    jumping: boolean;
    skidding: boolean;
    runTimer: number;
    tier: number;
    hp: number;
    invuln: number;
  };
  actors: {
    id: number;
    type: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    dir: number;
    speed: number;
    active: boolean;
    onGround: boolean;
    grace: number;
  }[];
  tiles: { col: number; row: number; cell: string }[];
  events: JsonObject[];
}

/** The world's state now, as JSON-safe data. `events` are the ones given (default: none). */
export function snapshotWorld(
  world: PlatformerWorld,
  events: readonly PlatformerEvent[] = [],
): PlatformerSnapshot {
  const p = world.player;
  const b = p.body;
  return {
    frame: world.frame,
    level: world.level.id,
    rng: world.rng.state(),
    outcome: world.outcome,
    coins: world.coins,
    lives: world.lives,
    scrollX: world.scrollX,
    player: {
      x: b.x + (b.w >> 1),
      y: b.y + b.h,
      vx: b.vx,
      vy: b.vy,
      onGround: b.onGround,
      facing: p.facing,
      jumping: p.jumping,
      skidding: p.skidding,
      runTimer: p.runTimer,
      tier: world.profile.player.jumps.indexOf(p.tier),
      hp: p.hp,
      invuln: p.invuln,
    },
    actors: world.actors.map((a) => ({
      id: a.id,
      type: a.type,
      x: a.feet.x,
      y: a.feet.y,
      vx: a.body.vx,
      vy: a.body.vy,
      dir: a.dir,
      speed: a.speed,
      active: a.active,
      onGround: a.body.onGround,
      grace: a.grace,
    })),
    tiles: world.tiles.changed().map((c) => ({ ...c })),
    events: events.map((e) => ({ ...e })),
  };
}

/**
 * A platformer world as a {@link HeadlessGame}: each step updates the world with the input and
 * takes the events it emitted (as a game's scene does each frame), so the snapshot lists the last
 * step's events.
 */
export function platformerGame(world: PlatformerWorld): HeadlessGame {
  let last: PlatformerEvent[] = world.events.splice(0);
  return {
    step(input: InputFrame) {
      world.update(input);
      last = world.events.splice(0);
    },
    snapshot: () => snapshotWorld(world, last),
  };
}
