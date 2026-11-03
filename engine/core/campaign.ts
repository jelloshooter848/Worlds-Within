import { z } from 'zod';
import { carriedRecordSchema, type CarriedRecord } from './carried';
import { ANY_KIND, type ContentLookup, type KindIssue } from './content/kinds';
import type { MissionResolution } from './missions';

/**
 * Campaigns as plain JSON data (docs/BUILD-LOG.md, Engine 0.10, item 160; gap G2; Engine 0.13,
 * decision 6, item 225): the order a game's levels, missions and world scenarios are played in,
 * written in a file instead of following their ids.
 *
 *   { "version": 1, "id": "main", "title": "The siege and the dawn",
 *     "entries": [{ "scenario": "village", "ticks": 400 }, { "mission": "parley" },
 *                 { "scenario": "dawn", "ticks": 300 }],
 *     "start": "village" }
 *
 * Each entry names one level (a kit's `level` file), one mission (a `*.mission.json` file) or, from
 * Engine 0.13, one world scenario (any content file in the `worlds-within/scenario` format, such as
 * an RTS kit `rts-map`) and the world ticks it is played (`ticks`; a game may end it sooner by its
 * own win or loss); `start` (optional) names the entry played first, the first entry when left out.
 * `validate` checks that every named level, mission and scenario is in the game's content, and that
 * a scenario that starts from another's results (its `from`) follows that scenario's entry
 * ({@link checkCampaigns}).
 *
 * **Played in order** (Engine 0.13, closing the 0.10 leftover "campaign missions are checked, not
 * played in order"): a campaign run's state is its save, {@link CampaignSave}, plain JSON: the
 * position (the entry being played, in {@link campaignOrder}), the carried record a later scenario
 * starts from, and the committed results of every finished entry. {@link campaignRun} reads it and
 * {@link advanceCampaign} moves it on by one finished entry; both are pure, so the same save and
 * results always give the same next save. A mission entry right after a scenario entry is opened by
 * the game's glue on that scenario's end world; a mission entry with no scenario before it keeps its
 * 0.10 meaning (played by the kit that plays it). The platformer kit's level sequence still plays the
 * `level` entries in this order (`kits/platformer/sequence.ts`). A save is kept in browser storage
 * by `save/campaign-store.ts` and packed into a save code by `campaign-code.ts`.
 */

/** A campaign or mission id: lower-case letters, digits and "-". */
const Id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'must be lower-case letters, digits and "-"');

/** The kinds of entry a campaign has, in the order their fields are named. */
export const CAMPAIGN_ENTRY_KINDS = ['level', 'mission', 'scenario'] as const;
export type CampaignEntryKind = (typeof CAMPAIGN_ENTRY_KINDS)[number];

/** The `format` of a world scenario file (`engine/sim/scenario.ts`): a campaign's scenario entries name one. */
export const SCENARIO_FORMAT = 'worlds-within/scenario';

/** One step of a campaign: exactly one of `level`, `mission` and `scenario` (with `ticks`). */
export const campaignEntrySchema = z
  .strictObject({
    level: z.string().min(1).exactOptional().describe('a level id (the level file name)'),
    mission: Id.exactOptional().describe('a mission id (the `*.mission.json` file name)'),
    scenario: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'must be a letter followed by letters, digits, _ or -')
      .exactOptional()
      .describe(
        'a world scenario id (Engine 0.13): the file name of a content file in the `worlds-within/scenario` format',
      ),
    ticks: z
      .int()
      .min(1)
      .exactOptional()
      .describe('with `scenario` only (and required there): how many world ticks the scenario is played'),
    title: z
      .string()
      .min(1)
      .exactOptional()
      .describe("one line naming the entry for a page (Engine 0.13 T8), e.g. a scenario's name"),
  })
  .superRefine((e, ctx) => {
    const named = CAMPAIGN_ENTRY_KINDS.filter((k) => e[k] !== undefined);
    if (named.length !== 1)
      ctx.addIssue({
        code: 'custom',
        message: 'give exactly one of "level", "mission" and "scenario"',
        params: { code: 'bad_entry' },
      });
    else if ((e.scenario === undefined) !== (e.ticks === undefined))
      ctx.addIssue({
        code: 'custom',
        path: ['ticks'],
        message:
          e.scenario === undefined
            ? '"ticks" goes with a "scenario" entry only'
            : 'a "scenario" entry needs "ticks", the world ticks it is played',
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
        'the play order: `{ "level": id }`, `{ "mission": id }` or `{ "scenario": id, "ticks": n }` each, every named level, mission and scenario in the game',
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
          path: ['entries', i, entryKind(e)],
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
        message: `"${c.start}" names entries of two kinds; give them different ids`,
        params: { code: 'ambiguous_start' },
      });
  });

