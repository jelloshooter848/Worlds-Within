import type { JsonObject } from '@engine/core/headless';
import type { InputFrame } from '@engine/core/input/input-manager';
import { overlaps } from '@engine/core/math/aabb';
import { clamp, px, tileAt, tileToSub } from '@engine/core/math/units';
import {
  hostStatusFor,
  miniGameTable,
  RoundInput,
  type MiniGame,
  type MiniGameDef,
  type MiniGameResult,
} from '@engine/core/minigame';
import { Rng } from '@engine/core/rng';
import { RuleSwitch } from '@engine/core/rules';
import { Actor, DEFAULT_KICK_GRACE } from './actor';
import { stepOver, stepSpeed } from './boss';
import { checkLevel, levelCells, type LevelCell, type LevelDef, type LevelTrigger } from './level';
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
  | { type: 'checkpoint'; col: number; row: number }
  | { type: 'cleared' }
  | { type: 'mini-game'; trigger: number; game: string; attempt: number }
  | { type: 'mini-game-end'; trigger: number; game: string; result: MiniGameResult }
  | { type: 'boss-telegraph'; actor: number; actorType: string; attack: string; ticks: number }
  | { type: 'boss-attack'; actor: number; actorType: string; attack: BossAttack; projectile?: number }
  | {
      type: 'boss-hit';
      actor: number;
      actorType: string;
      hp: number;
      maxHp: number;
      phase: number;
      invuln: number;
    }
  | { type: 'boss-defeat'; actor: number; actorType: string; ticks: number };

/** What a boss's `boss-attack` event names: the pattern step that attacks. */
export type BossAttack = 'charge' | 'leap' | 'shoot' | 'drop';

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
  /**
   * The mini games the level's triggers name, supplied by the game (`engine/core/minigame.ts`).
   * A trigger naming an id that is not here throws.
   */
  miniGames?: readonly MiniGameDef[];
}

/** One mini-game trigger (`!`) of the level: where it is, its data and its state. */
export interface TriggerState {
  /** Its number in reading order: its entry in the level's `triggers`. */
  readonly index: number;
  readonly col: number;
  readonly row: number;
  readonly def: LevelTrigger;
  /** False while the player still touches it after a round (it starts one only when entered). */
  armed: boolean;
  /** Rounds started here so far. */
  attempts: number;
}

/** The round being played over the level. */
export interface MiniGameRun {
  readonly trigger: TriggerState;
  readonly def: MiniGameDef;
  readonly game: MiniGame;
}

/**
 * A round that ended on the last tick (gap G20, Engine 0.10): the run as it was, with its result.
 * The world keeps it for that one tick, so the host's snapshot can show the round's last events
 * and final state; the next `update` drops it.
 */
