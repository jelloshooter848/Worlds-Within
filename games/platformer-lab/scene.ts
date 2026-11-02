import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { InputFrame } from '@engine/core/input/input-manager';
import { miniGameScene } from '@engine/core/minigame-scene';
import type { Scene, SceneStack } from '@engine/core/scene';
import type { PlatformerEvent, PlatformerWorld } from '@kits/platformer';
import { createGame, type LabGame } from './headless';

/** What the scene draws through: `LabPicture` (Canvas2D) or `LabPicture3d` (Three.js). */
export interface LabDrawer {
  draw(world: PlatformerWorld, events: readonly PlatformerEvent[]): unknown;
}

/**
 * Makes the scene's drawer on its first render. The Canvas2D one draws through the renderer it
 * is handed (`r => new LabPicture(r, look)`); the 3D one ignores it, since `LabPicture3d` draws
 * through its own presenter (`main3d.ts`).
 */
export type MakeLabDrawer = (r: Renderer) => LabDrawer;

/**
 * The lab in the browser: the headless game (`LabGame`, every level in turn) drawn from the kit's
 * frames by whichever drawer `main.ts` gives it: Canvas2D and the lab's skin (`picture.ts`), or
 * Three.js and the `three` skin (`picture3d.ts`, with `?backend=three`). Arrows (or the touch
 * pad) move, Z jumps, X runs; in the mini game X (attack) stops the bar.
 *
 * Mini games (the kit's hook, `kits/platformer/CLAUDE.md`): after a step that starts a round,
 * the scene pushes `miniGameScene` over itself. That scene steps the lab (so the world steps the
 * round and applies its outcome, exactly as headless) and is popped on the round's result; while
 * it is on top the `SceneStack` does not update this scene.
 */
export class LabScene implements Scene {
  private readonly game: LabGame;
  /** The events since the last draw (several steps can run between two draws), and their world. */
  private events: PlatformerEvent[] = [];
  private eventsOf: PlatformerWorld;
  private picture: LabDrawer | null = null;

  constructor(
    content: ContentBundle,
    private readonly makePicture: MakeLabDrawer,
    private readonly stack: SceneStack,
  ) {
    this.game = createGame(content, content.manifest.start.seed);
    this.eventsOf = this.game.world;
  }

  update(input: InputFrame): void {
    this.step(input);
    const run = this.game.world.miniGame;
    if (run && this.stack.top === this)
      this.stack.push(
        miniGameScene({
          game: run.game,
          step: (i) => this.step(i),
          render: (r) => this.render(r),
          done: () => this.stack.pop(),
        }),
      );
  }

  render(r: Renderer): void {
    this.picture ??= this.makePicture(r);
    this.picture.draw(this.game.world, this.events.splice(0));
  }

  /** One tick of the lab, keeping its events for the next draw (dropped when the level changes). */
  private step(input: InputFrame): void {
    this.game.step(input);
    if (this.game.world !== this.eventsOf) {
      this.eventsOf = this.game.world;
      this.events = [];
    }
    this.events.push(...this.game.events);
  }
}
