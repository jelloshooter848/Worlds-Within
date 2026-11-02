import type { InputFrame } from '@engine/core/input/input-manager';
import { px, sign, tileToSub, velToSub } from '@engine/core/math/units';
import type { RuleSwitch } from '@engine/core/rules';
import { makeBody, moveX, moveY, type Body } from './body';
import type { ProfileDef } from './profile';
import type { TileGrid } from './tiles';

/** The player's movement numbers (a profile's `player`). */
export type PlayerProfile = ProfileDef['player'];
/** One jump tier of a profile. */
export type JumpTier = PlayerProfile['jumps'][number];

/** What one player step did, for the world's events. */
export interface PlayerStepEvents {
  jumped: boolean;
  landed: boolean;
  bumped: { col: number; row: number } | null;
}

/**
 * The player: a body moved by a physics profile, SMBC style, once per tick. Every number comes
 * from the profile; every rule is switchable (`rules.ts`).
 *
 * A tick:
 *   1. run: holding run (or attack) sets the run timer to `runHold`, else it counts down;
 *   2. on the ground, walk, run, friction and skid change vx; in the air, air control does;
 *   3. a jump press (remembered `jumpBuffer` ticks) on the ground takes off with the tier picked by
 *      |vx|, and the air speed cap becomes `maxRun` only after a real run (|vx| > maxWalk);
 *   4. the body moves, x then y (a standing body probes 1 sub-pixel down to stay on the ground);
 *   5. on the ground the jump ends; in the air gravity applies (the tier's `holdGravity` while
 *      jump is held and the player rises, else its `gravity`), and a fall past `maxFall` drops
 *      back to `fallReset`.
 */
export class Player {
  readonly body: Body;
  facing: -1 | 1 = 1;
  /** Ticks the run cap still lasts after run was let go. */
  runTimer = 0;
  /** In a jump (from take-off until landing). */
  jumping = false;
  /** Braking against the motion this tick. */
  skidding = false;
  /** The jump tier for the next take-off, or the one of the jump in progress. */
  tier: JumpTier;
  /** The speed cap in the air, set at take-off. */
  airCap: number;
  /** Hit points (the power level): a harm takes one, at 0 the player dies. */
  hp: number;
  /** Ticks left in which the player cannot be harmed (after a hit). */
  invuln = 0;

  constructor(
    x: number,
    y: number,
    readonly profile: PlayerProfile,
    private readonly rules: RuleSwitch,
  ) {
    this.body = makeBody(x, y, profile.box.w, profile.box.h);
    this.tier = this.pickTier(0);
    this.airCap = profile.maxWalk;
    this.hp = profile.hp;
  }

  /** Bounces the player up at `speed` (a stomp), with the normal gravity: not a held jump. */
  bounce(speed: number): void {
    this.body.vy = -speed;
    this.body.onGround = false;
    this.jumping = false;
  }

  /**
   * The player placed in the start tile at col/row: centred in it, feet on its bottom edge. As in
   * SMBC it starts not yet on the ground: the first tick is an air tick (air control, the first
   * tier's gravity), and the second one's fall lands it (the golden traces check this).
   */
  static atStart(col: number, row: number, profile: PlayerProfile, rules: RuleSwitch): Player {
    const x = tileToSub(col) + ((tileToSub(1) - px(profile.box.w)) >> 1);
    const y = tileToSub(row + 1) - px(profile.box.h);
    return new Player(x, y, profile, rules);
  }

  /** The jump tier for a take-off at `vx`: the first whose `below` is over |vx| (the last else). */
  pickTier(vx: number): JumpTier {
    const jumps = this.profile.jumps;
    if (!this.rules.isOn('jump-by-speed')) return jumps[0] as JumpTier;
    const a = Math.abs(vx);
    return jumps.find((t) => t.below !== undefined && a < t.below) ?? (jumps.at(-1) as JumpTier);
  }

