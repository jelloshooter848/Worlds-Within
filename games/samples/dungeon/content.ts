import { contentOf, loadContent, type ContentBundle } from '@engine/core/content/bundle';
import {
  kitContentKinds,
  manifestOptions,
  mustLoad as mustLoadContent,
} from '@engine/core/content/game-content';
import type { ContentResult } from '@engine/core/content/validate';
import { mustSkinSet, type SkinFile } from '@engine/core/present';
import { buildDungeon, roomKind, type Dungeon } from '@kits/topdown';
import { kit as topdown } from '@kits/topdown/kit';

/**
 * Glue between the dungeon sample's data files (`game.json` and `content/`) and the engine: the
 * loaded bundle turned into what the scene needs. No content lives here, and nothing another game
 * writes the same way: the kinds are the kit hook's (`kitContentKinds`, as every sample loads
 * them), the songs and sfx the engine's `contentSongs` and `contentSfx`, the skin check the
 * engine's `mustSkinSet` (Engine 0.15 T15, the API review).
 */

const ROOM = roomKind();

/** The song the dungeon plays (`content/songs/crypt.json`), and the one for the way out. */
export const DUNGEON_MUSIC = 'crypt';
export const ESCAPE_MUSIC = 'daylight';

/** The sample's checked content, from `{ path: text }` pairs relative to `games/samples/dungeon`. */
export function loadDungeon(files: Readonly<Record<string, string>>): ContentResult<ContentBundle> {
  return loadContent(files, kitContentKinds([topdown], manifestOptions(files)), {
    root: 'games/samples/dungeon/',
  });
}

/** The dungeon the room files make. */
export function dungeonRooms(content: ContentBundle): Dungeon {
  return buildDungeon(contentOf(content, ROOM).map((e) => e.value));
}

/**
 * The skin the Canvas2D backend draws the dungeon with (`content/skins/canvas2d.json`): every
 * kind, tile, event and HUD value the top-down kit presents, mapped to the sample's sheets and
 * sounds.
 */
export function dungeonSkin(content: ContentBundle): SkinFile {
  return mustSkinSet(content, 'canvas2d', 'the dungeon').main;
}

/** Throws with every error, one per line: the engine's `mustLoad`, naming the sample. */
export function mustLoad(result: ContentResult<ContentBundle>): ContentBundle {
  return mustLoadContent(result, 'the dungeon sample');
}
