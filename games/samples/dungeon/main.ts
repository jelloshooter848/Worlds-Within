import type { AudioManager } from '@engine/core/audio/audio-manager';
import { canvasDisplay } from '@engine/backends/canvas2d';
import { bootBrowserGame } from '@engine/core/shell';
import { contentFonts } from '@engine/core/ui';
import { contentSfx, contentSongs } from '@engine/core/content/game-content';
import { DUNGEON_MUSIC, loadDungeon, mustLoad } from './content';
import { dungeonLook } from './picture';
import { DungeonScene } from './scene';
import gameFiles from 'virtual:game-files';

/**
 * Boots the dungeon sample in the browser with the engine's `bootBrowserGame`: keyboard,
 * gamepad, the touch pad, the scene stack, the fixed loop, the Canvas2D display (or the PixiJS
 * one with `?backend=pixi`, imported only then, falling back to Canvas2D without WebGL), audio
 * with the sample's songs and sfx (the `crypt` song starts on the first key, tap or click), the
 * shell's volume control (stored under `ww:dungeon:volumes`, gap M1) and the step hook with
 * `?debug=step`. The scene draws through its `DungeonPicture` with the display's presenter, which
 * plays the skin's sounds through the shell's `onSound`.
 */
const content = mustLoad(loadDungeon(gameFiles));
const look = dungeonLook(content);
const fonts = contentFonts(content);
let audio: AudioManager | null = null;

void bootBrowserGame({
  screen: look.screen,
  game: content.manifest.id,
  audio: { songs: contentSongs(content), sfx: contentSfx(content), music: DUNGEON_MUSIC },
  menus: { spec: content.manifest.menus, fonts, sheets: look.sheet },
  displays: {
    canvas2d: (canvas, { onSound }) => canvasDisplay(canvas, { ...look, fonts, onSound }),
    pixi: async (canvas, { onSound }) =>
      (await import('@engine/backends/pixi')).pixiDisplay(canvas, { ...look, fonts, onSound }),
  },
  scene: (_stack, display) =>
    new DungeonScene(content, look, { presenter: display.presenter, music: (id) => audio?.playMusic(id) }),
}).then((booted) => {
  audio = booted?.audio ?? null;
});
