import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { Action } from '@engine/core/input/actions';
import type { InputFrame } from '@engine/core/input/input-manager';
import type { PointerGesture } from '@engine/core/input/pointer-logic';
import { PendingEvents } from '@engine/core/present';
import type { Scene } from '@engine/core/scene';
import { cameraHint, TD_TILE_SIZE, type TdEvent, type TdGame, type TdWorld } from '@kits/towerdefense';
import { createGame } from './headless';
import type { TdPicture } from './picture';

/**
 * The tower-defense sample as the browser plays it (Engine 0.12 T5): a `Scene` for
 * `bootBrowserGame` around the same `TdGame` the tools play (`headless.ts`). No DOM and no clock
 * (`main.ts` has them), so Node tests drive it with scripted input and taps.
 *
 * - **Keys and the touch pad** are the kit's controls (`TdControls`): arrows move the cursor, Z
 *   (jump) places, X (attack) cycles the tower type, C (special) sells, Enter (start) starts the
 *   next wave.
 * - **Pointer taps** go to the kit's `TdGame.tap` through the frame's camera: a tap moves the
 *   cursor there, a second tap on the cursor's cell places, a right click or long-press sells.
 * - **Page buttons** (`press(action)`) count as that action pressed on the next game tick.
 *
 * The round steps one tick every `stepsPerTick` loop steps (the loop steps 60 times a second; the
 * page plays `TICKS_PER_SECOND` ticks a second, so the fast runners are followable). The input of
 * the steps between two ticks is merged (`TickInput`): an action pressed on any of them counts as
 * pressed, and as held, on the tick, so no press falls between ticks. One press held for one
 * tick on the page is one press in a run file: a run file's `input` typed tick by tick plays the
 * same round (the browser test does it with `won.run.json`).
 */

/** Game ticks the page plays per second (the loop steps 60 times a second). */
export const TICKS_PER_SECOND = 30;
export const STEPS_PER_TICK = 60 / TICKS_PER_SECOND;

/** What the page reads of the pointer each step (`PointerSource`, or a script in tests). */
export interface GestureFeed {
  gestures(): readonly PointerGesture[];
}

export interface TdPlayOptions {
  /** The game's content and seed (`game.json`'s `start.seed` on the page). */
  content: ContentBundle;
  seed: number;
  /** The pointer, or null (keys and buttons only). */
  pointer: GestureFeed | null;
  /** Makes the picture on the first render (`tdPicture` onto the display's presenter). */
  picture(r: Renderer, game: TdGame): TdPicture;
  /** Loop steps per game tick (default `STEPS_PER_TICK`). */
  stepsPerTick?: number;
}

/**
 * The input of the loop steps since the last tick as one tick's frame: held now, or pressed on
 * any step since the last tick (or by a page button), counts as held; pressed on any of them
 * counts as pressed. A release and a new press between two ticks read as one held press (a
 * player cannot tap twice in 1/30 s). Jump buffering is not used by the kit's controls.
 */
export class TickInput implements InputFrame {
  private readonly pressedSince = new Set<Action>();
  private last: InputFrame | null = null;

  /** One loop step's input. */
  add(input: InputFrame, actions: readonly Action[]): void {
    this.last = input;
    for (const a of actions) if (input.pressed(a)) this.pressedSince.add(a);
  }

  /** A page button: pressed on the next tick. */
  press(action: Action): void {
    this.pressedSince.add(action);
  }

  /** Called after the tick that read it: the next tick starts afresh. */
  clear(): void {
    this.pressedSince.clear();
  }

  held(a: Action): boolean {
    return this.pressedSince.has(a) || (this.last?.held(a) ?? false);
  }
  pressed(a: Action): boolean {
    return this.pressedSince.has(a);
  }
  released(a: Action): boolean {
    return this.last?.released(a) ?? false;
  }
  bufferedJump(): boolean {
    return this.pressedSince.has('jump');
  }
  consumeJumpBuffer(): void {}
  get dirX(): -1 | 0 | 1 {
    const right = this.held('right');
    if (right) return 1;
    return this.held('left') ? -1 : 0;
  }
}

/** The actions the kit's controls read. */
const ACTIONS: readonly Action[] = ['left', 'right', 'up', 'down', 'jump', 'attack', 'special', 'start'];

export class TdPlay implements Scene {
  readonly game: TdGame;
  private readonly stepsPerTick: number;
  private readonly input = new TickInput();
  private steps = 0;
  private picture: TdPicture | null = null;
  /** The events of the ticks since the last draw. */
  private readonly pending: PendingEvents<TdWorld, TdEvent>;

  constructor(private readonly opts: TdPlayOptions) {
    this.game = createGame(opts.content, opts.seed);
    this.pending = new PendingEvents<TdWorld, TdEvent>(this.game.world);
    this.stepsPerTick = opts.stepsPerTick ?? STEPS_PER_TICK;
  }

  /** The game tick. */
  get tick(): number {
    return this.game.world.tick;
  }

  /** A page button: `action` pressed on the next game tick. */
  press(action: Action): void {
    this.input.press(action);
  }

  /** A pointer tap at picture point (x, y) (see the file comment). */
  tap(x: number, y: number, button: 'primary' | 'secondary' = 'primary'): void {
    const frame = {
      size: this.opts.content.manifest.screen,
      camera: cameraHint(this.game.world, TD_TILE_SIZE),
    };
    this.game.tap(x, y, frame, button, TD_TILE_SIZE);
  }

  update(input: InputFrame): void {
    for (const g of this.opts.pointer?.gestures() ?? []) if (g.type === 'tap') this.tap(g.x, g.y, g.button);
    this.input.add(input, ACTIONS);
    if (++this.steps % this.stepsPerTick !== 0) return;
    this.game.step(this.input);
    this.input.clear();
    this.pending.add(this.game.world, this.game.events);
  }

  render(r: Renderer): void {
    this.picture ??= this.opts.picture(r, this.game);
    this.picture.draw(this.game.world, this.pending.take());
  }
}
