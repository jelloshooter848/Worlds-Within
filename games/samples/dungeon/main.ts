import type { Mixer } from '@engine/core/audio/mixer';
import { withContentImages } from '@engine/core/assets/content-images';
import { canvasDisplay } from '@engine/backends/canvas2d';
import { bootBrowserGame } from '@engine/core/shell';
import { contentSfx, contentSongs } from '@engine/core/content/game-content';
import { DUNGEON_MUSIC, loadDungeon, mustLoad } from './content';
import { dungeonLook } from './picture';
import { DungeonScene } from './scene';
import gameFiles from 'virtual:game-files';

/**
 * Boots the dungeon sample in the browser with the engine's `bootBrowserGame`: keyboard,
 * gamepad, the touch pad, the scene stack, the fixed loop, the Canvas2D display at the 16:9
 * screen (320x180, so 6x fills 1920x1080), the menus, audio with the sample's songs and sfx (the
 * `crypt` song starts on the first key, tap or click), the shell's volume control (stored under
 * `ww:dungeon:volumes`, gap M1), the shell's mixer (Engine 0.16 part C T9: the skin's layered
 * `warden` music in the boss room, mixed from each frame's status, every event's sound varied by
 * the seed, big hits and dialogs ducking the music) and the step hook with `?debug=step`. The skin's PNG sheets (the
 * CC0 DungeonTileset II in `assets/`) are decoded before the page boots. The scene draws through
 * the display's own presenter (`DungeonPicture` with `presenter`), so the shell's sounds, hit
 * pauses, shake and flashing settings and the HUD hidden under the title all reach it. The
 * intro and end dialogs and the end screen are `game.json`'s `menus.dialogs` and `triggers`
 * (Engine 0.16 part C T7), shown by the shell; where it shows them (`page.endings`) the scene
 * draws no end banner of its own.
 */
const content = await withContentImages(mustLoad(loadDungeon(gameFiles)));
const look = dungeonLook(content);
let mixer: Mixer | null = null;

void bootBrowserGame({
  screen: look.screen,
  game: content.manifest.id,
  audio: {
    songs: contentSongs(content),
    sfx: contentSfx(content),
    music: DUNGEON_MUSIC,
    mix: look.skin.music,
    seed: content.manifest.start.seed,
  },
  menus: { spec: content.manifest.menus, fonts: look.fonts, sheets: look.sheet },
  displays: {
    canvas2d: (canvas, { onSound, hitPause }) =>
      canvasDisplay(canvas, { ...look, onSound, onHitPause: hitPause }),
  },
  scene: (_stack, display, page) =>
    new DungeonScene(content, look, {
      music: (id) => mixer?.play(id),
      presenter: display.presenter,
      shellEnds: page.endings,
    }),
}).then((booted) => {
  mixer = booted?.mixer ?? null;
});
