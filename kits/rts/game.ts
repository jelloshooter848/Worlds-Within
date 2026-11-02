import type { HeadlessGame, JsonObject } from '@engine/core/headless';
import type { InputFrame } from '@engine/core/input/input-manager';
import { parseOrder, type Order } from '@engine/core/orders';
import { Rng } from '@engine/core/rng';
import { RuleSwitch } from '@engine/core/rules';
import { stampOrder, type OrderDraft } from './commands';
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
 *   const game = rtsGame({
 *     world: { snapshot: () => world.snapshot(), applyOrder: (o) => applyOrder(world, o), step: () => world.step() },
 *     enemy: plan, seed, disabledRules: opts?.disabledRules,
 *   });
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
 * - `snapshot()` is `{ world, kit: { nextOrder, rng, enemy } }`: the world's snapshot plus what
 *   the kit keeps (the next order id, the enemy's RNG state and its plan steps' progress).
 * - `recorded()` is the player's orders with their ticks (`{ tick, ...order }`, refused ones too:
 *   a replay refuses them the same way), ready for a run file's `orders`; `log()` is every order
 *   of both sides with its tick, `source` and refusal.
 */

/** What the kit needs from a world: the game's glue fills it with an `engine/sim` world. */
export interface RtsWorldPort {
  /** `World.snapshot()`: the whole world as plain JSON. */
  snapshot(): unknown;
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
    this.cached ??= readWorld(this.world.snapshot());
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
    return {
      world: this.world.snapshot() as JsonObject,
      kit: {
        nextOrder: this.nextOrder,
        rng: this.rng.state(),
        enemy: this.enemy?.snapshot() ?? {},
      },
    };
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
