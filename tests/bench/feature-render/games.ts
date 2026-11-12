import type { ContentBundle } from '@engine/core/content/bundle';
import type { JsonObject } from '@engine/core/headless';
import { ScriptedInput, type InputScript } from '@engine/core/input/scripted-input';
import type { PresentFrame, SkinFile } from '@engine/core/present';
import type { ViewGame } from '@engine/core/view';
import { loadSkirmish, skirmishSkin } from '../../../games/samples/rts-skirmish/content';
import { createView as skirmishView } from '../../../games/samples/rts-skirmish/view';
import { loadTowerDefense } from '../../../games/samples/tower-defense/content';
import { tdLook } from '../../../games/samples/tower-defense/picture';
import { createView as tdView } from '../../../games/samples/tower-defense/view';
import type { FeatureBase, FeatureGameInfo, FeatureMap } from './scene';

// The two sample games the feature benchmark draws (Engine 0.16 T13): each game's own content and
// `canvas2d` skin, and a busy frame of it, made by playing one of its run files to a tick through
// its view (`createView(...).frame()`), so the map, buildings, towers and unit kinds are the real
// ones. Works in Node (the scene test) and in the bench page: the game's files and the run file
// come in as text (`readGameFiles` in Node; `run.ts` hands them to the page).

export interface FeatureGameDef {
  /** The game folder, from the repo root. */
  dir: string;
  /** The run file played to `tick` for the base frame, relative to `dir`. */
  run: string;
  tick: number;
  /** Units walking by default. */
  units: number;
  font: string;
  title: string;
  unitKinds: readonly string[];
  barKind?: string;
}

export const FEATURE_GAMES: Record<FeatureMap, FeatureGameDef> = {
  rts: {
    dir: 'games/samples/rts-skirmish',
    run: 'runs/fog.run.json',
    // The hero beside blue's barracks (Engine 0.16 part D, D8): the view is fogged, so the base
    // frame's units are the ones red sees then.
    tick: 440,
    units: 500,
    font: 'ford-small',
    title: 'River Ford',
    unitKinds: ['unit:worker', 'unit:hero', 'unit:soldier:enemy'],
    barKind: 'health-bar',
  },
  td: {
    dir: 'games/samples/tower-defense',
    run: 'runs/win.run.json',
    tick: 500,
    units: 300,
    font: 'road-small',
    title: 'Winding Rd',
    unitKinds: ['enemy:runner'],
  },
};

/** A run file as far as the base frame needs it. */
interface RunText {
  seed?: number;
  input?: InputScript;
  orders?: ({ tick: number } & JsonObject)[];
}

export interface FeatureGame {
  content: ContentBundle;
  /** The game's own `canvas2d` skin. */
  skin: SkinFile;
  base: FeatureBase;
  info: FeatureGameInfo;
}

/** Plays `run` on `view` to `ticks` (its orders before the step from their tick, as `run` does). */
function playTo(view: ViewGame & { order?(o: JsonObject): unknown }, run: RunText, ticks: number): void {
  const input = new ScriptedInput(run.input ?? { steps: [] });
  const orders = run.orders ?? [];
  let next = 0;
  for (let tick = 1; tick <= ticks; tick++) {
    for (; next < orders.length && orders[next]!.tick === tick - 1; next++) {
      const { tick: _tick, ...order } = orders[next]!;
      view.order?.(order as JsonObject);
    }
    input.next();
    view.step(input);
  }
}

/**
 * The game's content, skin and base frame from its files (`{ path: text }` relative to the game
 * folder, as `readGameFiles` gives them) and the run file's text.
 */
export function featureGame(
  map: FeatureMap,
  files: Readonly<Record<string, string>>,
  runText: string,
): FeatureGame {
  const def = FEATURE_GAMES[map];
  const loaded = map === 'rts' ? loadSkirmish(files) : loadTowerDefense(files);
  if (!loaded.ok) throw new Error(`${def.dir} does not load: ${JSON.stringify(loaded.errors)}`);
  const content = loaded.value;
  const run = JSON.parse(runText) as RunText;
  const seed = run.seed ?? content.manifest.start?.seed ?? 1;
  const view = map === 'rts' ? skirmishView(content, seed) : tdView(content, seed);
  playTo(view, run, def.tick);
  if (!view.frame) throw new Error(`${def.dir}'s view has no frame()`);
  const frame = view.frame() as PresentFrame;
  const skin = map === 'rts' ? skirmishSkin(content, 'canvas2d') : tdLook(content).skin;
  return {
    content,
    skin,
    base: { frame, unitKinds: def.unitKinds, ...(def.barKind !== undefined && { barKind: def.barKind }) },
    info: {
      map,
      font: def.font,
      title: def.title,
      width: content.manifest.screen.width,
      cols: frame.map && 'cols' in frame.map ? frame.map.cols : 1,
      rows: frame.map && 'rows' in frame.map ? frame.map.rows : 1,
    },
  };
}
