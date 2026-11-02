import type { HeadlessGame, JsonObject } from '@engine/core/headless';
import type { InputFrame } from '@engine/core/input/input-manager';
import type { PlatformerEvent, PlatformerWorld } from './world';

/**
 * A read-only snapshot of a platformer world: plain JSON-safe data for the tools (`pnpm cli run`
 * and `dump`), state hashes and run-file checks. It reads the world and never changes it, and it
 * holds state only (no poses, frames or colours). Every number is a whole number.
 *
 * Paths a run file can check:
 * - `frame`, `level` (its id), `rng` (the RNG's state), `fell`;
 * - `player.x`, `player.y`: the body position in sub-pixels (1/256 px), the bottom centre of its
 *   box, as the profile's `box` is placed; `player.vx`, `player.vy` in 1/4096 px per tick (down is
 *   positive); `player.onGround`, `player.facing` (-1 or 1), `player.jumping`, `player.skidding`,
 *   `player.runTimer` (ticks), `player.tier` (the jump tier's index in the profile's `jumps`);
 * - `events`: what happened on the last step (`PlatformerEvent`s), when the snapshot comes from
 *   {@link platformerGame}.
 */
export interface PlatformerSnapshot extends JsonObject {
  frame: number;
  level: string;
  rng: number;
  fell: boolean;
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
  };
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
    fell: world.fell,
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
    },
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
