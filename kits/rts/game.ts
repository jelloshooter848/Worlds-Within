import type { HeadlessGame, JsonObject, MissionStepRefusal } from '@engine/core/headless';
import type { InputFrame } from '@engine/core/input/input-manager';
import { parseOrder, type Order } from '@engine/core/orders';
import { Rng } from '@engine/core/rng';
import { RuleSwitch } from '@engine/core/rules';
import { missionRequest, stampOrder, type OrderDraft } from './commands';
import { ScriptedEnemy, type EnemyPlan } from './enemy';
import { RTS_RULES } from './rules';
import { readWorld, type RtsView } from './snapshot';

/**
 * The headless adapter (Engine 0.9, decision 2, items 122-125): the RTS kit's side of a game, with
 * the world behind an {@link RtsWorldPort} the game's glue fills with an `engine/sim` world (only
 * games may import both the kit and the sim). The kit never imports the sim:
 *
 *   // games/<game>/headless.ts (glue)
 *   const world = worldFromScenario(map);
 *   const game = rtsGame({ world: rtsWorldPort(world), enemy: plan, seed, disabledRules: opts?.disabledRules });
 *
 * (`rtsWorldPort` is `engine/sim`'s, Engine 0.15 T6, gap M27: the one bridge from a sim world to
 * this port, typed by shape on the sim's side.)
 *
 * `RtsGame` is a `HeadlessGame` (`engine/core/headless.ts`), so `pnpm cli run` plays it:
 *
 * - `order(json)` takes one recorded order (a run file's `orders` entry, or the player's from the
 *   page through `issue`), applies it through the port at once and records it with its tick.
 * - `step(input)`: the scripted enemy reads the snapshot and gives its orders, which are stamped
 *   with the next ids and applied, then the world steps. Input is not read: the player's commands
 *   arrive as orders.
 * - Order ids count up from 1 across both sides in the order they are applied (a recorded order
 *   keeps its id and the counter moves past it), so a battle replayed from the player's recorded
 *   orders gives the enemy the same ids, the same orders and the same hashes.
 * - `snapshot()` is `{ world, kit: { nextOrder, rng, enemy, seen? } }`: the world's snapshot plus
 *   what the kit keeps (the next order id, the enemy's RNG state and its plan steps' progress, and
 *   since Engine 0.16 part D, D6, `seen`, the enemy's memory, only for a plan that keeps one:
 *   `knowledge: "fog"` or a `scout` step, so older runs hash as before).
 * - `recorded()` is the player's orders with their ticks (`{ tick, ...order }`, refused ones too:
 *   a replay refuses them the same way), ready for a run file's `orders`; `log()` is every order
 *   of both sides with its tick, `source` and refusal.
 */

/** What the kit needs from a world: the game's glue fills it with an `engine/sim` world. */
export interface RtsWorldPort {
  /** `World.snapshot()`: the whole world as plain JSON. */
  snapshot(): unknown;
  /**
   * The same snapshot, read-only and not copied (`World.peek()`, Engine 0.16 part D, D9), when the
   * world can give it: the view reads it once per change, which with copies was most of a tick.
   */
  peek?(): unknown;
  /** `applyOrder(world, order)`: applies it between ticks or refuses it with a reason. */
  applyOrder(order: Order): { ok: true } | { ok: false; error: string };
  /** `World.step()`. */
  step(): void;
}

export interface RtsGameOptions {
  world: RtsWorldPort;
  /** The scripted enemy's plan, or null for none. */
  enemy?: EnemyPlan | null;
  /** Seeds the enemy's RNG. */
  seed: number;
  /** Kit rules switched off (`RTS_RULES`), for mutant checks. */
  disabledRules?: readonly string[] | undefined;
}

/** An order with the tick it was applied before. */
export type RecordedOrder = Order & { tick: number };

/** One applied order in the log: its tick, who gave it and its refusal (null when applied). */
export interface OrderLogEntry {
  tick: number;
  source: 'player' | 'enemy';
  order: Order;
  error: string | null;
}

export class RtsGame implements HeadlessGame {
  readonly rules: RuleSwitch;
  private readonly world: RtsWorldPort;
  private readonly rng: Rng;
  private readonly enemy: ScriptedEnemy | null;
  private nextOrder = 1;
  private cached: RtsView | null = null;
  private readonly player: RecordedOrder[] = [];
  private readonly entries: OrderLogEntry[] = [];

