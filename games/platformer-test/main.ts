import { AudioManager } from '@engine/core/audio/audio-manager';
import { contentSfx, mustLoad } from '@engine/core/content/game-content';
import { canvasDisplay } from '@engine/backends/canvas2d';
import { bootBrowserGame, HostScene } from '@engine/core/shell';
import { loadTest } from './content';
import { TEST_FILES } from './files';
import { testLook, testPicture } from './picture';
import { testLook3d } from './picture3d';
import { createGame } from './headless';

/**
 * Boots the stacking test in the browser with the engine's `bootBrowserGame` (keyboard, gamepad,
 * the touch pad, the scene stack, the fixed loop and the 2D/3D toggle): Canvas2D by default, the
 * Three.js backend with `?backend=three` (imported only then, so the 2D page loads no Three.js).
 * Both displays take the level skin and a skin per mini game (`rounds`) and hand each frame to the
 * right one, so the scene draws one stream of frames onto `display.presenter` either way (gap G34,
 * fixed in 0.7 T9). Sounds: the skins' event sounds go to an `AudioManager` with the game's sfx;
 * the shell has no audio yet, so the unlock on the first gesture is here (gap G27). The scene is
 * the engine's `HostScene` over the headless game itself (`createGame`, every level in turn; gap
 * G37, fixed in 0.10): it pushes the core `miniGameScene` when the door starts the vault round
 * (the level sequence still steps it, so the round's result acts on the level as headless).
 */
const content = mustLoad(loadTest(TEST_FILES), 'the stacking test');
const look = testLook(content);
const audio = new AudioManager();
audio.registerSfx(contentSfx(content));
const unlock = () => audio.unlock();
for (const ev of ['keydown', 'pointerdown', 'pointerup', 'touchend', 'click'])
  window.addEventListener(ev, unlock, { passive: true });
const onSound = (id: string) => audio.sfx(id);

void bootBrowserGame({
  screen: look.screen,
  displays: {
    canvas2d: (canvas) => canvasDisplay(canvas, { ...look, onSound }),
    three: async (canvas) =>
      (await import('@engine/backends/three')).threeDisplay(canvas, { ...testLook3d(content), onSound }),
  },
  scene: (stack, display) =>
    new HostScene({
      stack,
      game: createGame(content, content.manifest.start.seed),
      picture: () => testPicture(display.presenter, look.screen),
    }),
});