export type CampaignDef = z.infer<typeof campaignSchema>;
export type CampaignEntry = z.infer<typeof campaignEntrySchema>;

/** What an entry names: `level`, `mission` or `scenario`. */
export function entryKind(entry: CampaignEntry): CampaignEntryKind {
  return entry.level !== undefined ? 'level' : entry.mission !== undefined ? 'mission' : 'scenario';
}

/** The id an entry names. */
export function entryId(entry: CampaignEntry): string {
  return entry.level ?? entry.mission ?? entry.scenario ?? '';
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

/** A world scenario's content entry as a campaign reads it: its `from.scenario`, when it has one. */
export interface CampaignScenario {
  name: string;
  /** The scenario it starts from (its `from.scenario`), or null. */
  from: string | null;
}

/**
 * The game's world scenarios among its content entries: every entry (of any kind) whose value is
 * in the `worlds-within/scenario` format, by name, with the scenario its `from` names.
 */
export function campaignScenarios(entries: readonly { name: string; value: unknown }[]): CampaignScenario[] {
  const out: CampaignScenario[] = [];
  for (const { name, value } of entries) {
    if (value === null || typeof value !== 'object') continue;
    const v = value as { format?: unknown; from?: unknown };
    if (v.format !== SCENARIO_FORMAT) continue;
    const from = v.from as { scenario?: unknown } | undefined;
    out.push({ name, from: typeof from?.scenario === 'string' ? from.scenario : null });
  }
  return out;
}

/**
 * The campaign kind's check across the game's content: every level, mission and scenario an entry
 * names must be a `level` or `mission` file or a world scenario of the game (`missing_level`,
 * `missing_mission`, `missing_scenario`, at the entry's field). A game that claims no `level` (or
 * `mission`) kind has none to name. Engine 0.13: a scenario entry whose scenario starts from
 * another's results (`from`) and is not the first scenario entry in play order must name, in
 * `from.scenario`, the scenario entry just before it (`bad_from`, at the entry's `scenario`).
 */
export function checkCampaigns(
  entries: readonly { name: string; value: CampaignDef }[],
  others: ContentLookup,
): KindIssue[] {
  const names = (kind: string) => new Set(others(kind).map((e) => e.name));
  const scenarios = new Map(campaignScenarios(others(ANY_KIND)).map((s) => [s.name, s]));
  const known = { level: names('level'), mission: names('mission'), scenario: new Set(scenarios.keys()) };
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
        message: `the game has no ${kind} "${id}" (no ${kind === 'scenario' ? 'world scenario file' : `${kind} file`} of that name)`,
      });
    });
    let before: string | null = null;
    for (const e of campaignOrder(value)) {
      if (e.scenario === undefined) continue;
      const from = scenarios.get(e.scenario)?.from ?? null;
      if (before !== null && from !== null && from !== before)
        issues.push({
          name,
          path: ['entries', value.entries.indexOf(e), 'scenario'],
          code: 'bad_from',
          message: `scenario "${e.scenario}" starts from "${from}", but the scenario entry before it is "${before}"`,
        });
      before = e.scenario;
    }
  }
  return issues;
}

/** The `format` every campaign save carries. */
export const CAMPAIGN_SAVE_FORMAT = 'worlds-within/campaign-save';
/** The campaign save version this engine reads. */
export const CAMPAIGN_SAVE_VERSION = 1;
/** How a committed mission was resolved (`MissionResolution` in `missions.ts`), in save-code order. */
export const CAMPAIGN_RESOLUTIONS = [
  'played',
  'delegated',
  'quit',
  'timeout',
] as const satisfies readonly MissionResolution[];

