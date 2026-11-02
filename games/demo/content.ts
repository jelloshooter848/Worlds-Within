import { contentOf, loadContent, type ContentBundle } from '@engine/core/content/bundle';
import { engineContentKinds, PALETTE_KIND, SONG_KIND, SPRITE_KIND } from '@engine/core/content/engine-kinds';
import type { ContentKinds } from '@engine/core/content/kinds';
import { formatErrors, type ContentResult } from '@engine/core/content/validate';
import type { Song } from '@engine/core/audio/mml';
import type { PaletteTable } from '@engine/core/gfx/palette';
import type { SpriteDef } from '@engine/core/gfx/pixelart';
import { buildDungeon, DEFAULT_SHEETS, roomKind, type Dungeon, type TdSheets } from '@kits/topdown';

/**
 * Glue between the demo's data files (`game.json` and `content/`) and the engine: the content
 * kinds it uses, and the loaded bundle turned into what the scene needs. No content lives here.
 */

const ROOM = roomKind();

/** The engine's kinds (song, sprite, palette...) plus the top-down kit's rooms. */
export function demoKinds(): ContentKinds {
  return engineContentKinds().register(ROOM);
}

/** The demo's checked content, from `{ path: text }` pairs relative to `games/demo`. */
export function loadDemo(files: Readonly<Record<string, string>>): ContentResult<ContentBundle> {
  return loadContent(files, demoKinds(), { root: 'games/demo/' });
}

/** The dungeon the demo's room files make. */
export function demoDungeon(content: ContentBundle): Dungeon {
  return buildDungeon(contentOf(content, ROOM).map((e) => e.value));
}

/** Every song, for the audio manager. */
export function demoSongs(content: ContentBundle): Song[] {
  return contentOf(content, SONG_KIND).map((e) => e.value);
}

/** Sprite sheets by id (the file name) and palettes by id, for the asset registry. */
export function demoArt(content: ContentBundle): {
  sprites: Record<string, SpriteDef>;
  palettes: PaletteTable;
} {
  const sprites: Record<string, SpriteDef> = {};
  for (const e of contentOf(content, SPRITE_KIND)) sprites[e.name] = e.value;
  const palettes: PaletteTable = {};
  for (const e of contentOf(content, PALETTE_KIND)) palettes[e.value.id] = e.value.colors;
  return { sprites, palettes };
}

/** The sheets the demo draws with: the kit's names, with the hero from `content/sprites/demo-hero.txt`. */
export const DEMO_SHEETS: TdSheets = { ...DEFAULT_SHEETS, hero: 'demo-hero' };

/** Throws with every error, one per line: for entry points, where bad content is a build mistake. */
export function mustLoad(result: ContentResult<ContentBundle>): ContentBundle {
  if (result.ok) return result.value;
  throw new Error(`the demo's content has errors:\n${formatErrors(result.errors)}`);
}
