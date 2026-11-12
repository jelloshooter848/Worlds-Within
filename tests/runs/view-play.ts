import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CampaignSave } from '@engine/core/campaign';
import type { ContentBundle } from '@engine/core/content/bundle';
import type { JsonObject } from '@engine/core/headless';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import type { ViewEntry, ViewGame } from '@engine/core/view';
import { loadGame } from '../../engine/tools/game-loader';
import { missionOf, orderOf, playRun, stateHash, type TickHash } from '../../engine/tools/headless-run';
import { readRunFile, runStartOf, type RunFile } from '../../engine/tools/run-file';

// Shared by the run tests that play a run file through a game's view (backend parity, Engine 0.7;
// presentation invariance, Engine 0.16): load a run with its golden hashes, make the game's view
// as `pnpm cli run` makes its headless game, and play it tick by tick.

/**
 * A long run (Engine 0.16 part D, D9: the River Ford's ten-minute matches, ~6000 ticks) is played
 * through views and presenters only for its first `PRESENTED_TICKS` ticks: drawing every tick of
 * it in every presentation test would take minutes, while its whole length is checked headless
 * (`run-files.test.ts`, `mutants`). A run is long from `LONG_RUN_TICKS` ticks.
 */
export const LONG_RUN_TICKS = 5000;
export const PRESENTED_TICKS = 600;

/** `run` cut to the ticks the presentation tests play (`PRESENTED_TICKS` for a long run). */
export function presentedRun(run: RunFile): RunFile {
  if (run.ticks < LONG_RUN_TICKS) return run;
  const ticks = PRESENTED_TICKS;
  return {
    ...run,
    ticks,
    orders: run.orders.filter((o) => o.tick < ticks),
    missions: run.missions.filter((m) => m.tick < ticks),
    assertions: run.assertions.filter((a) => a.tick <= ticks),
    ...(run.hashes === undefined ? {} : { hashes: run.hashes.filter((h) => h.tick <= ticks) }),
  };
}

/**
 * A run file's game content, the run and its committed golden hashes: for a long run only its
 * presented part (`presentedRun`) and the golden hashes up to it, with `cut` true (play it
 * headless with `{ untilTick: run.ticks }`); `full` keeps the whole run.
 */
export function loadRun(
  root: string,
  file: string,
  { full = false }: { full?: boolean } = {},
): { content: ContentBundle; run: RunFile; golden: TickHash[]; gameDir: string; cut: boolean } {
  const loaded = readRunFile(root, file);
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  if (loaded.value.gameDir === null) throw new Error(`${file} plays a world, not a game`);
  const game = loadGame(root, loaded.value.gameDir);
  if (!game.content.ok) throw new Error(JSON.stringify(game.content.errors));
  const goldenFile = join(root, file.replace(/\.run\.json$/, '.hashes.json'));
  const golden = (JSON.parse(readFileSync(goldenFile, 'utf8')) as { hashes: TickHash[] }).hashes;
  const whole = loaded.value.run;
  const run = full ? whole : presentedRun(whole);
  const cut = run.ticks < whole.ticks;
  return {
    content: game.content.value,
    run,
    golden: cut ? golden.filter((h) => h.tick <= run.ticks) : golden,
    gameDir: loaded.value.gameDir,
    cut,
  };
}

/**
 * A maker of fresh views for `file`'s game (each call a new game at tick 0), started as `pnpm cli
 * run` starts the headless game: the run's seed, rules, `start`, and for a run `from` another run
 * or a save code (Engine 0.13) the campaign save it starts from. `content` may be the game's
 * content with its skins changed (presentation only).
 */
export async function viewMaker(
  root: string,
  file: string,
  content: ContentBundle,
  run: RunFile,
): Promise<() => ViewGame> {
  const dir = file.slice(0, file.indexOf('/runs/'));
  const manifest = JSON.parse(readFileSync(join(root, dir, 'game.json'), 'utf8')) as { view: string };
  const entry = (await import(join(root, dir, manifest.view))) as ViewEntry;
  let campaign: CampaignSave | null = null;
  if (run.from !== undefined) {
    const started = await playRun(root, file, { untilTick: 0 });
    if (!started.ok) throw new Error(JSON.stringify(started.errors));
    campaign = started.value.startSave;
  }
  return () =>
    entry.createView(content, run.seed ?? content.manifest.start.seed, {
      disabledRules: run.disableRules,
      ...(campaign === null ? {} : { campaign }),
      // A run that starts at a later level or campaign entry (Engine 0.14, gap G9, `start`).
      ...(run.start === undefined ? {} : { start: runStartOf(run.start)! }),
    });
}

/**
 * Plays `run` through a game's view as `pnpm cli run` plays its headless game, calling `show` each
 * tick. Recorded orders (Engine 0.9) go to the view's `order` after the tick's state is shown and
 * hashed, before the step from it, as `run` hands them to the headless game; a game run's mission
 * steps (Engine 0.11) follow them. Returns the hashes `run` would report.
 */
export function playView(view: ViewGame, run: RunFile, show: (view: ViewGame) => void): TickHash[] {
  const input = new ScriptedInput(run.input);
  const hashes: TickHash[] = [];
  const takesOrders = view as ViewGame & { order?(order: JsonObject): string | null };
  for (let tick = 0; tick <= run.ticks; tick++) {
    if (tick > 0) {
      input.next();
      view.step(input);
    }
    show(view);
    if (tick % run.hashEvery === 0 || tick === run.ticks)
      hashes.push({ tick, hash: stateHash(view.snapshot()) });
    for (const entry of run.orders) {
      if (entry.tick !== tick) continue;
      if (takesOrders.order === undefined)
        throw new Error(`the view takes no orders, ${run.orders.length} given`);
      takesOrders.order(orderOf(entry));
    }
    // Mission steps (Engine 0.11) after the tick's orders, as `run` hands them to the game.
    for (const step of run.missions) {
      if (step.tick !== tick) continue;
      if (view.mission === undefined)
        throw new Error(`the view takes no missions, ${run.missions.length} given`);
      view.mission(missionOf(step));
    }
  }
  return hashes;
}
