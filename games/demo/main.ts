import { AssetRegistry } from '@engine/core/assets/registry';
import { AudioManager } from '@engine/core/audio/audio-manager';
import { GamepadSource } from '@engine/core/input/gamepad';
import { InputManager } from '@engine/core/input/input-manager';
import { KeyboardSource } from '@engine/core/input/keyboard';
import { FixedLoop } from '@engine/core/loop';
import { SceneStack } from '@engine/core/scene';
import { CanvasRenderer, Viewport } from '@engine/backends/canvas2d';
import { sheetLookup } from '@kits/topdown';
import { demoArt, demoSongs, loadDemo, mustLoad } from './content';
import { DEMO_FILES } from './files';
import { DemoScene } from './scene';

function boot(): void {
  const canvas = document.getElementById('screen') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('#screen canvas missing');

  const content = mustLoad(loadDemo(DEMO_FILES));
  const art = demoArt(content);
  const assets = new AssetRegistry({ default: art.palettes });
  assets.defineAll(art.sprites);

  const viewport = new Viewport(canvas);
  const renderer = new CanvasRenderer(viewport.ctx);
  const input = new InputManager(1);
  input.addSource('keyboard', new KeyboardSource());
  if (GamepadSource.available()) input.addSource('gamepad', new GamepadSource());

  const audio = new AudioManager();
  audio.registerSongs(demoSongs(content));
  // Browsers only start audio inside a user gesture; keep listening so an interrupted context recovers.
  const unlock = () => audio.unlock();
  for (const ev of ['keydown', 'pointerdown', 'pointerup', 'touchend', 'click']) {
    window.addEventListener(ev, unlock, { passive: true });
  }

  const scenes = new SceneStack();
  scenes.push(new DemoScene(content, audio, sheetLookup(assets)));

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
