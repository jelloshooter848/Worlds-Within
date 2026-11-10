import type { HeadlessGame, JsonObject } from '@engine/core/headless';
import type { InputFrame } from '@engine/core/input/input-manager';
import type { EndedRound, PlatformerEvent, PlatformerWorld } from './world';

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
 *   `player.hp`, `player.invuln` (ticks left); `player.coyote` (coyote ticks left: only when the
 *   profile gives `coyote` over 0, so other snapshots hash as before);
 * - `actors`: every actor in the level, in spawn order: `id`, `type`, `x`/`y` (bottom centre),
 *   `vx`, `vy`, `dir`, `speed`, `active`, `onGround`, `grace`;
 * - `checkpoint`: the checkpoint the player touched last (`col`, `row`) or null; only in a level
 *   with checkpoint cells (`K`), so other snapshots hash as before;
 * - `tiles`: the cells changed since the start, in reading order (`col`, `row`, `cell`);
 * - `triggers`: every mini-game trigger, in reading order: `col`, `row`, `game`, `armed`,
 *   `attempts`;
 * - `miniGame`: the round being played over the level (`trigger`, `game`, and `state`, the mini
 *   game's own snapshot), or null;
 * - `endedRound`: only on the tick a round ends (gap G20, Engine 0.10; left out on every other
 *   tick, so snapshots without one hash as before): `trigger`, `game`, `result`, `state` (the
 *   round's final `snapshot()`, with its last step's events when the mini game keeps them, as a
 *   room challenge's `state.events`) and `report` (its structured `report()`, when it has one);
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
    coyote?: number;
  };
  checkpoint?: { col: number; row: number } | null;
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
  triggers: { col: number; row: number; game: string; armed: boolean; attempts: number }[];
  miniGame: { trigger: number; game: string; state: JsonObject } | null;
  endedRound?: EndedRoundSnapshot;
  events: JsonObject[];
}

/** A round on the tick it ended (`PlatformerSnapshot.endedRound`). */
export interface EndedRoundSnapshot extends JsonObject {
  trigger: number;
  game: string;
  result: string;
  state: JsonObject;
  report?: JsonObject;
}

/** The ended round as snapshot data: its final state, result and report (when it has one). */
export function snapshotEndedRound(ended: EndedRound): EndedRoundSnapshot {
  const report = ended.game.report?.();
  return {
    trigger: ended.trigger.index,
    game: ended.def.id,
    result: ended.result,
    state: ended.game.snapshot(),
    ...(report ? { report } : {}),
  };
}

/**
 * The world's state now, as JSON-safe data. `events` are the ones given (default: none);
 * `ended` is the round that ended on the last step (default: the world's `endedRound`; a host that
 * did not step the world on its last step, as a level sequence between levels, passes null).
 */
export function snapshotWorld(
  world: PlatformerWorld,
  events: readonly PlatformerEvent[] = [],
  ended: EndedRound | null = world.endedRound,
): PlatformerSnapshot {
  const p = world.player;
  const b = p.body;
  const run = world.miniGame;
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
      ...((world.profile.player.coyote ?? 0) > 0 ? { coyote: p.coyoteLeft } : {}),
    },
    ...(world.checkpoints.length > 0 ? { checkpoint: world.checkpoint && { ...world.checkpoint } } : {}),
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
    triggers: world.triggers.map((t) => ({
      col: t.col,
      row: t.row,
      game: t.def.game,
      armed: t.armed,
      attempts: t.attempts,
    })),
    miniGame: run && { trigger: run.trigger.index, game: run.def.id, state: run.game.snapshot() },
    ...(ended ? { endedRound: snapshotEndedRound(ended) } : {}),
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
