import type { ContentBundle } from '@engine/core/content/bundle';
import type { HeadlessGame, HeadlessOptions, JsonObject, WorldEvents } from '@engine/core/headless';
import type { InputFrame } from '@engine/core/input/input-manager';
import { eventsSince, rtsWorldPort, worldFromScenario, worldTimeline, type World } from '@engine/sim/index';
import { rtsGame, sidesOf, type RtsGame, type SideSummary } from '@kits/rts';
import { interfaceActionSchema, PlayerInterface } from './actions';
import { PLAYER, skirmishEnemy, skirmishScenario } from './content';

/**
 * The skirmish's headless entry (named by `headless` in `game.json`): thin glue joining an
 * `engine/sim` world built from the map to the RTS kit's `rtsGame`, which takes the player's
 * recorded orders and runs the scripted enemy. No browser, no drawing. The world's rules
 * (movement, combat, building, training, gathering) are the sim's; the kit only gives orders.
 */

/** The sim world built from the map, the types and `seed` (the world's and the enemy's seed). */
export function createWorld(content: ContentBundle, seed: number): World {
  return worldFromScenario(skirmishScenario(content, seed));
}

/** Every side at a glance (the kit's `sidesOf`), re-exported for the page and the tests. */
export { sidesOf, type SideSummary };

/**
 * The game the tools play: the kit's `RtsGame` over the world and the player's interface
 * (`actions.ts`). `order` takes a recorded order, or an interface action (an entry with `ui`)
 * whose order, if it gives one, is stamped with the next id and applied. The snapshot is `{ world,
 * kit, sides, ui }`: `sides` from `sidesOf` (so a run file can check `sides.blue.units` instead of
 * counting components) and `ui.selection`, the selected ids.
 */
export class SkirmishGame implements HeadlessGame {
  readonly player: PlayerInterface;

  constructor(
    readonly rts: RtsGame,
    /** The factions `sides` always lists: the player's and the enemy's. */
    readonly factions: readonly string[],
    /** The sim world the kit plays (for the event log and the timeline, Engine 0.14 T7). */
    readonly world: World,
  ) {
    this.player = new PlayerInterface(PLAYER, rts.rules);
  }

  step(input: InputFrame): void {
    this.rts.step(input);
  }

  order(order: JsonObject): string | null {
    if (!Object.hasOwn(order, 'ui')) return this.rts.order(order);
    const parsed = interfaceActionSchema.safeParse(order);
    if (!parsed.success)
      return `not an interface action: ${parsed.error.issues.map((i) => i.message).join('; ')}`;
    const result = this.player.act(this.rts.view(), parsed.data);
    if (result === null || typeof result === 'string') return result;
    return this.rts.issue(result).error;
  }

  /** The world's event log from world tick `sinceTick` (`HeadlessGame.worldEvents`); never in the snapshot. */
  worldEvents(sinceTick: number): WorldEvents {
    return eventsSince(this.world, sinceTick);
  }

  /** The world's timeline record now (`HeadlessGame.timeline`); a skirmish has no missions. */
  timeline(): JsonObject {
    return worldTimeline(this.world) as unknown as JsonObject;
  }

  snapshot(): JsonObject {
    return {
      ...this.rts.snapshot(),
      sides: sidesOf(this.rts.view(), this.factions) as unknown as JsonObject,
      ui: { selection: this.player.selection.ids() },
    };
  }
}

/**
 * The headless game contract (`engine/core/headless.ts`), for `pnpm cli run`, `dump` and
 * `mutants`: kit rules switched off in `opts` go to the kit.
 */
export function createGame(content: ContentBundle, seed: number, opts: HeadlessOptions = {}): SkirmishGame {
  const world = createWorld(content, seed);
  const enemy = skirmishEnemy(content);
  return new SkirmishGame(
    rtsGame({
      world: rtsWorldPort(world),
      enemy,
      seed,
      disabledRules: opts.disabledRules,
    }),
    [PLAYER, enemy.faction],
    world,
  );
}
