import { sfxSchema, songSchema } from '../audio/song-schema';
import { paletteSchema } from '../gfx/palette-schema';
import { readSpriteText, spriteSchema, writeSpriteText } from '../gfx/sprite-schema';
import { campaignSchema, checkCampaigns, checkMissionCodes } from '../campaign';
import { missionSchema } from '../missions';
import { SKIN_KIND } from '../present/skin';
import { FONT_KIND } from '../ui/font';
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

/**
 * A mission definition (`missions.ts`), `*.mission.json`: Engine 0.10, item 153. Its `checkAll`
 * (Engine 0.15, gap M38) refuses two missions whose ids share a save code id (`code_collision`).
 */
export const MISSION_KIND = {
  name: 'mission',
  description:
    'A mission: its event, fixed world-time cost, the mini game it is played with, its params and its declared outcomes with delegation weights and effects',
  schema: missionSchema,
  checkAll: checkMissionCodes,
} satisfies ContentKind;

/**
 * A campaign (`campaign.ts`), `*.campaign.json`: the order a game's levels, missions and (Engine
 * 0.13) world scenarios are played in (Engine 0.10, item 160, gap G2). Its `checkAll` checks every
 * named level, mission and scenario exists and each follow-up scenario follows its `from`.
 */
export const CAMPAIGN_KIND = {
  name: 'campaign',
  description:
    'A campaign: the order a game plays its levels, missions and world scenarios in, as a list of level, mission and scenario ids (a scenario with the ticks it is played), with an optional entry to start at',
  schema: campaignSchema,
  checkAll: checkCampaigns,
} satisfies ContentKind<typeof campaignSchema>;

export { FONT_KIND, SKIN_KIND };

/**
 * A registry holding the content kinds the engine itself defines: `song`, `sfx`, `palette` (JSON),
 * `sprite` (JSON or text-grid `.txt`), `font` (JSON or `.txt`, Engine 0.16, `ui/font.ts`), `skin` (JSON, `present/skin.ts`), `mission` (JSON,
 * `missions.ts`) and `campaign` (JSON, `campaign.ts`). Games and kits register their own kinds (rooms, levels) on top.
 */
export function engineContentKinds(): ContentKinds {
  return new ContentKinds()
    .register(SONG_KIND)
    .register(SFX_KIND)
    .register(PALETTE_KIND)
    .register(SPRITE_KIND)
    .register(FONT_KIND)
    .register(SKIN_KIND as unknown as ContentKind)
    .register(MISSION_KIND)
    .register(CAMPAIGN_KIND as unknown as ContentKind);
}
