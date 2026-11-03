import { contentNamed, contentOf, type ContentBundle } from '@engine/core/content/bundle';
import type { HeadlessGame, JsonObject } from '@engine/core/headless';
import type { InputFrame } from '@engine/core/input/input-manager';
import type { DeepReadonly, PresentFrame } from '@engine/core/present';
import { gridOf, TdControls } from './controls';
import { TD_TILE_SIZE } from './present';
import { tdMapKind, tdTowersKind, tdWavesKind, towerTable } from './schema';
import { TdWorld, type TdCommand, type TdEvent, type TdRoundDef, type TdWorldOptions } from './world';

/**
 * The headless game (Engine 0.12): one round (`TdWorld`) played through the controls
 * (`TdControls`), so `pnpm cli run` plays it from a `ScriptedInput` run file. A game's glue wraps
 * it in its `createGame(content, seed, opts)`:
 *
 *   export function createGame(content, seed, opts) {
 *     return tdGame({ ...tdRound(content), seed, disabledRules: opts?.disabledRules });
 *   }
 *
 * - `step(input)`: the controls read the frame and give their commands (plus any taps queued
 *   since the last step, in order), the round takes them and steps once.
 * - No `order(json)`: the input model is frame input only (decision 3, item 199), so a run file's
 *   `input` replays a round exactly. A tap on the page (`tap`) moves the cursor and places
 *   through the same commands, but is not in a run file (docs/reports/tower-defense.md, D1).
 * - `snapshot()` is `{ round, controls, kit }`: the round's `TdSnapshot`, the cursor
 *   (`col`, `row`, `tower`, `held`) and `kit`, a short summary for run-file paths (`kit.outcome`,
 *   `kit.gold`, `kit.lives`, `kit.wave`, `kit.waves`, `kit.towers`, `kit.enemies`, `kit.killed`,
 *   `kit.leaked`, `kit.spent`, `kit.earned`).
 * - `world` and `events` (the last step's) are what a frame stream shows (`tdFrames`).
 */

export interface TdGameOptions extends TdRoundDef {
  /** Seeds the round's RNG. */
  seed: number;
  /** Kit rules switched off (`TOWERDEFENSE_RULES`), for mutant checks. */
  disabledRules?: readonly string[] | undefined;
}

export class TdGame implements HeadlessGame {
  readonly world: TdWorld;
  readonly controls: TdControls;
  events: readonly TdEvent[] = [];
  private readonly taps: TdCommand[] = [];

  constructor(opts: TdGameOptions) {
    const wopts: TdWorldOptions = { seed: opts.seed };
    if (opts.disabledRules !== undefined) wopts.disabledRules = opts.disabledRules;
    this.world = new TdWorld({ map: opts.map, towers: opts.towers, waves: opts.waves }, wopts);
    this.controls = new TdControls(gridOf(this.world));
  }

  /**
   * A pointer tap on the page at picture point (x, y) of the frame it was shown on (see
   * `TdControls.tap`): the cursor moves at once; a place or sell joins the next step's commands.
   */
  tap(
    x: number,
    y: number,
    frame: DeepReadonly<Pick<PresentFrame, 'size' | 'camera'>>,
    button: 'primary' | 'secondary' = 'primary',
    tileSize = TD_TILE_SIZE,
  ): void {
    this.taps.push(...this.controls.tap(x, y, frame, button, tileSize));
  }

  step(input: InputFrame): void {
    const commands = [...this.taps.splice(0), ...this.controls.input(input)];
    for (const c of commands) this.world.command(c);
    this.events = this.world.step();
  }

  snapshot(): JsonObject {
    const w = this.world;
    return {
      round: w.snapshot(),
      controls: this.controls.snapshot(),
      kit: {
        outcome: w.outcome,
        gold: w.gold,
        lives: w.lives,
        wave: w.wavesStarted,
        waves: w.waves.waves.length,
        towers: w.towers.length,
        enemies: w.enemies.length,
        killed: w.stats.killed,
        leaked: w.stats.leaked,
        spent: w.stats.spent,
        earned: w.stats.earned,
      },
    };
  }
}

/** A new {@link TdGame} (see the file comment). */
export function tdGame(opts: TdGameOptions): TdGame {
  return new TdGame(opts);
}

/**
 * A round from a game's loaded content: the `td-map` called `map` (the only one when left out),
 * every `td-towers` file's types and the `td-waves` list the map names. Throws naming what is
 * missing (content that passed `validate` has it all).
 */
export function tdRound(content: ContentBundle, map?: string): TdRoundDef {
  const maps = contentOf(content, tdMapKind());
  const entry = map === undefined ? maps[0] : maps.find((m) => m.name === map);
  if (entry === undefined)
    throw new Error(map === undefined ? 'no td-map in the content' : `no td-map "${map}" in the content`);
  if (map === undefined && maps.length > 1)
    throw new Error(
      `the content has ${maps.length} td-maps: name one (${maps.map((m) => m.name).join(', ')})`,
    );
  const waves = contentNamed(content, tdWavesKind(), entry.value.waves);
  if (waves === undefined) throw new Error(`td-map "${entry.name}": no td-waves "${entry.value.waves}"`);
  return {
    map: entry.value,
    towers: towerTable(contentOf(content, tdTowersKind())),
    waves: waves.value,
  };
}
