import type { ContentBundle } from '@engine/core/content/bundle';
import type { HeadlessGame, HeadlessOptions, JsonObject } from '@engine/core/headless';
import type { InputFrame } from '@engine/core/input/input-manager';
import { applyOrder, worldFromScenario, type World } from '@engine/sim/index';
import { isFinished, rtsGame, type RtsGame, type RtsView } from '@kits/rts';
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

/** One side at a glance, for run-file checks: its units, finished buildings, sites and stock. */
export interface SideSummary {
  /** Living units. */
  units: number;
  /** Living units by type. */
  unitTypes: Record<string, number>;
  /** Finished buildings by kind. */
  buildings: Record<string, number>;
  /** Buildings still under construction. */
  sites: number;
  /** The side's stockpile, by item. */
  stock: Record<string, number>;
}

/**
 * Every side by faction: `factions` always (an empty side once beaten), then any other faction
 * with units, buildings or a stockpile.
 */
export function sidesOf(view: RtsView, factions: readonly string[] = []): Record<string, SideSummary> {
  const sides: Record<string, SideSummary> = {};
  const side = (f: string) =>
    (sides[f] ??= { units: 0, unitTypes: {}, buildings: {}, sites: 0, stock: { ...(view.stock[f] ?? {}) } });
  for (const f of [...factions, ...Object.keys(view.stock)]) side(f);
  for (const u of view.units) {
    if (u.faction === null) continue;
    const s = side(u.faction);
    s.units++;
    const type = u.type ?? 'unit';
    s.unitTypes[type] = (s.unitTypes[type] ?? 0) + 1;
  }
  for (const b of view.buildings) {
    if (b.faction === null) continue;
    const s = side(b.faction);
    if (isFinished(b)) s.buildings[b.kind] = (s.buildings[b.kind] ?? 0) + 1;
    else s.sites++;
  }
  return sides;
}

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
      world: {
        snapshot: () => world.snapshot(),
        applyOrder: (o) => {
          const r = applyOrder(world, o);
          return r.ok ? { ok: true } : { ok: false, error: r.error };
        },
        step: () => world.step(),
      },
      enemy,
      seed,
      disabledRules: opts.disabledRules,
    }),
    [PLAYER, enemy.faction],
  );
}
