import { z } from 'zod';
import { MmlError, parseMml, type Sfx, type Song } from './mml';

/**
 * Schemas for song and sound-effect files (JSON with the {@link Song} / {@link Sfx} shape). Beyond
 * the shape, every channel must compile: an MML mistake is reported on that channel's field, with
 * the position in the string.
 */

type ChannelKind = 'pulse' | 'triangle' | 'noise';

/** Adds an `invalid_mml` issue on each channel whose MML does not compile. */
function checkChannels(
  value: Readonly<Record<string, unknown>>,
  channels: readonly (readonly [string, ChannelKind])[],
  ctx: z.RefinementCtx,
): void {
  const present = channels.filter(([c]) => typeof value[c] === 'string');
  if (present.length === 0) {
    ctx.addIssue({
      code: 'custom',
      message: `needs at least one channel (${channels.map(([c]) => c).join(', ')})`,
      path: [],
      params: { code: 'no_channels' },
    });
  }
  for (const [channel, kind] of present) {
    try {
      parseMml(value[channel] as string, kind);
    } catch (e) {
      if (!(e instanceof MmlError)) throw e;
      ctx.addIssue({
        code: 'custom',
        message: `MML does not compile: ${e.message}`,
        path: [channel],
        params: { code: 'invalid_mml', col: e.pos },
      });
    }
  }
}

const mml = z.string().exactOptional();
const bpm = z.number().positive().max(1000);

// Channel name -> the kind it compiles as. Written as pairs, not an object literal, so the content
// check (tests/architecture/no-content.test.ts) does not mistake the table for a song.
const SONG_CHANNELS: readonly (readonly [string, ChannelKind])[] = [
  ['pulse1', 'pulse'],
  ['pulse2', 'pulse'],
  ['triangle', 'triangle'],
  ['noise', 'noise'],
];

const SFX_CHANNELS: readonly (readonly [string, ChannelKind])[] = [
  ['pulse', 'pulse'],
  ['pulse2', 'pulse'],
  ['triangle', 'triangle'],
  ['noise', 'noise'],
];

/** A song file: id, tempo, loop flag and up to four MML channels, each of which must compile. */
export const songSchema: z.ZodType<Song> = z
  .strictObject({
    id: z.string().min(1),
    bpm,
    loop: z.boolean(),
    pulse1: mml,
    pulse2: mml,
    triangle: mml,
    noise: mml,
  })
  .superRefine((v, ctx) => checkChannels(v, SONG_CHANNELS, ctx));

/** A sound-effect file: id, optional tempo and up to four MML voices, each of which must compile. */
export const sfxSchema: z.ZodType<Sfx> = z
  .strictObject({
    id: z.string().min(1),
    bpm: bpm.exactOptional(),
    pulse: mml,
    pulse2: mml,
    triangle: mml,
    noise: mml,
  })
  .superRefine((v, ctx) => checkChannels(v, SFX_CHANNELS, ctx));
