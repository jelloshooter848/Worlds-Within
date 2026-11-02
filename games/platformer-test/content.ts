import { contentOf, loadContent, type ContentBundle } from '@engine/core/content/bundle';
import { engineContentKinds } from '@engine/core/content/engine-kinds';
import type { ContentKinds } from '@engine/core/content/kinds';
import { formatErrors, type ContentResult } from '@engine/core/content/validate';
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

/** Throws with every error, one per line: for entry points, where bad content is a build mistake. */
export function mustLoad(result: ContentResult<ContentBundle>): ContentBundle {
  if (result.ok) return result.value;
  throw new Error(`the stacking test's content has errors:\n${formatErrors(result.errors)}`);
}
