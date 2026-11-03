import type { JsonObject } from '@engine/core/headless';
import { Rng } from '@engine/core/rng';
import { RuleSwitch } from '@engine/core/rules';
import { cellKinds, tracePath, type Cell, type CellKind } from './map';
import { TOWERDEFENSE_RULES } from './rules';
import { CELL_SUB, tdMapSchema, type TdMap, type TdWaves, type TowerTable, type TowerType } from './schema';

/** What a round is played from: its map, the tower types and its wave list (checked content). */
export interface TdRoundDef {
  map: TdMap;
  towers: TowerTable;
  waves: TdWaves;
}

export interface TdWorldOptions {
  /** The round's seeded RNG (jitter draws); a new `Rng(seed)` when left out. */
  rng?: Rng;
  /** The seed for that RNG when no `rng` is given (1 when left out). */
  seed?: number;
  /** Kit rules switched off (ids from `TOWERDEFENSE_RULES`); an unknown id throws. */
  disabledRules?: readonly string[];
}

/** What the player can do between steps; each is carried out at the start of the next step. */
export type TdCommand =
  | { type: 'place'; tower: string; col: number; row: number }
  | { type: 'sell'; col: number; row: number }
  | { type: 'start-wave' };

/** Why a command was refused (a `refused` event's `code`). */
export type TdRefusal =
  | 'round_over'
  | 'unknown_tower'
  | 'off_map'
  | 'not_build_cell'
  | 'occupied'
  | 'too_poor'
  | 'no_tower'
  | 'no_more_waves';

/** What happened on a step, for sounds, presentation, reports and run-file checks. */
export type TdEvent =
  | { type: 'placed'; tower: number; towerType: string; col: number; row: number; cost: number }
  | { type: 'sold'; tower: number; towerType: string; col: number; row: number; refund: number }
  | { type: 'refused'; command: TdCommand['type']; code: TdRefusal }
  | { type: 'wave'; wave: number; by: 'button' | 'timer' }
  | { type: 'spawn'; enemy: number; kind: string; wave: number }
  | { type: 'fire'; tower: number; enemy: number; damage: number; hp: number }
  | { type: 'kill'; enemy: number; kind: string; tower: number; bounty: number }
  | { type: 'leak'; enemy: number; kind: string; lives: number }
  | { type: 'won' }
  | { type: 'lost' };

/** Where the round stands. */
export type TdOutcome = 'playing' | 'won' | 'lost';

export interface TowerState {
  readonly id: number;
  readonly type: string;
  readonly col: number;
  readonly row: number;
  /** Ticks before it can fire again (0: ready). */
  cooldown: number;
}

export interface EnemyState {
  readonly id: number;
  readonly kind: string;
  readonly wave: number;
  hp: number;
  readonly speed: number;
  readonly bounty: number;
  /** Sub-cell units walked from the entry cell (`CELL_SUB` to a cell). */
  progress: number;
}

/** An enemy still to come: its group's numbers and the ticks after the one before it. */
interface PendingSpawn {
  readonly kind: string;
  readonly wave: number;
  readonly hp: number;
  readonly speed: number;
  readonly bounty: number;
  readonly delay: number;
}

/**
 * A plain, JSON-safe snapshot of a round: whole numbers only, no presentation state. Paths a run
 * file can check: `tick`, `map`, `outcome`, `gold`, `lives`, `rng`, `wave.started` (waves started
 * so far), `wave.total`, `wave.sinceStart` (ticks since the last wave started, or the round
 * started), `wave.pending` (enemies still to come), `wave.spawnIn` (ticks to the next one),
 * `towers` (`id`, `type`, `col`, `row`, `cooldown`), `enemies` (`id`, `kind`, `wave`, `hp`,
 * `progress`, `col`, `row`), `stats` (`spent`, `refunded`, `earned`, `killed`, `leaked`) and
 * `events` (the last step's `TdEvent`s).
 */
export interface TdSnapshot extends JsonObject {
  tick: number;
  map: string;
  outcome: TdOutcome;
  gold: number;
  lives: number;
  rng: number;
  wave: { started: number; total: number; sinceStart: number; pending: number; spawnIn: number };
  towers: { id: number; type: string; col: number; row: number; cooldown: number }[];
  enemies: {
    id: number;
    kind: string;
    wave: number;
    hp: number;
    progress: number;
    col: number;
    row: number;
  }[];
  stats: { spent: number; refunded: number; earned: number; killed: number; leaked: number };
  events: JsonObject[];
}

/** The gold selling a tower of this type gives back. */
export function sellValue(type: TowerType): number {
  return type.sell ?? Math.floor(type.cost / 2);
}

