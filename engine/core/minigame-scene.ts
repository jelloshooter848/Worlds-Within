import type { Renderer } from './gfx/renderer';
import type { InputFrame } from './input/input-manager';
import { RoundInput, type MiniGame, type MiniGameInputMap, type MiniGameResult } from './minigame';
import type { Scene } from './scene';

/**
 * The browser side of a mini game (`minigame.ts`): a scene a game's glue pushes on its
 * `SceneStack` over the level. It drives the same `MiniGame` the headless host does, so a round
 * plays the same in the browser as in a run file, and it calls `done` once, on the first frame
 * `result()` is set, for the glue to pop it. Kits never import this file (it is on
 * `FORBIDDEN_CORE`): scenes and drawing are the game's.
 *
 * A host that steps the mini game itself (a `PlatformerWorld` does, and applies the result's
 * outcome) passes its own `step`, so the host stays the only thing that moves the round:
 *
 *   // in the level scene's update, after world.update(input):
 *   const run = world.miniGame;
 *   if (run && stack.top === levelScene)
 *     stack.push(miniGameScene({
 *       game: run.game,
 *       step: (input) => world.update(input), // the world steps the round and applies its outcome
 *       render: (r, game) => drawMiniGame(r, game.snapshot()),
 *       done: () => stack.pop(),
 *     }));
 *
 * Stepping the game itself, the scene feeds it through a `RoundInput` (Engine 0.11, gap G18): a
 * button held into the round is ignored until released, and `inputMap` (the def's) is applied. A
 * host's `step` gets the raw frame, because the host does the same for the rounds it steps (the
 * platformer world does), so the rule holds once either way.
 *
 * While the mini game's scene is on top the level scene below gets no `update` (a `SceneStack`
 * updates only its top), so the level stays paused as it does headless.
 */
export interface MiniGameSceneOptions {
  readonly game: MiniGame;
  /**
   * One tick of the round, given the raw frame; when left out, `game.step` through a
   * `RoundInput` (the first-tick drop and `inputMap`).
   */
  step?(input: InputFrame): void;
  /** The round's own controls (its def's `inputMap`), used only when the scene steps `game` itself. */
  readonly inputMap?: MiniGameInputMap;
  /** Draws the round (from `game.snapshot()` or `game.present?.()` through a skin). */
  render(r: Renderer, game: MiniGame): void;
  /** Called once, on the frame the round reports its result. */
  done(result: MiniGameResult): void;
  /** True to keep drawing the level under the round (a small mini game in a box). */
  readonly translucent?: boolean;
}

/** A scene that steps `opts.game` each frame until it reports a result, then calls `opts.done`. */
export function miniGameScene(opts: MiniGameSceneOptions): Scene {
  const { game } = opts;
  let reported = false;
  const own = opts.step ? null : new RoundInput(opts.inputMap);
  const step = opts.step ?? ((input: InputFrame) => game.step(own!.advance(input)));
  return {
    translucent: opts.translucent ?? false,
    update(input) {
      if (reported) return;
      if (game.result() === null) step(input);
      const result = game.result();
      if (result === null) return;
      reported = true;
      opts.done(result);
    },
    render(r) {
      opts.render(r, game);
    },
  };
}
