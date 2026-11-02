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
 * fixed in 0.7 T9). Sounds: the shell's `audio` option makes the `AudioManager` with the game's
 * sfx, unlocks it on the first key, tap or click and hands the displays its `onSound` (gap G27,
 * fixed in 0.11); the skins give the round's end a sound per result (`mini-game-end:pass`, G28).
 * The scene is
 * the engine's `HostScene` over the headless game itself (`createGame`, every level in turn; gap
 * G37, fixed in 0.10): it pushes the core `miniGameScene` when the door starts the vault round
 * (the level sequence still steps it, so the round's result acts on the level as headless).
 */
const content = mustLoad(loadTest(TEST_FILES), 'the stacking test');
const look = testLook(content);

void bootBrowserGame({
  screen: look.screen,
  audio: { sfx: contentSfx(content) },
  displays: {
    canvas2d: (canvas, { onSound }) => canvasDisplay(canvas, { ...look, onSound }),
    three: async (canvas, { onSound }) =>
      (await import('@engine/backends/three')).threeDisplay(canvas, { ...testLook3d(content), onSound }),
  },
  scene: (stack, display) =>
    new HostScene({
      stack,
      game: createGame(content, content.manifest.start.seed),
      picture: () => testPicture(display.presenter, look.screen),
    }),
});