export interface EndedRound extends MiniGameRun {
  readonly result: MiniGameResult;
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
 *   6. the player touches tiles: coins (`coins-collect`), checkpoints (`checkpoints`), hazards
 *      (`hazards-kill`) and goals (`goal-clears-level`);
 *   7. a player whose top is below the last row dies (`pits-kill`);
 *   (a boss, Engine 0.16 T2, takes its turn in 4: its pattern's step starts, moves and ends
 *   (`boss-pattern`), shoots and drops add projectiles (`boss-projectiles`: gone at a wall, on
 *   landing or on touching the player), and the end of a defeat sequence may clear the level
 *   (`boss-defeat-clears`); in 5 a stomp hits it (`boss-stomp-hits`, `boss-hit-invuln`,
 *   `boss-phases`) instead of `stomping`);
 *   8. a mini-game trigger the player enters starts a round of the mini game it names
 *      (`mini-games`, seeded from `rng`). While it runs, `update` steps the round instead of
 *      the level (through a `RoundInput`: a button held into the trigger is ignored until released,
 *      and the def's `inputMap` applies; gap G18); once it reports a result, the trigger's outcomes for that result apply and the
 *      level goes on from the next tick. The ended round stays readable (`endedRound`) until the
 *      next `update`, so the snapshot of that tick holds its last events and final state.
 *
 * A death takes a life; with lives left the player starts again at the last checkpoint it touched
 * (`checkpoint`), or at the start when it has touched none, else the outcome is `failed`. A respawn
 * changes nothing else: coins taken stay taken (and counted), used blocks and broken bricks stay as
 * they are, and actors go on where they are. Everything random comes from `rng` (seeded), so the
 * same level, seed and input give the same run.
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
  /** The checkpoint (`K`) the player touched last, where a death with lives left respawns it. */
  checkpoint: { col: number; row: number } | null = null;
  /** The level's checkpoint cells (`K`), in reading order. */
  readonly checkpoints: readonly { col: number; row: number }[];
  readonly viewWidth: number;
  private readonly start: LevelCell;
  private readonly games: ReadonlyMap<string, MiniGameDef>;
  /** What each bump block holds, by tile index; and how often a `coins` block has given. */
  private readonly contents = new Map<number, string>();
  private readonly hits = new Map<number, number>();
  private nextId = 1;
  /** The level's mini-game triggers, in reading order, and the round being played, if any. */
  readonly triggers: TriggerState[] = [];
  private run: MiniGameRun | null = null;
  /** What the round sees (gap G18: the first-tick drop and the def's `inputMap`). */
  private runInput: RoundInput | null = null;
  private ended: EndedRound | null = null;

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
    this.checkpoints = cells.filter((c) => c.ch === 'K').map((c) => ({ col: c.col, row: c.row }));
    this.player = Player.atStart(start.col, start.row, profile.player, this.rules);
    const games = miniGameTable(opts.miniGames ?? []);
    cells
      .filter((c) => c.ch === '!')
      .forEach((c, index) => {
        const def = level.triggers[index]!; // the schema has checked the count
        if (!games.has(def.game)) {
          const known = [...games.keys()].join(', ') || 'none';
          throw new Error(
            `level "${level.id}" trigger ${index} names mini game "${def.game}" (given: ${known})`,
          );
        }
        this.triggers.push({ index, col: c.col, row: c.row, def, armed: true, attempts: 0 });
      });
    this.games = games;
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
    this.ended = null;
    this.frame++;
    if (this.outcome !== 'playing') return;
    if (this.run) return this.stepMiniGame(input);
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
    if (this.outcome !== 'playing') return; // a boss's defeat sequence has cleared the level
    this.touchActors(prevBottom);
    if (this.player === p) this.touchTiles();
    if (this.player === p && this.outcome === 'playing' && p.body.y >= tileToSub(this.tiles.rows)) {
      if (this.rules.isOn('pits-kill')) this.die('pit');
    }
    if (this.player === p && this.outcome === 'playing' && this.rules.isOn('mini-games'))
      this.touchTriggers();
  }

  /** The round being played over the level, or null: a game's browser glue reads it to push a scene. */
  get miniGame(): MiniGameRun | null {
    return this.run;
  }

  /**
   * The round that ended on the last tick (its final state and result), or null: kept for that
   * one tick only (gap G20), so a snapshot taken after the step still shows the round.
   */
  get endedRound(): EndedRound | null {
    return this.ended;
  }

  /** Re-arms the triggers the player has left; an armed one it touches starts its mini game. */
  private touchTriggers(): void {
    const b = this.player.body;
    for (const t of this.triggers) {
      if (this.tiles.cellAt(t.col, t.row) !== 'trigger') continue;
      const box = { x: tileToSub(t.col), y: tileToSub(t.row), w: tileToSub(1), h: tileToSub(1) };
      if (!overlaps(b, box)) {
        t.armed = true;
        continue;
      }
      if (!t.armed || this.run) continue;
      t.armed = false;
      t.attempts++;
      const def = this.games.get(t.def.game)!;
      const params = t.def.params as JsonObject;
      const hostStatus = hostStatusFor(def, this.hudStatus());
      const ctx = { params, attempt: t.attempts, ...(hostStatus ? { hostStatus } : {}) };
      const game = def.create(ctx, this.rng.next());
      this.run = { trigger: t, def, game };
      this.runInput = new RoundInput(def.inputMap);
      this.emit({ type: 'mini-game', trigger: t.index, game: def.id, attempt: t.attempts });
    }
  }

  /**
   * The level's HUD values a round may ask for (`MiniGameDef.hostStatus`, gap G19): the same keys
   * and values as the presented frame's status (`presentStatus`): `coins`, `hp`, `maxHp`, `lives`
   * and `level`.
   */
  private hudStatus(): Record<string, string | number> {
    const pp = this.profile.player;
    return {
      coins: this.coins,
      hp: this.player.hp,
      maxHp: pp.maxHp ?? pp.hp,
      lives: this.lives,
      level: this.level.id,
    };
  }

  /** One tick of the round over the level; when it ends, its outcome applies. */
  private stepMiniGame(input: InputFrame): void {
    const run = this.run!;
    run.game.step(this.runInput!.advance(input));
    const result = run.game.result();
    if (result === null) return;
    this.run = null;
    this.runInput = null;
    this.ended = { ...run, result };
    const t = run.trigger;
    this.emit({ type: 'mini-game-end', trigger: t.index, game: run.def.id, result });
    if (result === 'pass') this.tiles.setCell(t.col, t.row, 'empty');
    for (const o of t.def[result]) this.applyOutcome(o, t);
  }

