import type { InputFrame } from '@engine/core/input/input-manager';
import { overlaps } from '@engine/core/math/aabb';
import { clamp, px, tileAt, tileToSub } from '@engine/core/math/units';
import { Rng } from '@engine/core/rng';
import { RuleSwitch } from '@engine/core/rules';
import { Actor, DEFAULT_KICK_GRACE } from './actor';
import { checkLevel, levelCells, type LevelCell, type LevelDef } from './level';
import { Player } from './player';
import type { ProfileDef } from './profile';
import { PLATFORMER_RULES } from './rules';
import { TileGrid } from './tiles';

/** How a death came about. */
export type DeathCause = 'pit' | 'hazard' | 'hurt';

/** What happened on a step, for sounds, presentation and run-file checks. */
export type PlatformerEvent =
  | { type: 'jump'; tier: number }
  | { type: 'land' }
  | { type: 'bump'; col: number; row: number }
  | { type: 'block'; col: number; row: number; content: string }
  | { type: 'break'; col: number; row: number }
  | { type: 'coin'; col: number; row: number; coins: number }
  | { type: 'spawn'; actor: number; actorType: string }
  | { type: 'stomp'; actor: number; actorType: string; into: string | null }
  | { type: 'kick'; actor: number; dir: number }
  | { type: 'defeat'; actor: number; actorType: string; by: number }
  | { type: 'hurt'; hp: number }
  | { type: 'died'; cause: DeathCause; lives: number }
  | { type: 'respawn' }
  | { type: 'cleared' };

/** Where the level stands: still being played, cleared at a goal, or failed (no lives left). */
export type Outcome = 'playing' | 'cleared' | 'failed';

/** How many coins a `coins` bump block gives, one a bump, before it is used. */
export const MULTI_COIN_HITS = 10;
/** Actors wake once they are this close to the view's left or right edge (sub-pixels). */
export const WAKE_MARGIN = tileToSub(2);
/** The view's width when the world is given none, in px (the NES screen's). */
export const DEFAULT_VIEW_WIDTH = 256;

export interface PlatformerWorldOptions {
  seed?: number;
  /**
   * Kit rules switched off (ids from PLATFORMER_RULES, `rules.ts`), for mutant checks. An unknown
   * id throws. Left out, every rule is on.
   */
  disabledRules?: readonly string[];
  /** The view's width in px, for scrolling and waking actors (256 when left out). */
  viewWidth?: number;
}

/**
 * A headless platformer world: one level, its physics profile, the player and the level's actors,
 * stepped once per tick from an input frame (left/right, run or attack, jump). Whole numbers only:
 * positions in sub-pixels, velocities in 1/4096 px per tick (`engine/core/math/units.ts`).
 *
 * Update order per tick (nothing happens once the outcome is `cleared` or `failed`):
 *   1. the player's invulnerability counts down, and the player moves (`player.ts`);
 *   2. a head bump uses a bump block (`bump-blocks`) or breaks a brick (`brick-break`);
 *   3. the level's edges (`level-bounds`) and, scrolling right, the view's left edge
 *      (`scroll-lock`) hold the player in; then the view follows the player (`scrollX`);
 *   4. actors near the view wake (`actors-wake`), active ones move (`actor.ts`) and moving shells
 *      defeat the actors they touch (`shell-hits-enemies`); actors below the level are gone;
 *   5. the player touches actors: a still shell is kicked (`shell-kick`), a fall from above
 *      stomps (`stomping`, `stomp-bounce`), else a harmful one hurts (`enemy-touch-hurts`);
 *   6. the player touches tiles: coins (`coins-collect`), hazards (`hazards-kill`) and goals
 *      (`goal-clears-level`);
 *   7. a player whose top is below the last row dies (`pits-kill`).
 *
 * A death takes a life; with lives left the player starts again at the start, else the outcome is
 * `failed`. Everything random comes from `rng` (seeded), so the same level, seed and input give the
 * same run.
 */
