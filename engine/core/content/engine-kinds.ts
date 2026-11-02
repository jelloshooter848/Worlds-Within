import { sfxSchema, songSchema } from '../audio/song-schema';
import { readSpriteText, spriteSchema } from '../gfx/sprite-schema';
import { ContentKinds } from './kinds';

/**
 * A registry holding the content kinds the engine itself defines: `song`, `sfx` (JSON) and `sprite`
 * (JSON or text-grid `.txt`). Games register their own kinds (rooms, missions) on top.
 */
export function engineContentKinds(): ContentKinds {
  return new ContentKinds()
    .register({
      name: 'song',
      description: 'An MML song: id, bpm, loop and up to four channels',
      schema: songSchema,
    })
    .register({
      name: 'sfx',
      description: 'An MML sound effect: id, optional bpm and up to four voices',
      schema: sfxSchema,
    })
    .register({
      name: 'sprite',
      description: 'Text-grid pixel art: a palette name, an optional legend and named frames',
      schema: spriteSchema,
      readText: readSpriteText,
    });
}
