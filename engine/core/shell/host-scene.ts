import type { Renderer } from '../gfx/renderer';
import type { HostedGame } from '../headless';
import type { InputFrame } from '../input/input-manager';
import type { MiniGame } from '../minigame';
import { miniGameScene } from '../minigame-scene';
import { PendingEvents } from '../present/stream';
import type { Scene, SceneStack } from '../scene';

/**
 * The scene that plays a headless game in the browser and pushes its mini games (Engine 0.7, moved
 * from `games/platformer-lab/scene.ts`). Give it the game itself (`game`, a `HostedGame` such as
 * the platformer kit's `LevelSequence`; Engine 0.10, gap G37), or accessors, so any kit's world
 * fits: `step` one tick, the `world` now and the last step's `events`, and the `miniGame` it is
 * running (or null). After a step that starts a round the scene pushes the core `miniGameScene` over itself;
 * that scene steps the game too (so the host steps the round and applies its outcome, exactly as
 * headless) and is popped on the round's result. While it is on top the `SceneStack` does not
 * update this scene. Events are gathered between draws (several steps can run between two frames)
 * and dropped when the world changes (`PendingEvents`). A mission round is pushed the same way
 * (Engine 0.11, item 173): a `MissionHost` (`../mission-host.ts`) is a `HostedGame` whose
 * `miniGame()` is the round it hosts, and its `step` steps that round while the world waits. It draws through the drawer `picture(r)`
 * makes on its first render (a `FramePicture` onto a display's presenter, or anything that draws
 * through `r`). Pure: no clock, no DOM.
 */

/** What the scene draws through: the world now and the events since the last draw. */
export interface HostDrawer<W, E> {
  draw(world: W, events: readonly E[]): unknown;
}

/** What every host scene is given: its stack, its drawer and how a round is shown. */
interface HostSceneBase<W extends object, E> {
  /** The stack the scene is on (it pushes the mini game's scene there). */
  readonly stack: SceneStack;
  /** Makes the drawer on the first render, with the renderer the stack hands it. */
  picture(r: Renderer): HostDrawer<W, E>;
  /** True to keep drawing the level under the mini game's scene. */
  readonly translucentMiniGame?: boolean;
}

/** The game itself (Engine 0.10, gap G37): the scene reads `world`, `events` and `miniGame()`. */
export interface HostSceneGameOptions<W extends object, E> extends HostSceneBase<W, E> {
  readonly game: HostedGame<W, E>;
}

/** Accessors, for a game that is not a `HostedGame`. */
export interface HostSceneAccessorOptions<W extends object, E> extends HostSceneBase<W, E> {
  /** One tick of the game. */
  step(input: InputFrame): void;
  /** The world now (a new object when the game moves to another level). */
  world(): W;
  /** The events of the last step. */
  events(): readonly E[];
  /** The mini game the world is running, or null. */
  miniGame(): MiniGame | null;
}

export type HostSceneOptions<W extends object, E> =
  HostSceneGameOptions<W, E> | HostSceneAccessorOptions<W, E>;

export class HostScene<W extends object, E> implements Scene {
  private readonly opts: HostSceneAccessorOptions<W, E>;
  private readonly pending: PendingEvents<W, E>;
  private drawer: HostDrawer<W, E> | null = null;

  /**
   * `new HostScene({ stack, game, picture })` with the game itself, or
   * `new HostScene({ stack, step, world, events, miniGame, picture })` with accessors.
   */
  constructor(opts: HostSceneOptions<W, E>) {
    this.opts = 'game' in opts ? hostAccessors(opts) : opts;
    this.pending = new PendingEvents(this.opts.world());
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

/** A hosted game's accessors, as the scene reads them. */
function hostAccessors<W extends object, E>(
  opts: HostSceneGameOptions<W, E>,
): HostSceneAccessorOptions<W, E> {
  const { game, ...base } = opts;
  return {
    ...base,
    step: (input) => game.step(input),
    world: () => game.world,
    events: () => game.events,
    miniGame: () => game.miniGame(),
  };
}
