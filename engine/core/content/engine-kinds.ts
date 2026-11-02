import { sfxSchema, songSchema } from '../audio/song-schema';
import { paletteSchema } from '../gfx/palette-schema';
import { readSpriteText, spriteSchema, writeSpriteText } from '../gfx/sprite-schema';
import { SKIN_KIND } from '../present/skin';
import { ContentKinds, type ContentKind } from './kinds';

/** An MML song (`audio/song-schema.ts`). */
export const SONG_KIND = {
  name: 'song',
  description: 'An MML song: id, bpm, loop and up to four channels',
  schema: songSchema,
} satisfies ContentKind;

/** An MML sound effect (`audio/song-schema.ts`). */
export const SFX_KIND = {
  name: 'sfx',
  description: 'An MML sound effect: id, optional bpm and up to four voices',
  schema: sfxSchema,
} satisfies ContentKind;

/** A palette (`gfx/palette-schema.ts`). */
export const PALETTE_KIND = {
  name: 'palette',
  description: 'A named list of colours (#rgb or #rrggbb) that sprite indices pick from',
  schema: paletteSchema,
} satisfies ContentKind;

/** Text-grid pixel art (`gfx/sprite-schema.ts`), JSON or `.txt`. */
export const SPRITE_KIND = {
  name: 'sprite',
  description: 'Text-grid pixel art: a palette name, an optional legend and named frames',
  schema: spriteSchema,
  readText: readSpriteText,
  writeText: writeSpriteText,
} satisfies ContentKind;

export { SKIN_KIND };

/**
 * A registry holding the content kinds the engine itself defines: `song`, `sfx`, `palette` (JSON),
 * `sprite` (JSON or text-grid `.txt`) and `skin` (JSON, `present/skin.ts`). Games register their own kinds (rooms, missions) on top.
 */
export function engineContentKinds(): ContentKinds {
  return new ContentKinds()
    .register(SONG_KIND)
    .register(SFX_KIND)
    .register(PALETTE_KIND)
    .register(SPRITE_KIND)
    .register(SKIN_KIND as unknown as ContentKind);
}
