import type { AudioManager } from '@engine/core/audio/audio-manager';
import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { InputFrame } from '@engine/core/input/input-manager';
import type { Scene } from '@engine/core/scene';
import type { TopDownWorld } from '@kits/topdown';
import { createWorld } from './headless';
import { DemoPicture, type DemoLook } from './picture';

/**
 * The demo: the top-down kit's world in the demo rooms, drawn by the Canvas2D backend from the
 * kit's presentation frames and the demo's skin (`picture.ts`). Walk with the arrows, Z or X for
 * the sword, C for the selected item. Dying starts the rooms over.
 */
export class DemoScene implements Scene {
  private world: TopDownWorld;
  private frame = 0;
  /** The world's events since the last draw (several updates can run between two draws). */
  private events: object[] = [];
  private picture: DemoPicture | null = null;

  constructor(
    private readonly content: ContentBundle,
    private readonly audio: AudioManager,
    private readonly look: DemoLook,
  ) {
    this.world = freshWorld(content);
  }

  enter(): void {
    this.audio.playMusic('demo');
  }

  update(input: InputFrame): void {
    this.frame++;
    this.world.update(input);
    const events = this.world.events.splice(0);
    this.events.push(...events);
    if (events.some((e) => e.type === 'dead')) {
      this.world = freshWorld(this.content, this.frame);
      this.events = [];
      this.picture?.reset();
    }
  }

  render(r: Renderer): void {
    this.picture ??= new DemoPicture(r, this.look, { onSound: (id) => this.audio.sfx(id) });
    this.picture.draw(this.world, this.events.splice(0));
  }
}

/**
 * A new world with the events it emitted while being built dropped (entering the first room), as
 * the headless game (`topdownGame`) drops them: sounds start with the first step.
 */
function freshWorld(content: ContentBundle, seed?: number): TopDownWorld {
  const world = createWorld(content, seed);
  world.events.splice(0);
  return world;
}