  /** One outcome of a trigger's result (`TRIGGER_OUTCOMES` in `level.ts`). */
  private applyOutcome(outcome: string, t: TriggerState): void {
    const [what, a, b] = outcome.split(':');
    if (what === 'coins') {
      this.coins += Number(a);
    } else if (what === 'life') {
      this.lives++;
    } else if (what === 'clear') {
      if (this.outcome !== 'playing') return;
      this.outcome = 'cleared';
      this.emit({ type: 'cleared' });
    } else if (what === 'respawn') {
      const hp = this.player.hp;
      this.player = Player.atStart(t.col, t.row, this.profile.player, this.rules);
      this.player.hp = hp;
      t.armed = false;
      this.emit({ type: 'respawn' });
    } else if (what === 'open') {
      this.tiles.setCell(Number(a), Number(b), 'empty');
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
    // A copy: a boss's attack may add a projectile, which moves from the next tick.
    for (const a of [...this.actors]) {
      if (!a.active) continue;
      if (a.boss) this.bossTurn(a);
      a.step(this.tiles, this.profile, this.rules);
      if (a.boss) this.bossStepped(a);
    }
    const bottom = tileToSub(this.tiles.rows);
    this.remove((a) => a.body.y >= bottom);
    if (this.rules.isOn('boss-projectiles'))
      this.remove((a) => a.def.projectile !== undefined && (a.body.hitWall !== 0 || a.body.onGround));
    this.endDefeats();
    if (!this.rules.isOn('shell-hits-enemies')) return;
    for (const s of [...this.actors]) {
      if (!s.isMovingShell || !this.actors.includes(s)) continue;
      for (const o of [...this.actors]) {
        if (o === s || o.boss || !o.active || !overlaps(s.body, o.body)) continue;
        this.remove((a) => a === o);
        this.emit({ type: 'defeat', actor: o.id, actorType: o.type, by: s.id });
      }
    }
  }

  /**
   * A boss's turn before it moves: its hit invulnerability counts down, and on a step's first
   * tick it faces the player and the step starts (`boss-pattern`): a telegraph announces its
   * attack, a charge runs, a leap takes off, a shoot or a drop adds a projectile. Its speed is the
   * step's (`stepSpeed`). In its defeat sequence, or with `boss-pattern` off, it stands.
   */
  private bossTurn(a: Actor): void {
    const s = a.boss!;
    a.speed = 0;
    if (s.mode !== 'fight') return;
    if (s.invuln > 0) s.invuln--;
    if (!this.rules.isOn('boss-pattern')) return;
    const step = s.current;
    if (s.tick === 0) {
      const pb = this.player.body;
      a.dir = pb.x + (pb.w >> 1) < a.body.x + (a.body.w >> 1) ? -1 : 1;
      const who = { actor: a.id, actorType: a.type };
      if (step.do === 'telegraph') {
        this.emit({ type: 'boss-telegraph', ...who, attack: step.attack, ticks: step.ticks });
      } else if (step.do === 'charge') {
        this.emit({ type: 'boss-attack', ...who, attack: 'charge' });
      } else if (step.do === 'leap') {
        a.body.vy = -step.speed;
        a.body.onGround = false;
        this.emit({ type: 'boss-attack', ...who, attack: 'leap' });
      } else if (step.do === 'shoot' || step.do === 'drop') {
        const p = step.do === 'shoot' ? this.shoot(a, step.actor) : this.drop(step.actor, step.spread ?? 0);
        this.emit({ type: 'boss-attack', ...who, attack: step.do, projectile: p.id });
      }
    }
    a.speed = stepSpeed(step);
  }

  /** After a boss moved: the step goes on, or it is over and the next one comes (`boss-pattern`). */
  private bossStepped(a: Actor): void {
    const s = a.boss!;
    if (s.mode === 'defeated') {
      s.tick++;
      return;
    }
    if (!this.rules.isOn('boss-pattern')) return;
    if (stepOver(s.current, s.tick, a.body.hitWall, a.body.onGround)) s.next();
    else s.tick++;
  }

  /** A projectile of `type` fired ahead of the boss, its box centred on the boss's height. */
  private shoot(boss: Actor, type: string): Actor {
    const def = this.profile.actors[type]!;
    const box = def.box ?? { w: 16, h: 16 };
    const b = boss.body;
    const half = px(box.w) >> 1;
    const x = boss.dir < 0 ? b.x - half : b.x + b.w + half;
    const y = b.y + (b.h >> 1) + (px(box.h) >> 1);
    return this.addProjectile(type, x, y, boss.dir);
  }

  /**
   * A projectile of `type` dropped from the top of the level over the player's centre, moved
   * up to `spread` tiles either way by the world's `rng` (no draw when `spread` is 0).
   */
  private drop(type: string, spread: number): Actor {
    const def = this.profile.actors[type]!;
    const box = def.box ?? { w: 16, h: 16 };
    const pb = this.player.body;
    const off = spread > 0 ? this.rng.int(spread * 2 + 1) - spread : 0;
    const half = px(box.w) >> 1;
    const x = clamp(pb.x + (pb.w >> 1) + tileToSub(off), half, tileToSub(this.tiles.cols) - half);
    return this.addProjectile(type, x, px(box.h), this.player.facing);
  }

  private addProjectile(type: string, x: number, y: number, dir: -1 | 1): Actor {
    const p = this.addActor(type, x, y, dir);
    p.active = true;
    return p;
  }

  /**
   * Bosses at the end of their defeat sequence are gone; with `"clear": "boss"`, once the last
   * boss is gone the level is cleared (`boss-defeat-clears`; a `cleared` event).
   */
  private endDefeats(): void {
    const done = (a: Actor) => a.boss?.mode === 'defeated' && a.boss.tick >= a.boss.def.defeatTicks;
    if (!this.actors.some(done)) return;
    this.remove(done);
    if (this.level.clear !== 'boss' || this.actors.some((a) => a.boss)) return;
    if (!this.rules.isOn('boss-defeat-clears')) return;
    this.outcome = 'cleared';
    this.emit({ type: 'cleared' });
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
      if (a.boss?.mode === 'defeated') continue;
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
      if (a.boss && fromAbove && def.stompable && this.rules.isOn('boss-stomp-hits')) {
        this.hitBoss(a);
        continue;
      }
      if (!a.boss && fromAbove && def.stompable && this.rules.isOn('stomping')) {
        this.stomp(a);
        continue;
      }
      if (def.harms && this.rules.isOn('enemy-touch-hurts')) this.hurt();
      if (def.projectile !== undefined && this.rules.isOn('boss-projectiles')) this.remove((o) => o === a);
    }
  }