/**
 * One headless tower-defense round: a map, its tower types and its wave list, stepped once per
 * tick. Whole numbers only: cells, sub-cell units (`CELL_SUB` to a cell) and ticks. Everything
 * random (a group's `jitter`) comes from the RNG it is given.
 *
 * Commands (`command`, or `place`, `sell`, `startWave`) are queued and carried out, in the order
 * given, at the start of the next step. One step, in this fixed order (once the round is won or lost
 * only the tick counts and every command is refused with `round_over`):
 *
 *   1. commands: `place` puts a tower on a free build cell (`build-on-build-cells`) if the gold
 *      covers its cost, and pays it (`build-costs-gold`); `sell` takes a tower away and gives back
 *      its sell value (`sell-refunds`); `start-wave` starts the next wave. A refusal is a `refused`
 *      event, never thrown;
 *   2. the wave timer: with the wave list's `timer`, the next wave starts once `timer` ticks have
 *      passed since the last wave started, or the round did (`wave-timer`);
 *   3. spawning: the enemies still to come enter at the entry, each `spacing` (plus a drawn
 *      `0..jitter`) ticks after the one before (`spawn-spacing`; off, every one at once);
 *   4. enemies walk, in id order, `speed` sub-cell units along the path (`enemies-walk`); one that
 *      reaches the exit cell leaves and costs a life (`leak-costs-life`);
 *   5. towers, in id order: the cooldown counts down; a ready tower fires at its target, an enemy
 *      within `range` cells (squared cell distance, `tower-range`): the one furthest along the
 *      path, ties to the lowest id (`target-first`), for `damage`, and waits `cooldown` ticks
 *      (`tower-cooldown`; off, it can fire every tick). An enemy at 0 hp is killed and pays its
 *      bounty (`kill-bounty`). With `towers-fire` off no tower fires;
 *   6. the end: 0 lives loses the round (`lose-at-zero-lives`); otherwise every wave started, none
 *      still to come and no enemy left wins it (`win-on-clear`);
 *   7. the tick counts up.
 *
 * Enemies come in waves started in order; a wave started while another is still coming queues
 * behind it. An enemy's cell is the path cell nearest its progress.
 */
export class TdWorld {
  readonly rng: Rng;
  readonly rules: RuleSwitch;
  readonly map: TdMap;
  readonly towerTypes: TowerTable;
  readonly waves: TdWaves;
  /** `kinds[row][col]`. */
  readonly kinds: readonly CellKind[][];
  /** The path cells from the entry to the exit. */
  readonly path: readonly Cell[];
  readonly towers: TowerState[] = [];
  readonly enemies: EnemyState[] = [];
  events: TdEvent[] = [];
  tick = 0;
  outcome: TdOutcome = 'playing';
  gold: number;
  lives: number;
  wavesStarted = 0;
  sinceWave = 0;
  spawnIn = 0;
  readonly stats = { spent: 0, refunded: 0, earned: 0, killed: 0, leaked: 0 };
  private readonly pending: PendingSpawn[] = [];
  private readonly queue: TdCommand[] = [];
  private nextTower = 1;
  private nextEnemy = 1;

  constructor(def: TdRoundDef, opts: TdWorldOptions = {}) {
    const checked = tdMapSchema.safeParse(def.map);
    if (!checked.success) throw new Error(`td map "${def.map.id}": ${checked.error.issues[0]!.message}`);
    for (const t of def.map.towers)
      if (!Object.hasOwn(def.towers, t)) throw new Error(`td map "${def.map.id}": no tower type "${t}"`);
    if (def.waves.id !== def.map.waves)
      throw new Error(`td map "${def.map.id}" plays waves "${def.map.waves}", given "${def.waves.id}"`);
    this.map = def.map;
    this.towerTypes = def.towers;
    this.waves = def.waves;
    this.kinds = cellKinds(def.map.map, def.map.legend);
    const traced = tracePath(this.kinds);
    if (!traced.ok) throw new Error(`td map "${def.map.id}": ${traced.problems[0]!.message}`);
    this.path = traced.path;
    this.rng = opts.rng ?? new Rng(opts.seed ?? 1);
    this.rules = new RuleSwitch(TOWERDEFENSE_RULES, opts.disabledRules ?? []);
    this.gold = def.map.start.gold;
    this.lives = def.map.start.lives;
  }

  /** Queues a command for the start of the next step. */
  command(cmd: TdCommand): void {
    this.queue.push(cmd);
  }

  place(tower: string, col: number, row: number): void {
    this.command({ type: 'place', tower, col, row });
  }

  sell(col: number, row: number): void {
    this.command({ type: 'sell', col, row });
  }

  startWave(): void {
    this.command({ type: 'start-wave' });
  }

