import { contentOf, loadContent, type ContentBundle } from '@engine/core/content/bundle';
import {
  engineContentKinds,
  PALETTE_KIND,
  SFX_KIND,
  SKIN_KIND,
  SPRITE_KIND,
} from '@engine/core/content/engine-kinds';
import type { ContentKinds } from '@engine/core/content/kinds';
import { formatErrors, type ContentResult } from '@engine/core/content/validate';
import type { Sfx } from '@engine/core/audio/mml';
import type { PaletteTable } from '@engine/core/gfx/palette';
import type { SpriteDef } from '@engine/core/gfx/pixelart';
import type { SkinFile } from '@engine/core/present';
import { levelKind, levelStages, profileKind, type LevelStage } from '@kits/platformer';
import { roomKind, type RoomDef } from '@kits/topdown';

/**
 * Glue between the stacking test's data files (`game.json` and `content/`) and the engine: the
 * content kinds it uses, and the loaded bundle turned into the levels in play order. No content
 * lives here.
 */

const LEVEL = levelKind();
const PROFILE = profileKind();
const ROOM = roomKind();

/**
 * The engine's kinds plus the platformer kit's levels and profiles and the top-down kit's rooms
 * (the door level's mini game; `game.json` lists `topdown` in `uses`).
 */
export function testKinds(): ContentKinds {
  return engineContentKinds().register(LEVEL).register(PROFILE).register(ROOM);
}

/** The game's checked content, from `{ path: text }` pairs relative to `games/platformer-test`. */
export function loadTest(files: Readonly<Record<string, string>>): ContentResult<ContentBundle> {
  return loadContent(files, testKinds(), { root: 'games/platformer-test/' });
}

/** A level and the physics profile it names (the kit's `LevelStage`). */
export type TestStage = LevelStage;

/**
 * The levels in the order they are played: by id with numbers compared as numbers (`level-1`,
 * `level-2`, ..., `level-10`), each with its profile.
 */
export function testStages(content: ContentBundle): TestStage[] {
  const levels = contentOf(content, LEVEL)
    .map((e) => e.value)
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  if (levels.length === 0) throw new Error('the stacking test has no levels');
  const profiles = contentOf(content, PROFILE).map((e) => e.value);
  return levelStages(levels, profiles);
}

/** The top-down rooms (`content/rooms/`), each one a mini game's room, by id. */
export function testRooms(content: ContentBundle): RoomDef[] {
  return contentOf(content, ROOM).map((e) => e.value);
}

/**
 * The skins one backend draws the game with: `level`, the skin named after the backend
 * (`content/skins/canvas2d.json`: the platformer kit's kinds, tiles, events and HUD), and
 * `rounds`, one per mini game, by the mini game's id, from the skins named `<backend>-<id>`
 * (`canvas2d-vault.json`: the top-down kit's, for the door's round). The two kits' tiles and
 * kinds clash (`#`, `.`, `B`, `=`; a camera and HUD of their own), so a round's frames get their
 * own skin (gap G14).
 */
export function testSkins(
  content: ContentBundle,
  backend: string,
): { level: SkinFile; rounds: Record<string, SkinFile> } {
  const skins = contentOf(content, SKIN_KIND).filter((e) => e.value.backend === backend);
  const level = skins.find((e) => e.name === backend);
  if (!level) throw new Error(`the stacking test has no ${backend} skin (content/skins/${backend}.json)`);
  const rounds: Record<string, SkinFile> = {};
  for (const e of skins)
    if (e.name.startsWith(`${backend}-`)) rounds[e.name.slice(backend.length + 1)] = e.value;
  return { level: level.value, rounds };
}

/** Sprite sheets by id (the file name) and palettes by id, for the asset registry. */
export function testArt(content: ContentBundle): {
  sprites: Record<string, SpriteDef>;
  palettes: PaletteTable;
} {
  const sprites: Record<string, SpriteDef> = {};
  for (const e of contentOf(content, SPRITE_KIND)) sprites[e.name] = e.value;
  const palettes: PaletteTable = {};
  for (const e of contentOf(content, PALETTE_KIND)) palettes[e.value.id] = e.value.colors;
  return { sprites, palettes };
}

/** Every sound effect (MML text), for the audio manager: the sounds the skins name. */
export function testSfx(content: ContentBundle): Sfx[] {
  return contentOf(content, SFX_KIND).map((e) => e.value);
}

/** Throws with every error, one per line: for entry points, where bad content is a build mistake. */
export function mustLoad(result: ContentResult<ContentBundle>): ContentBundle {
  if (result.ok) return result.value;
  throw new Error(`the stacking test's content has errors:\n${formatErrors(result.errors)}`);
}
