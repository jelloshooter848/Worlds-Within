import type { AudioManager } from '@engine/audio/audio-manager';
import type { Renderer } from '@engine/gfx/renderer';
import type { InputFrame } from '@engine/input/input-manager';
import type { Scene } from '@engine/scene';
import { DEFAULT_SHEETS, renderWorld, TopDownWorld, type TdView } from '@kits/topdown';
import { demoDungeon } from './rooms';

/**
 * The demo: the top-down kit's world in the demo rooms, drawn with flat placeholder colours (no
 * art is registered yet). Walk with the arrows, Z or X for the sword, C for the selected item.
 * Dying starts the rooms over.
 */
export class DemoScene implements Scene {
  private world = new TopDownWorld(demoDungeon(), { seed: 1 });
  private frame = 0;

  constructor(private readonly audio: AudioManager) {}

  enter(): void {
    this.audio.playMusic('demo');
  }

  update(input: InputFrame): void {
    this.frame++;
    this.world.update(input);
    for (const e of this.world.events.splice(0)) {
      if (e.type === 'dead') this.world = new TopDownWorld(demoDungeon(), { seed: this.frame });
    }
  }

  render(r: Renderer): void {
    r.clear('#000');
    const view: TdView = {
      frame: this.frame,
      reduceFlashing: false,
      sheets: DEFAULT_SHEETS,
      sheet: () => null,
    };
    renderWorld(r, view, this.world);
    r.debugText('WORLDS WITHIN - engine demo', 8, 14, '#fff');
    r.debugText(`room: ${this.world.room.id}   hearts: ${this.world.hero.hp / 2}`, 8, 30, '#aaa');
    r.debugText('arrows move, Z/X sword, C item', 8, 46, '#aaa');
  }
}