  /** The cell's kind, or null outside the map. */
  cellAt(col: number, row: number): CellKind | null {
    return this.kinds[row]?.[col] ?? null;
  }

  /** The tower on a cell, if any. */
  towerAt(col: number, row: number): TowerState | undefined {
    return this.towers.find((t) => t.col === col && t.row === row);
  }

  /** Why placing `tower` on the cell would be refused now, or null when it can be placed. */
  placeRefusal(tower: string, col: number, row: number): TdRefusal | null {
    if (this.outcome !== 'playing') return 'round_over';
    const type = this.map.towers.includes(tower) ? this.towerTypes[tower] : undefined;
    if (type === undefined) return 'unknown_tower';
    const kind = this.cellAt(col, row);
    if (kind === null) return 'off_map';
    if (this.rules.isOn('build-on-build-cells') && kind !== 'build') return 'not_build_cell';
    if (this.towerAt(col, row)) return 'occupied';
    if (this.rules.isOn('build-costs-gold') && this.gold < type.cost) return 'too_poor';
    return null;
  }

  /** The path's last progress: an enemy at or past it has reached the exit. */
  get pathEnd(): number {
    return (this.path.length - 1) * CELL_SUB;
  }

  /** The path cell an enemy is in: the one nearest its progress. */
  enemyCell(e: EnemyState): Cell {
    const i = Math.min(Math.floor((e.progress + CELL_SUB / 2) / CELL_SUB), this.path.length - 1);
    return this.path[i]!;
  }

  /** Steps one tick (the order is in the class comment) and returns that step's events. */
  step(): TdEvent[] {
    this.events = [];
    const commands = this.queue.splice(0);
    if (this.outcome !== 'playing') {
      for (const c of commands) this.events.push({ type: 'refused', command: c.type, code: 'round_over' });
      this.tick++;
      return this.events;
    }
    for (const c of commands) this.apply(c);
    const timer = this.waves.timer;
    if (
      timer !== undefined &&
      this.rules.isOn('wave-timer') &&
      this.wavesStarted < this.waves.waves.length &&
      this.sinceWave >= timer
    )
      this.beginWave('timer');
    this.spawn();
    this.walk();
    this.fire();
    if (this.lives <= 0 && this.rules.isOn('lose-at-zero-lives')) {
      this.outcome = 'lost';
      this.events.push({ type: 'lost' });
    } else if (
      this.lives > 0 &&
      this.rules.isOn('win-on-clear') &&
      this.wavesStarted === this.waves.waves.length &&
      this.pending.length === 0 &&
      this.enemies.length === 0
    ) {
      this.outcome = 'won';
      this.events.push({ type: 'won' });
    }
    this.sinceWave++;
    this.tick++;
    return this.events;
  }

  private refuse(command: TdCommand['type'], code: TdRefusal): void {
    this.events.push({ type: 'refused', command, code });
  }

  private apply(c: TdCommand): void {
    if (c.type === 'place') {
      const why = this.placeRefusal(c.tower, c.col, c.row);
      if (why !== null) return this.refuse('place', why);
      const type = this.towerTypes[c.tower]!;
      const cost = this.rules.isOn('build-costs-gold') ? type.cost : 0;
      this.gold -= cost;
      this.stats.spent += cost;
      const t: TowerState = { id: this.nextTower++, type: c.tower, col: c.col, row: c.row, cooldown: 0 };
      this.towers.push(t);
      this.events.push({ type: 'placed', tower: t.id, towerType: t.type, col: t.col, row: t.row, cost });
    } else if (c.type === 'sell') {
      const t = this.towerAt(c.col, c.row);
      if (t === undefined) return this.refuse('sell', 'no_tower');
      this.towers.splice(this.towers.indexOf(t), 1);
      const refund = this.rules.isOn('sell-refunds') ? sellValue(this.towerTypes[t.type]!) : 0;
      this.gold += refund;
      this.stats.refunded += refund;
      this.events.push({ type: 'sold', tower: t.id, towerType: t.type, col: t.col, row: t.row, refund });
    } else {
      if (this.wavesStarted >= this.waves.waves.length) return this.refuse('start-wave', 'no_more_waves');
      this.beginWave('button');
    }
  }