export class PlatformerWorld {
  readonly rng: Rng;
  readonly rules: RuleSwitch;
  readonly tiles: TileGrid;
  player: Player;
  readonly actors: Actor[] = [];
  readonly events: PlatformerEvent[] = [];
  frame = 0;
  outcome: Outcome = 'playing';
  coins = 0;
  lives: number;
  /** The view's left edge, in sub-pixels. */
  scrollX = 0;
  readonly viewWidth: number;
  private readonly start: LevelCell;
  /** What each bump block holds, by tile index; and how often a `coins` block has given. */
  private readonly contents = new Map<number, string>();
  private readonly hits = new Map<number, number>();
  private nextId = 1;

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
    this.viewWidth = opts.viewWidth ?? DEFAULT_VIEW_WIDTH;
    this.lives = profile.player.lives;
    const cells = levelCells(level);
    const start = cells.find((c) => c.ch === '@');
    if (!start) throw new Error(`level "${level.id}" has no start`); // checkLevel has caught it
    this.start = start;
    this.player = Player.atStart(start.col, start.row, profile.player, this.rules);
    const bumps = cells.filter((c) => c.ch === '?');
    bumps.forEach((c, i) => this.contents.set(this.index(c.col, c.row), level.blocks?.[i] ?? 'coin'));
    for (const c of cells) {
      const spawn = Object.hasOwn(level.spawns, c.ch) ? level.spawns[c.ch] : undefined;
      if (spawn)
        this.addActor(
          spawn.actor,
          tileToSub(c.col) + tileToSub(1) / 2,
          tileToSub(c.row + 1),
          spawn.facing === 'right' ? 1 : -1,
        );
    }
  }

  emit(e: PlatformerEvent): void {
    this.events.push(e);
  }

  /** One tick. */
  update(input: InputFrame): void {
    this.frame++;
    if (this.outcome !== 'playing') return;
    const p = this.player;
    if (p.invuln > 0) p.invuln--;
    const prevBottom = p.body.y + p.body.h;
    const did = p.step(input, this.tiles);
    if (did.jumped) this.emit({ type: 'jump', tier: this.profile.player.jumps.indexOf(p.tier) });
    if (did.bumped) {
      this.emit({ type: 'bump', ...did.bumped });
      this.hitBlock(did.bumped.col, did.bumped.row);
    }
    if (did.landed) this.emit({ type: 'land' });
    if (this.rules.isOn('level-bounds')) this.holdInBounds();
    this.holdInView();
    this.scroll();
    this.moveActors();
    this.touchActors(prevBottom);
    if (this.player === p) this.touchTiles();
    if (this.player === p && this.outcome === 'playing' && p.body.y >= tileToSub(this.tiles.rows)) {
      if (this.rules.isOn('pits-kill')) this.die('pit');
    }
  }

  private index(col: number, row: number): number {
    return row * this.tiles.cols + col;
  }

  private addActor(type: string, x: number, y: number, dir: -1 | 1): Actor {
    const a = new Actor(this.nextId++, type, this.profile.actors[type]!, x, y, dir);
    this.actors.push(a);
    return a;
  }

  /** A head bump on the tile at col/row: a bump block gives what it holds, a brick may break. */
  private hitBlock(col: number, row: number): void {
    const cell = this.tiles.cellAt(col, row);
    if (cell === 'bump' && this.rules.isOn('bump-blocks')) {
      const i = this.index(col, row);
      const content = this.contents.get(i) ?? 'coin';
      this.emit({ type: 'block', col, row, content });
      const hits = (this.hits.get(i) ?? 0) + 1;
      this.hits.set(i, hits);
      if (content !== 'coins' || hits >= MULTI_COIN_HITS) this.tiles.setCell(col, row, 'used');
      this.give(content, col, row);
    } else if (cell === 'brick' && this.rules.isOn('brick-break')) {
      const at = this.profile.player.breakBricksAt;
      if (at === undefined || this.player.hp < at) return;
      this.tiles.setCell(col, row, 'empty');
      this.emit({ type: 'break', col, row });
    }
  }

  /** What a bump block at col/row gives the player. */
  private give(content: string, col: number, row: number): void {
    const pp = this.profile.player;
    if (content === 'coin' || content === 'coins') {
      this.coins++;
      this.emit({ type: 'coin', col, row, coins: this.coins });
    } else if (content === 'powerup') {
      this.player.hp = Math.min(this.player.hp + 1, pp.maxHp ?? pp.hp);
    } else if (content === 'life') {
      this.lives++;
    } else if (content.startsWith('actor:')) {
      const type = content.slice('actor:'.length);
      const a = this.addActor(type, tileToSub(col) + tileToSub(1) / 2, tileToSub(row), this.player.facing);
      a.active = true;
      this.emit({ type: 'spawn', actor: a.id, actorType: type });
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

  /** Scrolling right, the view cannot go back: its left edge stops the player (`scroll-lock`). */
  private holdInView(): void {
    if (this.level.scroll !== 'right' || !this.rules.isOn('scroll-lock')) return;
    const b = this.player.body;
    if (b.x >= this.scrollX) return;
    b.x = this.scrollX;
    if (b.vx < 0) b.vx = 0;
  }

  /**
   * The view follows the player's centre (held at the view's middle) inside the level. `none`
   * never scrolls; `right` never scrolls back while `scroll-lock` is on.
   */
  private scroll(): void {
    if (this.level.scroll === 'none') return;
    const b = this.player.body;
    const view = px(this.viewWidth);
    const max = Math.max(0, tileToSub(this.tiles.cols) - view);
    const target = clamp(b.x + (b.w >> 1) - (view >> 1), 0, max);
    const locked = this.level.scroll === 'right' && this.rules.isOn('scroll-lock');
    this.scrollX = locked ? Math.max(this.scrollX, target) : target;
  }

  /** Wakes actors near the view, moves the active ones and lets moving shells hit the others. */
  private moveActors(): void {
    const left = this.scrollX - WAKE_MARGIN;
    const right = this.scrollX + px(this.viewWidth) + WAKE_MARGIN;
    for (const a of this.actors) {
      if (a.active) continue;
      const b = a.body;
      if (!this.rules.isOn('actors-wake') || (b.x < right && b.x + b.w > left)) a.active = true;
    }
    for (const a of this.actors) if (a.active) a.step(this.tiles, this.profile, this.rules);
    const bottom = tileToSub(this.tiles.rows);
    this.remove((a) => a.body.y >= bottom);
    if (!this.rules.isOn('shell-hits-enemies')) return;
    for (const s of [...this.actors]) {
      if (!s.isMovingShell || !this.actors.includes(s)) continue;
      for (const o of [...this.actors]) {
        if (o === s || !o.active || !overlaps(s.body, o.body)) continue;
        this.remove((a) => a === o);
        this.emit({ type: 'defeat', actor: o.id, actorType: o.type, by: s.id });
      }
    }
  }

  private remove(gone: (a: Actor) => boolean): void {
    for (let i = this.actors.length - 1; i >= 0; i--) if (gone(this.actors[i]!)) this.actors.splice(i, 1);
  }

  /** The player against each active actor it overlaps: a kick, a stomp or a hurt. */
  private touchActors(prevBottom: number): void {
    const p = this.player;
    const pb = p.body;
    for (const a of [...this.actors]) {
      if (this.player !== p || this.outcome !== 'playing') return;
      if (!a.active || a.grace > 0 || !this.actors.includes(a) || !overlaps(pb, a.body)) continue;
      const def = a.def;
      if (def.kickable && a.speed === 0 && this.rules.isOn('shell-kick')) {
        a.dir = pb.x + (pb.w >> 1) < a.body.x + (a.body.w >> 1) ? 1 : -1;
        a.speed = def.kickSpeed ?? 0;
        a.grace = def.kickGrace ?? DEFAULT_KICK_GRACE;
        this.emit({ type: 'kick', actor: a.id, dir: a.dir });
        continue;
      }
      // SMBC's stomp test: moving down this tick, with the feet before the move in the top 3/5.
      const fromAbove = pb.y + pb.h > prevBottom && prevBottom <= a.body.y + Math.trunc((a.body.h * 3) / 5);
      if (fromAbove && def.stompable && this.rules.isOn('stomping')) {
        this.stomp(a);
        continue;
      }
      if (def.harms && this.rules.isOn('enemy-touch-hurts')) this.hurt();
    }
  }

  /** A stomp: the actor becomes its `stompInto` type (same id, place and way) or is defeated. */
  private stomp(a: Actor): void {
    const into = a.def.stompInto ?? null;
    const i = this.actors.indexOf(a);
    if (into === null) this.actors.splice(i, 1);
    else {
      const def = this.profile.actors[into]!;
      const next = new Actor(a.id, into, def, a.feet.x, a.feet.y, a.dir);
      next.active = true;
      next.grace = def.kickGrace ?? DEFAULT_KICK_GRACE;
      this.actors[i] = next;
    }
    this.emit({ type: 'stomp', actor: a.id, actorType: a.type, into });
    if (this.rules.isOn('stomp-bounce')) this.player.bounce(this.profile.player.stompBounce);
  }

  /** A harm: one hit point off, unless the player is invulnerable; at 0 the player dies. */
  private hurt(): void {
    const p = this.player;
    if (p.invuln > 0) return;
    p.hp--;
    if (p.hp <= 0) return this.die('hurt');
    if (this.rules.isOn('invulnerability')) p.invuln = this.profile.player.invulnTicks;
    this.emit({ type: 'hurt', hp: p.hp });
  }

  /** The tiles the player's box covers: coins, hazards and goals. */
  private touchTiles(): void {
    const b = this.player.body;
    for (let row = tileAt(b.y); row <= tileAt(b.y + b.h - 1); row++) {
      for (let col = tileAt(b.x); col <= tileAt(b.x + b.w - 1); col++) {
        const cell = this.tiles.cellAt(col, row);
        if (cell === 'coin' && this.rules.isOn('coins-collect')) {
          this.tiles.setCell(col, row, 'empty');
          this.coins++;
          this.emit({ type: 'coin', col, row, coins: this.coins });
        } else if (cell === 'hazard' && this.rules.isOn('hazards-kill')) {
          return this.die('hazard');
        } else if (cell === 'goal' && this.rules.isOn('goal-clears-level')) {
          this.outcome = 'cleared';
          this.emit({ type: 'cleared' });
          return;
        }
      }
    }
  }

  /** A death: a life off; with lives left the player starts again at the start, else `failed`. */
  private die(cause: DeathCause): void {
    this.lives--;
    this.emit({ type: 'died', cause, lives: this.lives });
    if (this.lives <= 0) {
      this.outcome = 'failed';
      return;
    }
    this.player = Player.atStart(this.start.col, this.start.row, this.profile.player, this.rules);
    this.scrollX = 0;
    this.scroll();
    this.emit({ type: 'respawn' });
  }
}