/** One committed mission in a campaign save: which, the outcome it committed and how it was resolved. */
export const campaignMissionResultSchema = z.strictObject({
  mission: Id.describe('the mission id'),
  outcome: z.string().min(1).describe("the committed outcome's id (one the mission file declares)"),
  resolution: z
    .enum(CAMPAIGN_RESOLUTIONS)
    .describe('how it was resolved: played, delegated, quit or timeout'),
});
export type CampaignMissionResult = z.infer<typeof campaignMissionResultSchema>;

/**
 * A campaign save (Engine 0.13, decision 6, item 225): where a campaign run is and what it carries,
 * never a whole world. `results` holds one entry per finished entry, in play order (`entry` is its
 * index in {@link campaignOrder}, 0 to `position - 1`), each with the missions committed while it
 * was played, in commit order.
 */
export const campaignSaveSchema = z
  .strictObject({
    format: z.literal(CAMPAIGN_SAVE_FORMAT).describe('always `worlds-within/campaign-save`'),
    version: z.literal(CAMPAIGN_SAVE_VERSION).describe('the campaign save version'),
    game: z.string().min(1).describe("the game's id (`id` in `game.json`)"),
    campaign: Id.describe('the campaign id'),
    seed: z.int().describe("the run's seed"),
    position: z
      .int()
      .min(0)
      .describe(
        'the entry played now: its index in play order (the number of entries finished); past the last: done',
      ),
    carried: carriedRecordSchema
      .nullable()
      .describe('the carried record the next scenario entry starts from (`engine/sim/carry.ts`), or null'),
    results: z
      .array(
        z.strictObject({
          entry: z.int().min(0).describe('the finished entry: its index in play order'),
          missions: z
            .array(campaignMissionResultSchema)
            .describe('the missions committed while it was played'),
        }),
      )
      .describe('one per finished entry, in play order'),
  })
  .superRefine((save, ctx) => {
    if (save.results.length !== save.position)
      ctx.addIssue({
        code: 'custom',
        path: ['results'],
        message: `has ${save.results.length} entries, but ${save.position} entries are finished (position)`,
      });
    save.results.forEach((r, i) => {
      if (r.entry !== i)
        ctx.addIssue({
          code: 'custom',
          path: ['results', i, 'entry'],
          message: `must be ${i}, in play order`,
        });
    });
  });
export type CampaignSave = z.infer<typeof campaignSaveSchema>;

/** A new campaign save: at the first entry, nothing carried, nothing committed. */
export function newCampaignSave(opts: { game: string; campaign: string; seed: number }): CampaignSave {
  return {
    format: CAMPAIGN_SAVE_FORMAT,
    version: CAMPAIGN_SAVE_VERSION,
    game: opts.game,
    campaign: opts.campaign,
    seed: opts.seed,
    position: 0,
    carried: null,
    results: [],
  };
}

/**
 * A campaign save at the entry `entry` names (its id, the first entry in play order with it), as a
 * run file's `start: { entry }` asks (Engine 0.14, gap G9, decision 6): that entry fresh, with no
 * carried record, and every entry before it finished with nothing committed. Null when the
 * campaign has no entry with that id.
 */
export function campaignSaveAt(
  campaign: CampaignDef,
  opts: { game: string; seed: number },
  entry: string,
): CampaignSave | null {
  const position = campaignOrder(campaign).findIndex((e) => entryId(e) === entry);
  if (position < 0) return null;
  return {
    ...newCampaignSave({ game: opts.game, campaign: campaign.id, seed: opts.seed }),
    position,
    results: Array.from({ length: position }, (_, i) => ({ entry: i, missions: [] })),
  };
}

/** Where a campaign run is: what {@link campaignRun} reads from a save. */
export interface CampaignRunState {
  /** The entries in play order ({@link campaignOrder}). */
  order: CampaignEntry[];
  /** The entry played now (its index in `order`). */
  position: number;
  /** The entry played now, or null when the campaign is done. */
  entry: CampaignEntry | null;
  done: boolean;
  /**
   * The scenario entry the glue builds the world from for the entry played now: the entry itself
   * for a scenario entry, else the nearest scenario entry before it (a mission entry right after a
   * scenario is opened on that scenario's end world), or null when there is none.
   */
  scenario: string | null;
  /** The next scenario entry at or after `position` (the one `carried` is for), or null. */
  nextScenario: string | null;
  carried: CarriedRecord | null;
}

