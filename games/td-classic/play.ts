import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { InputFrame } from '@engine/core/input/input-manager';
import { PendingEvents } from '@engine/core/present';
import type { Scene } from '@engine/core/scene';
import type { TdEvent, TdGame, TdWorld } from '@kits/towerdefense';
import { createGame } from './headless';
import type { TdPicture } from './picture';

/**
 * The tower-defense sample as the browser plays it (Engine 0.12 T5): a `Scene` for
 * `bootBrowserGame` around the same `TdGame` the tools play (`headless.ts`). No DOM and no clock
 * (`main.ts` has them), so Node tests drive it on a `SceneStack` with scripted input.
 *
 * - **Keys and the touch pad** are the kit's controls (`TdControls`): arrows move the cursor, Z
 *   (jump) places, X (attack) cycles the tower type, C (special) sells, Enter (start) starts the
 *   next wave.
 * - **Pointer taps** are frame input (Engine 0.15, gap D1): the shell puts each step's taps on the
 *   frame and the kit's `TdGame.step` maps them through its camera: a tap moves the cursor there,
 *   a second tap on the cursor's cell places, a right click or long-press sells.
 * - **Page buttons** are the shell's `InputManager.press(action)` (`main.ts`): pressed on the next
 *   game tick.
 *
 * The scene's `tickRate` is `TICKS_PER_SECOND` (Engine 0.15, gap D2): the shell's `SceneStack`
 * steps it on its ticks only and merges the loop steps' input between them (`MergedInput`: an
 * action pressed on any of them counts as pressed, and as held, on the tick, and every tap
 * arrives), so no press falls between ticks. One press held for one tick on the page is one press
 * in a run file: a run file's `input` typed tick by tick plays the same round (the browser test
 * does it with `won.run.json`).
 */

/** Game ticks the page plays per second (the loop steps 60 times a second). */
export const TICKS_PER_SECOND = 30;
/** Loop steps per game tick on the page (what a browser test steps per tick). */
export const STEPS_PER_TICK = 60 / TICKS_PER_SECOND;

export interface TdPlayOptions {
  /** The game's content and seed (`game.json`'s `start.seed` on the page). */
  content: ContentBundle;
  seed: number;
  /** Makes the picture on the first render (`tdPicture` onto the display's presenter). */
  picture(r: Renderer, game: TdGame): TdPicture;
}

export class TdPlay implements Scene {
  readonly game: TdGame;
  readonly tickRate = TICKS_PER_SECOND;
  private picture: TdPicture | null = null;
  /** The events of the ticks since the last draw. */
  private readonly pending: PendingEvents<TdWorld, TdEvent>;

  constructor(private readonly opts: TdPlayOptions) {
    this.game = createGame(opts.content, opts.seed);
    this.pending = new PendingEvents<TdWorld, TdEvent>(this.game.world);
  }

  /** The game tick. */
  get tick(): number {
    return this.game.world.tick;
  }

  /** One game tick (the shell calls it `TICKS_PER_SECOND` times a second, with merged input). */
  update(input: InputFrame): void {
    this.game.step(input);
    this.pending.add(this.game.world, this.game.events);
  }

  /** The game the page plays, for the shell's step hook (`window.__ww`). */
  headless(): TdGame {
    return this.game;
  }

  render(r: Renderer): void {
    this.picture ??= this.opts.picture(r, this.game);
    this.picture.draw(this.game.world, this.pending.take());
  }
}