  /**
   * A stomp on a boss: the player bounces (`stomp-bounce`); unless the boss is in its hit
   * invulnerability it takes a hit point (`boss-hit`), starts `hitInvuln` ticks of it
   * (`boss-hit-invuln`) and, at a phase's hp, starts that phase's pattern (`boss-phases`). At 0
   * hit points its defeat sequence starts (`boss-defeat`): `defeatTicks` ticks, then it is gone.
   */
  private hitBoss(a: Actor): void {
    const s = a.boss!;
    if (this.rules.isOn('stomp-bounce')) this.player.bounce(this.profile.player.stompBounce);
    // As after a stomp that leaves a shell: it leaves the bouncing player alone a few ticks.
    a.grace = a.def.kickGrace ?? DEFAULT_KICK_GRACE;
    if (s.invuln > 0) return;
    s.hp--;
    const who = { actor: a.id, actorType: a.type };
    if (s.hp <= 0) {
      s.mode = 'defeated';
      s.tick = 0;
      s.invuln = 0;
      a.speed = 0;
      this.emit({ type: 'boss-hit', ...who, hp: 0, maxHp: s.def.hp, phase: s.phase, invuln: 0 });
      this.emit({ type: 'boss-defeat', ...who, ticks: s.def.defeatTicks });
      return;
    }
    if (this.rules.isOn('boss-hit-invuln')) s.invuln = s.def.hitInvuln;
    const phase = s.phaseFor(s.hp);
    if (phase > s.phase && this.rules.isOn('boss-phases')) s.enterPhase(phase);
    this.emit({ type: 'boss-hit', ...who, hp: s.hp, maxHp: s.def.hp, phase: s.phase, invuln: s.invuln });
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
        if (cell === 'checkpoint' && this.rules.isOn('checkpoints')) {
          if (this.checkpoint?.col === col && this.checkpoint.row === row) continue;
          this.checkpoint = { col, row };
          this.emit({ type: 'checkpoint', col, row });
        } else if (cell === 'coin' && this.rules.isOn('coins-collect')) {
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

  /**
   * A death: a life off; with lives left the player starts again at the last checkpoint touched
   * (else the start), else `failed`.
   */
  private die(cause: DeathCause): void {
    this.lives--;
    this.emit({ type: 'died', cause, lives: this.lives });
    if (this.lives <= 0) {
      this.outcome = 'failed';
      return;
    }
    const at = this.checkpoint ?? this.start;
    this.player = Player.atStart(at.col, at.row, this.profile.player, this.rules);
    this.scrollX = 0;
    this.scroll();
    this.emit({ type: 'respawn' });
  }
}