  /** One tick of movement. */
  step(input: InputFrame, tiles: TileGrid): PlayerStepEvents {
    const p = this.profile;
    const b = this.body;
    const r = this.rules;
    const dir = input.dirX;
    const wantRun = r.isOn('run-speed') && (input.held('run') || input.held('attack'));
    if (wantRun) this.runTimer = r.isOn('run-hold') ? p.runHold : 0;
    else if (this.runTimer > 0) this.runTimer--;
    const running = wantRun || this.runTimer > 0;
    this.skidding = false;
    const wasOnGround = b.onGround;

    if (b.onGround) this.groundMove(dir, running);
    else this.airMove(dir);

    let jumped = false;
    const pressed = (p.jumpBuffer ?? 0) > 0 ? input.bufferedJump(p.jumpBuffer ?? 0) : input.pressed('jump');
    if (r.isOn('jump') && b.onGround && pressed) {
      input.consumeJumpBuffer();
      this.tier = this.pickTier(b.vx);
      b.vy = -this.tier.speed;
      b.onGround = false;
      this.jumping = true;
      this.airCap = Math.abs(b.vx) > p.maxWalk ? p.maxRun : p.maxWalk;
      jumped = true;
    }
    const holding = r.isOn('variable-jump') && this.jumping && input.held('jump') && b.vy < 0;

    if (b.vx !== 0) this.facing = sign(b.vx) as -1 | 1;
    else if (dir !== 0) this.facing = dir;

    moveX(b, tiles, velToSub(b.vx));
    // Like the NES: the take-off speed moves the body on the take-off tick, gravity comes after.
    const dy = b.onGround ? Math.max(velToSub(b.vy), 1) : velToSub(b.vy);
    moveY(b, tiles, dy, r.isOn('ceiling-bump'));

    if (b.onGround) {
      this.tier = this.pickTier(b.vx);
      this.jumping = false;
      b.vy = 0;
    } else if (r.isOn('gravity')) {
      b.vy += holding ? this.tier.holdGravity : this.tier.gravity;
      if (r.isOn('fall-cap') && b.vy > p.maxFall) b.vy = p.fallReset;
    }
    return { jumped, landed: b.onGround && !wasOnGround, bumped: b.bumped };
  }

  /** Walking, running, friction and skids on the ground. */
  private groundMove(dir: -1 | 0 | 1, running: boolean): void {
    const p = this.profile;
    const b = this.body;
    const r = this.rules;
    if (dir === 0 || !r.isOn('walk')) {
      if (!r.isOn('friction')) return;
      const a = Math.abs(b.vx) - p.friction;
      b.vx = a < p.minWalk ? 0 : sign(b.vx) * a;
      return;
    }
    if (b.vx === 0) {
      b.vx = dir * p.minWalk;
      return;
    }
    if (sign(b.vx) !== dir && r.isOn('skid')) {
      this.skidding = true;
      const a = Math.abs(b.vx) - p.skid;
      b.vx = a <= p.skidTurn ? dir * p.minWalk : sign(b.vx) * a;
      return;
    }
    // Without the skid rule, holding the other way only walks against the motion.
    if (sign(b.vx) !== dir) {
      b.vx += dir * p.walkAccel;
      return;
    }
    const cap = running ? p.maxRun : p.maxWalk;
    const accel = running ? p.runAccel : p.walkAccel;
    let a = Math.abs(b.vx) + accel;
    // Over the cap (a run let go): slow down to it at the friction rate.
    if (a > cap) a = Math.max(cap, Math.abs(b.vx) - p.friction);
    b.vx = dir * a;
  }

  /** Steering in the air (SMB1 style): towards the cap set at take-off, no friction. */
  private airMove(dir: -1 | 0 | 1): void {
    const p = this.profile;
    const b = this.body;
    if (dir === 0 || !this.rules.isOn('air-control')) return;
    const accel = Math.abs(b.vx) > p.maxWalk ? p.runAccel : p.walkAccel;
    if (b.vx === 0) b.vx = dir * p.minWalk;
    else if (sign(b.vx) !== dir) b.vx += dir * accel;
    else b.vx = dir * Math.min(Math.abs(b.vx) + accel, Math.max(this.airCap, Math.abs(b.vx)));
  }
}