  constructor(opts: RtsGameOptions) {
    this.world = opts.world;
    this.rules = new RuleSwitch(RTS_RULES, opts.disabledRules ?? []);
    this.rng = new Rng(opts.seed);
    this.enemy = opts.enemy ? new ScriptedEnemy(opts.enemy, this.rng, this.rules) : null;
  }

  /** The world as the kit reads it now (read once per change). */
  view(): RtsView {
    this.cached ??= readWorld(this.world.peek?.() ?? this.world.snapshot());
    return this.cached;
  }

  /**
   * Drops the cached view, for a world changed outside the port between steps (a mission opened
   * through the game's `MissionHost` takes its opportunity and freezes its event): the next
   * `view()` reads the snapshot again. Orders and steps already do this.
   */
  refresh(): void {
    this.cached = null;
  }

  /** The tick the world is at. */
  get tick(): number {
    return this.view().tick;
  }

  /** The id the next order gets. */
  get nextOrderId(): number {
    return this.nextOrder;
  }

  /** The player's command: stamped with the next id and applied now. Returns the order and its refusal. */
  issue(draft: OrderDraft): { order: Order; error: string | null } {
    const order = stampOrder(draft, this.nextOrder);
    return { order, error: this.order(order as unknown as JsonObject) };
  }

  /** A recorded order (`HeadlessGame.order`): null when applied, else why it was dropped. */
  order(json: JsonObject): string | null {
    const parsed = parseOrder(json);
    if (!parsed.ok) return `not an order: ${parsed.error.split('\n').join('; ')}`;
    const order = parsed.order;
    const tick = this.tick;
    this.player.push({ tick, ...order });
    return this.apply(order, 'player', tick);
  }

  step(_input?: InputFrame): void {
    if (this.enemy !== null) {
      const tick = this.tick;
      for (const draft of this.enemy.think(this.view())) {
        this.apply(stampOrder(draft, this.nextOrder), 'enemy', tick);
      }
    }
    this.world.step();
    this.cached = null;
  }

  snapshot(): JsonObject {
    const kit: JsonObject = {
      nextOrder: this.nextOrder,
      rng: this.rng.state(),
      enemy: this.enemy?.snapshot() ?? {},
    };
    const seen = this.enemy?.memorySnapshot() ?? null;
    if (seen !== null) kit['seen'] = seen;
    return { world: this.world.snapshot() as JsonObject, kit };
  }

  /** The scripted enemy (null when the game has none), for its `knowledge()` and an end rule. */
  scriptedEnemy(): ScriptedEnemy | null {
    return this.enemy;
  }

  /** The player's orders with their ticks, for a run file's `orders` (see the file comment). */
  recorded(): RecordedOrder[] {
    return this.player.map((o) => ({ ...o }));
  }

  /** Every order of both sides, in the order applied. */
  log(): OrderLogEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }

  private apply(order: Order, source: 'player' | 'enemy', tick: number): string | null {
    this.nextOrder = Math.max(this.nextOrder, order.id + 1);
    const result = this.world.applyOrder(order);
    this.cached = null;
    const error = result.ok ? null : result.error;
    this.entries.push({ tick, source, order, error });
    return error;
  }
}

/** A new {@link RtsGame} (see the file comment). */
export function rtsGame(opts: RtsGameOptions): RtsGame {
  return new RtsGame(opts);
}

/** What `rtsMissionHooks` gives a mission host: its `MissionHostOptions.canOpen` and `onChange`. */
export interface RtsMissionHooks {
  canOpen(id: string): MissionStepRefusal | null;
  onChange(): void;
}

/**
 * The RTS kit's side of a `MissionHost` over an {@link RtsGame} (Engine 0.15 T6, gap M18): spread
 * into the host's options, so the host and the kit's game are one object with no glue class.
 * `canOpen` is the launch command's check (`missionRequest`): a mission the world gates behind
 * opportunities, none of them offered now, is refused `not_offered` before the host asks the
 * world. `onChange` is `game.refresh()`, so the kit's view reads the world again after a mission
 * step changed it (an opportunity taken, an event frozen, a commit).
 *
 *   new MissionHost({ game: rts, port, missions, miniGames, adapters, ...rtsMissionHooks(rts) });
 */
export function rtsMissionHooks(game: RtsGame): RtsMissionHooks {
  return {
    canOpen: (id) =>
      missionRequest(game.view(), id) === null
        ? { code: 'not_offered', error: `mission "${id}" is not offered now` }
        : null,
    onChange: () => game.refresh(),
  };
}
