import { contentOf, loadContent, type ContentBundle } from '@engine/core/content/bundle';
import { kitContentKinds } from '@engine/core/content/game-content';
import type { ContentResult } from '@engine/core/content/validate';
import { skinSet, type SkinFile } from '@engine/core/present';
import { contentStages, type LevelStage } from '@kits/platformer';
import { kit as platformer } from '@kits/platformer/kit';
import { roomKind, type RoomDef } from '@kits/topdown';
import { kit as topdown } from '@kits/topdown/kit';

/**
 * Glue between the stacking test's data files (`game.json` and `content/`) and the engine: which
 * kits' content it reads, and the loaded bundle as the levels in play order, the rooms and the
 * skins. No content lives here, and nothing another game would write the same way: the kinds,
 * art, sounds and `mustLoad` are the engine's (`@engine/core/content/game-content`), the level
 * order the campaign file's, played by the platformer kit's `contentStages` (gaps G2 and G4, fixed
 * in 0.7 T9 and 0.10).
 */

const ROOM = roomKind();

/** The game's checked content, from `{ path: text }` pairs relative to `games/samples/platformer`. */
export function loadTest(files: Readonly<Record<string, string>>): ContentResult<ContentBundle> {
  // The kits of `game.json`: `kit` (platformer), then `uses` (topdown, for the door's room).
  return loadContent(files, kitContentKinds([platformer, topdown]), { root: 'games/samples/platformer/' });
}

/**
 * The levels in the order they are played: the order of the campaign file
 * (`content/campaigns/main.campaign.json`; without one, by id with numbers compared as numbers),
 * each with the profile it names: the kit's `contentStages`.
 */
export function testStages(content: ContentBundle): LevelStage[] {
  return contentStages(content, { who: 'the stacking test' });
}

/** The top-down rooms (`content/rooms/`), each one a mini game's room, by id. */
export function testRooms(content: ContentBundle): RoomDef[] {
  return contentOf(content, ROOM).map((e) => e.value);
}

/**
 * The skins one backend draws the game with (the engine's `skinSet`, gap G32): `level`, the skin
 * named after the backend (`content/skins/canvas2d.json`, `three.json`), and `rounds`, one per mini
 * game by its id, from `<backend>-<id>.json` (`canvas2d-vault.json`, `three-vault.json`). The two
 * kits' tiles and kinds clash, so a round's frames get their own skin (gap G14). Throws when the
 * backend has no skin.
 */
export function testSkins(
  content: ContentBundle,
  backend: string,
): { level: SkinFile; rounds: Record<string, SkinFile> } {
  const { main, rounds } = skinSet(content, backend);
  if (!main) throw new Error(`the stacking test has no ${backend} skin (content/skins/${backend}.json)`);
  return { level: main, rounds };
}
