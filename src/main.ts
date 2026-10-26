import { AudioManager } from '@engine/audio/audio-manager';
import { CanvasRenderer } from '@engine/gfx/renderer';
import { GamepadSource } from '@engine/input/gamepad';
import { InputManager } from '@engine/input/input-manager';
import { KeyboardSource } from '@engine/input/keyboard';
import { FixedLoop } from '@engine/loop';
import { SceneStack } from '@engine/scene';
import { Viewport } from '@engine/viewport';
import { DEMO_SONG } from './game/demo/music';
import { DemoScene } from './game/demo/scene';

function boot(): void {
  const canvas = document.getElementById('screen') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('#screen canvas missing');

  const viewport = new Viewport(canvas);
  const renderer = new CanvasRenderer(viewport.ctx);
  const input = new InputManager(1);
  input.addSource('keyboard', new KeyboardSource());
  if (GamepadSource.available()) input.addSource('gamepad', new GamepadSource());

  const audio = new AudioManager();
  audio.registerSongs([DEMO_SONG]);
  // Browsers only start audio inside a user gesture; keep listening so an interrupted context recovers.
  const unlock = () => audio.unlock();
  for (const ev of ['keydown', 'pointerdown', 'pointerup', 'touchend', 'click']) {
    window.addEventListener(ev, unlock, { passive: true });
  }

  const scenes = new SceneStack();
  scenes.push(new DemoScene(audio));

  new FixedLoop({
    step() {
      input.beginFrame();
      scenes.update([input.player(0)]);
    },
    render() {
      scenes.render(renderer);
      viewport.present();
    },
  }).start();
}

boot();
