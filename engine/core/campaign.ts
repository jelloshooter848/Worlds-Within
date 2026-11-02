import { z } from 'zod';
import type { ContentLookup, KindIssue } from './content/kinds';

/**
 * Campaigns as plain JSON data (docs/BUILD-LOG.md, Engine 0.10, item 160; gap G2): the order a
 * game's levels or missions are played in, written in a file instead of following their ids.
 *
 *   { "version": 1, "id": "main", "title": "The stacking test",
 *     "entries": [{ "level": "level-1" }, { "level": "level-2" }, { "mission": "raid" }],
 *     "start": "level-1" }
 *
 * Each entry names one level (a kit's `level` file) or one mission (a `*.mission.json` file) by its
 * id; `start` (optional) names the entry played first, the first entry when left out. `validate`
 * checks that every named level and mission is in the game's content ({@link checkCampaigns}). A
 * kit reads the entries it can play: the platformer kit's level sequence plays the `level` entries
 * in this order (`kits/platformer/sequence.ts`). Missions in a campaign are checked only; playing
 * them in order comes with a later release (0.13).
 */

/** A campaign or mission id: lower-case letters, digits and "-". */
const Id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'must be lower-case letters, digits and "-"');

/** One step of a campaign: exactly one of `level` and `mission`. */
export const campaignEntrySchema = z
  .strictObject({
    level: z.string().min(1).exactOptional().describe('a level id (the level file name)'),
    mission: Id.exactOptional().describe('a mission id (the `*.mission.json` file name)'),
  })
  .superRefine((e, ctx) => {
    if ((e.level === undefined) === (e.mission === undefined))
      ctx.addIssue({
        code: 'custom',
        message: 'give exactly one of "level" and "mission"',
        params: { code: 'bad_entry' },
      });
  });

/** A campaign: the `campaign` content kind (`*.campaign.json`). */
export const campaignSchema = z
  .strictObject({
    version: z.literal(1).describe('the campaign format version: 1'),
    id: Id.describe('the campaign id; the same as the file name'),
    title: z.string().min(1).exactOptional().describe('one line naming the campaign'),
    entries: z
      .array(campaignEntrySchema)
      .min(1)
      .describe(
        'the play order: `{ "level": id }` or `{ "mission": id }` each, every named level and mission in the game',
      ),
    start: z
      .string()
      .min(1)
      .exactOptional()
      .describe('the id of the entry played first; the first entry when left out'),
  })
  .superRefine((c, ctx) => {
    const seen = new Set<string>();
    c.entries.forEach((e, i) => {
      const key = entryKey(e);
      if (seen.has(key))
        ctx.addIssue({
          code: 'custom',
          path: ['entries', i, e.level === undefined ? 'mission' : 'level'],
          message: `${entryKind(e)} "${entryId(e)}" is listed twice`,
          params: { code: 'duplicate_entry' },
        });
      seen.add(key);
    });
    if (c.start === undefined) return;
    const matches = c.entries.filter((e) => entryId(e) === c.start);
    if (matches.length === 0)
      ctx.addIssue({
        code: 'custom',
        path: ['start'],
        message: `"${c.start}" is not one of the campaign's entries`,
        params: { code: 'unknown_entry' },
      });
    else if (matches.length > 1)
      ctx.addIssue({
        code: 'custom',
        path: ['start'],
        message: `"${c.start}" names both a level and a mission; give them different ids`,
        params: { code: 'ambiguous_start' },
      });
  });

export type CampaignDef = z.infer<typeof campaignSchema>;
export type CampaignEntry = z.infer<typeof campaignEntrySchema>;

/** What an entry names: `level` or `mission`. */
export function entryKind(entry: CampaignEntry): 'level' | 'mission' {
  return entry.level === undefined ? 'mission' : 'level';
}

/** The id an entry names. */
export function entryId(entry: CampaignEntry): string {
  return entry.level ?? entry.mission ?? '';
}

function entryKey(entry: CampaignEntry): string {
  return `${entryKind(entry)}:${entryId(entry)}`;
}

/**
 * The campaign's entries in play order: from `start` (the first entry when left out), and after
 * the last entry, the ones before `start`, as a sequence that loops round would play them.
 */
export function campaignOrder(campaign: CampaignDef): CampaignEntry[] {
  const at =
    campaign.start === undefined ? 0 : campaign.entries.findIndex((e) => entryId(e) === campaign.start);
  const from = Math.max(at, 0);
  return [...campaign.entries.slice(from), ...campaign.entries.slice(0, from)];
}

/** The ids of the campaign's `level` entries in play order ({@link campaignOrder}). */
export function campaignLevels(campaign: CampaignDef): string[] {
  return campaignOrder(campaign)
    .filter((e) => e.level !== undefined)
    .map(entryId);
}

/**
 * The campaign kind's check across the game's content: every level and mission an entry names must
 * be a `level` or `mission` file of the game (`missing_level`, `missing_mission`, at the entry's
 * field). A game that claims no `level` (or `mission`) kind has none to name.
 */
export function checkCampaigns(
  entries: readonly { name: string; value: CampaignDef }[],
  others: ContentLookup,
): KindIssue[] {
  const names = (kind: string) => new Set(others(kind).map((e) => e.name));
  const known = { level: names('level'), mission: names('mission') };
  const issues: KindIssue[] = [];
  for (const { name, value } of entries) {
    value.entries.forEach((e, i) => {
      const kind = entryKind(e);
      const id = entryId(e);
      if (known[kind].has(id)) return;
      issues.push({
        name,
        path: ['entries', i, kind],
        code: `missing_${kind}`,
        message: `the game has no ${kind} "${id}" (no ${kind} file of that name)`,
      });
    });
  }
  return issues;
}