  /** Starts the next wave: its enemies join the queue of those still to come. */
  private beginWave(by: 'button' | 'timer'): void {
    const wave = this.waves.waves[this.wavesStarted]!;
    this.wavesStarted++;
    this.sinceWave = 0;
    this.events.push({ type: 'wave', wave: this.wavesStarted, by });
    const spaced = this.rules.isOn('spawn-spacing');
    const wasEmpty = this.pending.length === 0;
    for (const g of wave.groups) {
      for (let i = 0; i < g.count; i++) {
        const first = wasEmpty && this.pending.length === 0;
        const jitter = g.jitter ?? 0;
        const delay = first || !spaced ? 0 : g.spacing + (jitter > 0 ? this.rng.int(jitter + 1) : 0);
        this.pending.push({
          kind: g.kind,
          wave: this.wavesStarted,
          hp: g.hp,
          speed: g.speed,
          bounty: g.bounty,
          delay,
        });
      }
    }
    if (wasEmpty) this.spawnIn = 0;
  }

  private spawn(): void {
    while (this.pending.length > 0 && this.spawnIn <= 0) {
      const p = this.pending.shift()!;
      const e: EnemyState = {
        id: this.nextEnemy++,
        kind: p.kind,
        wave: p.wave,
        hp: p.hp,
        speed: p.speed,
        bounty: p.bounty,
        progress: 0,
      };
      this.enemies.push(e);
      this.events.push({ type: 'spawn', enemy: e.id, kind: e.kind, wave: e.wave });
      this.spawnIn = this.pending[0]?.delay ?? 0;
    }
    if (this.pending.length > 0) this.spawnIn--;
  }

  private walk(): void {
    if (!this.rules.isOn('enemies-walk')) return;
    for (const e of [...this.enemies]) {
      e.progress = Math.min(e.progress + e.speed, this.pathEnd);
      if (e.progress < this.pathEnd) continue;
      this.enemies.splice(this.enemies.indexOf(e), 1);
      this.stats.leaked++;
      if (this.rules.isOn('leak-costs-life')) this.lives = Math.max(0, this.lives - 1);
      this.events.push({ type: 'leak', enemy: e.id, kind: e.kind, lives: this.lives });
    }
  }

  /** A tower's target now, or undefined when no enemy is in reach. */
  targetOf(t: TowerState): EnemyState | undefined {
    const range = this.towerTypes[t.type]!.range;
    const ranged = this.rules.isOn('tower-range');
    const inReach = this.enemies.filter((e) => {
      if (!ranged) return true;
      const c = this.enemyCell(e);
      const dc = c.col - t.col;
      const dr = c.row - t.row;
      return dc * dc + dr * dr <= range * range;
    });
    const first = this.rules.isOn('target-first');
    let best: EnemyState | undefined;
    for (const e of inReach) {
      if (best === undefined) best = e;
      else if (
        first
          ? e.progress > best.progress || (e.progress === best.progress && e.id < best.id)
          : e.id < best.id
      )
        best = e;
    }
    return best;
  }

  private fire(): void {
    const fires = this.rules.isOn('towers-fire');
    for (const t of this.towers) {
      if (t.cooldown > 0) t.cooldown--;
      if (!fires || t.cooldown > 0) continue;
      const e = this.targetOf(t);
      if (e === undefined) continue;
      const type = this.towerTypes[t.type]!;
      e.hp = Math.max(0, e.hp - type.damage);
      t.cooldown = this.rules.isOn('tower-cooldown') ? type.cooldown : 0;
      this.events.push({ type: 'fire', tower: t.id, enemy: e.id, damage: type.damage, hp: e.hp });
      if (e.hp > 0) continue;
      this.enemies.splice(this.enemies.indexOf(e), 1);
      this.stats.killed++;
      const bounty = this.rules.isOn('kill-bounty') ? e.bounty : 0;
      this.gold += bounty;
      this.stats.earned += bounty;
      this.events.push({ type: 'kill', enemy: e.id, kind: e.kind, tower: t.id, bounty });
    }
  }

  /** The round as plain, JSON-safe data (`TdSnapshot`): it reads the world and changes nothing. */
  snapshot(): TdSnapshot {
    return {
      tick: this.tick,
      map: this.map.id,
      outcome: this.outcome,
      gold: this.gold,
      lives: this.lives,
      rng: this.rng.state(),
      wave: {
        started: this.wavesStarted,
        total: this.waves.waves.length,
        sinceStart: this.sinceWave,
        pending: this.pending.length,
        spawnIn: this.spawnIn,
      },
      towers: this.towers.map((t) => ({
        id: t.id,
        type: t.type,
        col: t.col,
        row: t.row,
        cooldown: t.cooldown,
      })),
      enemies: this.enemies.map((e) => {
        const c = this.enemyCell(e);
        return {
          id: e.id,
          kind: e.kind,
          wave: e.wave,
          hp: e.hp,
          progress: e.progress,
          col: c.col,
          row: c.row,
        };
      }),
      stats: { ...this.stats },
      events: this.events.map((e) => ({ ...e })),
    };
  }
}
