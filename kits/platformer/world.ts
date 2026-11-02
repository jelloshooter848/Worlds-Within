import type { InputFrame } from '@engine/core/input/input-manager';
import { tileToSub } from '@engine/core/math/units';
import { Rng } from '@engine/core/rng';
import { RuleSwitch } from '@engine/core/rules';
import { checkLevel, levelCells, type LevelDef } from './level';
import { Player } from './player';
import type { ProfileDef } from './profile';
import { PLATFORMER_RULES } from './rules';
import { TileGrid } from './tiles';

/** What happened on a step, for sounds, presentation and run-file checks. */
export type PlatformerEvent =
  | { type: 'jump'; tier: number }
  | { type: 'land' }
  | { type: 'bump'; col: number; row: number }
  | { type: 'fell' };

export interface PlatformerWorldOptions {
  seed?: number;
  /**
   * Kit rules switched off (ids from PLATFORMER_RULES, `rules.ts`), for mutant checks. An unknown
   * id throws. Left out, every rule is on.
   */
  disabledRules?: readonly string[];
}

/**
 * A headless platformer world: one level, its physics profile and the player, stepped once per
 * tick from an input frame (left/right, run or attack, jump). Whole numbers only: positions in
 * sub-pixels, velocities in 1/4096 px per tick (`engine/core/math/units.ts`).
 *
 * Update order per tick:
 *   1. the player moves (`player.ts`: run timer, ground or air speed, jump, x then y, gravity);
 *   2. the level's left and right edges hold the player in (`level-bounds`);
 *   3. a player whose top is below the last row has fallen into a pit and stops (`fell`).
 *
 * Everything random comes from `rng` (seeded), so the same level, seed and input give the same run.
 */
export class PlatformerWorld {
  readonly rng: Rng;
  readonly rules: RuleSwitch;
  readonly tiles: TileGrid;
  readonly player: Player;
  readonly events: PlatformerEvent[] = [];
  frame = 0;
  /** The player fell below the level. */
  fell = false;

  constructor(
    readonly level: LevelDef,
    readonly profile: ProfileDef,
    opts: PlatformerWorldOptions = {},
  ) {
    const problems = checkLevel(level, profile);
    if (problems.length > 0) {
      const list = problems.map((p) => `${p.code} at ${p.path.join('.') || '(level)'}`).join('; ');
      throw new Error(`level "${level.id}" does not check: ${list}`);
    }
    if (level.profile !== profile.id)
      throw new Error(`level "${level.id}" is played with profile "${level.profile}", not "${profile.id}"`);
    // Mix the seed and skip a few draws: xorshift's first numbers from a small seed are small.
    this.rng = new Rng(Math.imul((opts.seed ?? 0x5eed) ^ 0x9e3779b9, 0x85ebca6b) >>> 0);
    for (let i = 0; i < 8; i++) this.rng.next();
    this.rules = new RuleSwitch(PLATFORMER_RULES, opts.disabledRules);
    this.tiles = new TileGrid(level, this.rules);
    const start = levelCells(level).find((c) => c.ch === '@');
    if (!start) throw new Error(`level "${level.id}" has no start`); // checkLevel has caught it
    this.player = Player.atStart(start.col, start.row, profile.player, this.rules);
  }

  emit(e: PlatformerEvent): void {
    this.events.push(e);
  }

  /** One tick. */
  update(input: InputFrame): void {
    this.frame++;
    if (this.fell) return;
    const p = this.player;
    const did = p.step(input, this.tiles);
    if (did.jumped) this.emit({ type: 'jump', tier: this.profile.player.jumps.indexOf(p.tier) });
    if (did.bumped) this.emit({ type: 'bump', ...did.bumped });
    if (did.landed) this.emit({ type: 'land' });
    if (this.rules.isOn('level-bounds')) this.holdInBounds();
    if (p.body.y >= tileToSub(this.tiles.rows)) {
      this.fell = true;
      this.emit({ type: 'fell' });
    }
  }

  /** Keeps the player between the level's left and right edges, stopping a move outwards. */
  private holdInBounds(): void {
    const b = this.player.body;
    const right = tileToSub(this.tiles.cols);
    if (b.x < 0) {
      b.x = 0;
      if (b.vx < 0) b.vx = 0;
    } else if (b.x + b.w > right) {
      b.x = right - b.w;
      if (b.vx > 0) b.vx = 0;
    }
  }
}