/** The nearest scenario entry before `position` in `order`, or null. */
function scenarioBefore(order: readonly CampaignEntry[], position: number): string | null {
  for (let i = Math.min(position, order.length) - 1; i >= 0; i--) {
    const s = order[i]?.scenario;
    if (s !== undefined) return s;
  }
  return null;
}

/** The first scenario entry at or after `position` in `order`, or null. */
export function scenarioFrom(order: readonly CampaignEntry[], position: number): string | null {
  for (let i = position; i < order.length; i++) {
    const s = order[i]?.scenario;
    if (s !== undefined) return s;
  }
  return null;
}

/**
 * A campaign run at its save (a new one at the first entry when `save` is left out): the entry
 * played now and what the glue builds it from. Pure: it reads the save and never changes it.
 */
export function campaignRun(campaign: CampaignDef, save?: CampaignSave): CampaignRunState {
  const order = campaignOrder(campaign);
  const position = save?.position ?? 0;
  const entry = order[position] ?? null;
  return {
    order,
    position,
    entry,
    done: entry === null,
    scenario: entry?.scenario ?? scenarioBefore(order, position),
    nextScenario: scenarioFrom(order, position),
    carried: save?.carried ?? null,
  };
}

/**
 * What one finished entry gives: the missions committed while it was played (commit order) and,
 * for a scenario entry (or a mission entry played on a scenario's end world), the carried record
 * built from the end world for the next scenario entry: `null` when it carries nothing, left out to
 * keep the save's.
 */
export interface CampaignEntryResult {
  missions?: readonly CampaignMissionResult[];
  carried?: CarriedRecord | null;
}

/** Why {@link advanceCampaign} refused. */
export type CampaignRefusalCode = 'wrong_campaign' | 'campaign_done' | 'bad_result';

export type CampaignAdvance =
  { ok: true; save: CampaignSave } | { ok: false; code: CampaignRefusalCode; error: string };

/**
 * The save after the entry played now finishes with `result` (Engine 0.13, decision 6): position
 * + 1, the entry's results appended, `carried` replaced when the result gives one. The rules: a
 * `mission` entry commits exactly its own mission (and may rebuild `carried`, as it was played on
 * the scenario's end world); a `level` entry commits no mission and carries nothing; a `scenario`
 * entry commits any missions its world offered. A refusal (`wrong_campaign`: the save is another
 * campaign's; `campaign_done`: past the last entry; `bad_result`) changes nothing. Pure.
 */
export function advanceCampaign(
  campaign: CampaignDef,
  save: CampaignSave,
  result: CampaignEntryResult = {},
): CampaignAdvance {
  if (save.campaign !== campaign.id)
    return {
      ok: false,
      code: 'wrong_campaign',
      error: `the save is campaign "${save.campaign}"'s, not "${campaign.id}"'s`,
    };
  const run = campaignRun(campaign, save);
  if (run.entry === null)
    return {
      ok: false,
      code: 'campaign_done',
      error: `campaign "${campaign.id}" is done: all ${run.order.length} entries are finished`,
    };
  const missions = [...(result.missions ?? [])].map((m) => campaignMissionResultSchema.parse(m));
  const kind = entryKind(run.entry);
  const id = entryId(run.entry);
  const bad = (error: string): CampaignAdvance => ({ ok: false, code: 'bad_result', error });
  if (kind === 'level' && (missions.length > 0 || result.carried !== undefined))
    return bad(`level "${id}" commits no missions and carries nothing`);
  if (kind === 'mission' && (missions.length !== 1 || missions[0]?.mission !== id))
    return bad(`mission entry "${id}" commits exactly one mission, "${id}"`);
  let carried = save.carried;
  if (result.carried !== undefined) {
    const parsed = carriedRecordSchema.nullable().safeParse(result.carried);
    if (!parsed.success) return bad(`carried: ${parsed.error.issues[0]?.message ?? 'not a carried record'}`);
    carried = parsed.data;
  }
  return {
    ok: true,
    save: {
      ...save,
      position: save.position + 1,
      carried,
      results: [...save.results, { entry: save.position, missions }],
    },
  };
}
