import { contentOf, loadContent, type ContentBundle } from '@engine/core/content/bundle';
import { engineContentKinds, SKIN_KIND, SONG_KIND } from '@engine/core/content/engine-kinds';
import { contentSfx, mustLoad as mustLoadContent } from '@engine/core/content/game-content';
import type { ContentKinds } from '@engine/core/content/kinds';
import type { ContentResult } from '@engine/core/content/validate';
import type { Sfx, Song } from '@engine/core/audio/mml';
import type { SkinFile } from '@engine/core/present';
import { buildDungeon, roomKind, type Dungeon } from '@kits/topdown';

/**
 * Glue between the dungeon sample's data files (`game.json` and `content/`) and the engine: the
 * content kinds it uses, and the loaded bundle turned into what the scene needs. No content lives
 * here.
 */

const ROOM = roomKind();

/** The song the dungeon plays (`content/songs/crypt.json`), and the one for the way out. */
export const DUNGEON_MUSIC = 'crypt';
export const ESCAPE_MUSIC = 'daylight';

/** The engine's kinds (song, sprite, palette...) plus the top-down kit's rooms. */
export function dungeonKinds(): ContentKinds {
  return engineContentKinds().register(ROOM);
}

/** The sample's checked content, from `{ path: text }` pairs relative to `games/samples/dungeon`. */
export function loadDungeon(files: Readonly<Record<string, string>>): ContentResult<ContentBundle> {
  return loadContent(files, dungeonKinds(), { root: 'games/samples/dungeon/' });
}

/** The dungeon the room files make. */
export function dungeonRooms(content: ContentBundle): Dungeon {
  return buildDungeon(contentOf(content, ROOM).map((e) => e.value));
}

/** Every song, for the audio manager. */
export function dungeonSongs(content: ContentBundle): Song[] {
  return contentOf(content, SONG_KIND).map((e) => e.value);
}

/** Every sound effect, for the audio manager (the skin's event sounds): the engine's `contentSfx`. */
export function dungeonSfx(content: ContentBundle): Sfx[] {
  return contentSfx(content);
}

/**
 * The skin the Canvas2D backend draws the dungeon with (`content/skins/canvas2d.json`): every
 * kind, tile, event and HUD value the top-down kit presents, mapped to the sample's sheets and
 * sounds.
 */
export function dungeonSkin(content: ContentBundle): SkinFile {
  const skin = contentOf(content, SKIN_KIND).find((e) => e.value.backend === 'canvas2d');
  if (!skin) throw new Error('the dungeon has no canvas2d skin (content/skins/canvas2d.json)');
  return skin.value;
}

/** Throws with every error, one per line: the engine's `mustLoad`, naming the sample. */
export function mustLoad(result: ContentResult<ContentBundle>): ContentBundle {
  return mustLoadContent(result, 'the dungeon sample');
}
