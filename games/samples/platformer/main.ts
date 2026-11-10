import { contentSfx, contentSongs, mustLoad } from '@engine/core/content/game-content';
import { canvasDisplay } from '@engine/backends/canvas2d';
import { bootBrowserGame, HostScene } from '@engine/core/shell';
import { contentFonts } from '@engine/core/ui';
import { loadHopper, PLATFORMER_MUSIC } from './content';
import { hopperLook, hopperPicture } from './picture';
import { hopperLook3d } from './picture3d';
import { createGame } from './headless';
import gameFiles from 'virtual:game-files';

/**
 * Boots Hopper's Way in the browser with the engine's `bootBrowserGame` (keyboard, gamepad, the
 * touch pad, the scene stack, the fixed loop, the menus and the 2D/3D toggle) at its 16:9 screen
 * (320x180, so 6x fills 1920x1080): Canvas2D by default, the Three.js backend with
 * `?backend=three` (imported only then, so the 2D page loads no Three.js). Sounds are the shell's
 * (`audio`: the game's songs and sfx, the `meadow` song from the first key, tap or click). The
 * scene is the engine's `HostScene` over the headless game itself (`createGame`, every stage of
 * the campaign in turn).
 */
const content = mustLoad(loadHopper(gameFiles), 'the platformer sample');
const look = hopperLook(content);
const fonts = contentFonts(content);

void bootBrowserGame({
  screen: look.screen,
  game: content.manifest.id,
  transitions: content.manifest.transitions,
  audio: { songs: contentSongs(content), sfx: contentSfx(content), music: PLATFORMER_MUSIC },
  menus: { spec: content.manifest.menus, fonts, sheets: look.sheet },
  displays: {
    canvas2d: (canvas, { onSound }) => canvasDisplay(canvas, { ...look, fonts, onSound }),
    three: async (canvas, { onSound }) =>
      (await import('@engine/backends/three')).threeDisplay(canvas, {
        ...hopperLook3d(content),
        fonts,
        onSound,
      }),
  },
  scene: (stack, display) =>
    new HostScene({
      stack,
      game: createGame(content, content.manifest.start.seed),
      picture: () => hopperPicture(display.presenter, look.screen),
    }),
});
