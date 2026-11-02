import type { Renderer } from '../gfx/renderer';
import type { InputFrame } from '../input/input-manager';
import type { MiniGame } from '../minigame';
import { miniGameScene } from '../minigame-scene';
import { PendingEvents } from '../present/stream';
import type { Scene, SceneStack } from '../scene';

/**
 * The scene that plays a headless game in the browser and pushes its mini games (Engine 0.7, moved
 * from `games/platformer-lab/scene.ts`). The game gives accessors, so any kit's world fits: `step`
 * one tick, the `world` now and the last step's `events`, and the `miniGame` it is running (or
 * null). After a step that starts a round the scene pushes the core `miniGameScene` over itself;
 * that scene steps the game too (so the host steps the round and applies its outcome, exactly as
 * headless) and is popped on the round's result. While it is on top the `SceneStack` does not
 * update this scene. Events are gathered between draws (several steps can run between two frames)
 * and dropped when the world changes (`PendingEvents`). It draws through the drawer `picture(r)`
 * makes on its first render (a `FramePicture` onto a display's presenter, or anything that draws
 * through `r`). Pure: no clock, no DOM.
 */

/** What the scene draws through: the world now and the events since the last draw. */
export interface HostDrawer<W, E> {
  draw(world: W, events: readonly E[]): unknown;
}

export interface HostSceneOptions<W extends object, E> {
  /** The stack the scene is on (it pushes the mini game's scene there). */
  readonly stack: SceneStack;
  /** One tick of the game. */
  step(input: InputFrame): void;
  /** The world now (a new object when the game moves to another level). */
  world(): W;
  /** The events of the last step. */
  events(): readonly E[];
  /** The mini game the world is running, or null. */
  miniGame(): MiniGame | null;
  /** Makes the drawer on the first render, with the renderer the stack hands it. */
  picture(r: Renderer): HostDrawer<W, E>;
  /** True to keep drawing the level under the mini game's scene. */
  readonly translucentMiniGame?: boolean;
}

export class HostScene<W extends object, E> implements Scene {
  private readonly pending: PendingEvents<W, E>;
  private drawer: HostDrawer<W, E> | null = null;

  constructor(private readonly opts: HostSceneOptions<W, E>) {
    this.pending = new PendingEvents(opts.world());
  }

  update(input: InputFrame): void {
    this.step(input);
    const game = this.opts.miniGame();
    const { stack } = this.opts;
    if (game && stack.top === this)
      stack.push(
        miniGameScene({
          game,
          step: (i) => this.step(i),
          render: (r) => this.render(r),
          done: () => stack.pop(),
          translucent: this.opts.translucentMiniGame ?? false,
        }),
      );
  }

  render(r: Renderer): void {
    this.drawer ??= this.opts.picture(r);
    this.drawer.draw(this.opts.world(), this.pending.take());
  }

  /** One tick, keeping its events for the next draw (dropped when the world changes). */
  private step(input: InputFrame): void {
    this.opts.step(input);
    this.pending.add(this.opts.world(), this.opts.events());
  }
}
