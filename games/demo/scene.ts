import type { AudioManager } from '@engine/core/audio/audio-manager';
import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { InputFrame } from '@engine/core/input/input-manager';
import type { Scene } from '@engine/core/scene';
import type { SpriteSheet } from '@engine/core/gfx/spritesheet';
import { renderWorld, type TdView, type TopDownWorld } from '@kits/topdown';
import { DEMO_SHEETS } from './content';
import { createWorld } from './headless';

/**
 * The demo: the top-down kit's world in the demo rooms. The hero is drawn from its sprite file;
 * everything else still uses the kit's flat placeholder colours. Walk with the arrows, Z or X for
 * the sword, C for the selected item. Dying starts the rooms over.
 */
export class DemoScene implements Scene {
  private world: TopDownWorld;
  private frame = 0;

  constructor(
    private readonly content: ContentBundle,
    private readonly audio: AudioManager,
    private readonly sheet: (id: string, palette?: string) => SpriteSheet | null,
  ) {
    this.world = createWorld(content);
  }

  enter(): void {
    this.audio.playMusic('demo');
  }

  update(input: InputFrame): void {
    this.frame++;
    this.world.update(input);
    for (const e of this.world.events.splice(0)) {
      if (e.type === 'dead') this.world = createWorld(this.content, this.frame);
    }
  }

  render(r: Renderer): void {
    renderDemo(r, this.world, this.frame, this.sheet);
  }
}

/**
 * Draws one frame of the demo: the world, then the title and status lines. Shared by the scene
 * and the view module (`view.ts`, for `pnpm cli screenshot`), so a screenshot is what a player sees.
 */
export function renderDemo(
  r: Renderer,
  world: TopDownWorld,
  frame: number,
  sheet: (id: string, palette?: string) => SpriteSheet | null,
): void {
  r.clear('#000');
  const view: TdView = { frame, reduceFlashing: false, sheets: DEMO_SHEETS, sheet };
  renderWorld(r, view, world);
  r.debugText('WORLDS WITHIN - engine demo', 8, 14, '#fff');
  r.debugText(`room: ${world.room.id}   hearts: ${world.hero.hp / 2}`, 8, 30, '#aaa');
  r.debugText('arrows move, Z/X sword, C item', 8, 46, '#aaa');
}
