import {
  CAMPAIGN_RESOLUTIONS,
  CAMPAIGN_SAVE_FORMAT,
  CAMPAIGN_SAVE_VERSION,
  campaignOrder,
  campaignSaveSchema,
  SAVE_CODE_ID_BITS,
  saveCodeId,
  scenarioFrom,
  SCENARIO_FORMAT,
  type CampaignDef,
  type CampaignMissionResult,
  type CampaignSave,
} from './campaign';
import {
  CARRIED_FATES,
  CARRIED_FORMAT,
  CARRIED_VERSION,
  carriedRecordSchema,
  carryFromSchema,
  type CarriedPerson,
  type CarriedRecord,
  type CarryFrom,
} from './carried';
import type { ContentBundle } from './content/bundle';

/**
 * Save codes (Engine 0.13, decision 7, item 226; SMBC's lesson, `docs/SAVE_CODES.md` in the SMBC
 * REMIX source): **the code is the save**. A campaign save (`campaign.ts`, {@link CampaignSave})
 * packed into a short text a player can write down, with no server and no account:
 *
 *   const ctx = saveCodeContext(content);            // the game's campaigns, missions, scenarios
 *   const packed = encodeSaveCode(save, ctx);         // { ok: true, code: "1Q2W3-E4R5T-..." }
 *   const back = decodeSaveCode(packed.code, ctx);    // { ok: true, save } equal to `save`
 *
 * Bits, in order: the code version (4 bits), a CRC-16/CCITT (polynomial 0x1021, start 0xFFFF) over
 * every bit after it, then the campaign (its index in the game's campaigns sorted by id), the
 * position, the seed (zig-zag), the carried record (1 bit: present; then its tick and, in the carry
 * spec's order, each person's fate in 3 bits, `by` as an index into the two scenarios' factions,
 * `at`, `hp` and `max`, and each stockpile item; key names are never written, the spec of the next
 * scenario entry gives them), and the committed results (per finished entry, the number of missions
 * and per mission its index in the game's missions sorted by id, the outcome's index in the mission
 * file and the resolution in 2 bits), then zero bits to a whole character. Every number is a
 * variable-length integer: groups of 4 bits, low group first, each after a "more" bit; a value
 * that may be null is written plus one (0: null).
 *
 * **Version 2** (Engine 0.15 T8, gap M38; docs/BUILD-LOG.md, Engine 0.15, decision 9), what this
 * build writes: the campaign and each mission are written as their **stable id code**
 * (`saveCodeId` in `campaign.ts`: 12 bits of a CRC-16 of the id) instead of their index in a sorted
 * list, so a mission file added later (whatever its id) moves no code; after the seed one bit says
 * the campaign `ended` on its entry's `endIf` (gap M31; the reason is read back from the campaign
 * file). Outcomes stay indexes in the mission file's own order (an outcome appended moves nothing).
 * Version 1 codes (the layout above) are still read, against the content they were written for;
 * `encodeSaveCode(save, ctx, { version: 1 })` still writes one (not for a save with `ended`). Two
 * ids of one kind sharing a code are refused by `validate` (`code_collision`) and by encoding.
 *
 * Text: Crockford Base32 (`0-9 A-Z` without I, L, O, U), 5 bits a character, in groups of five
 * joined by dashes. Input ignores case, dashes and spaces and reads O as 0 and I and L as 1.
 *
 * Refusals (`{ ok: false, code, error }`, nothing changed): `code_empty`, `code_typo` (a character
 * outside the alphabet or a checksum that does not match: a tampered code is a typo), `code_newer`
 * (a version above this build's), `code_layout` (too short, bits left over, or a field out of
 * range), `code_campaign` (no such campaign in the game), `code_position` (past the campaign's end)
 * and `code_record` (the carried part does not fit the next scenario's carry spec), and on encoding
 * `code_collision` (two ids of one kind share a save code id). Integers only,
 * so a code is the same on every machine. Pure (on `PURE_CORE`).
 */

/**
 * The save code version this build writes and the newest it reads (Engine 0.15 T8, gap M38: 2,
 * stable id codes; version 1 codes, campaigns and missions by sorted index, are still read).
 */
export const SAVE_CODE_VERSION = 2;

/** The save code versions this build can write (`encodeSaveCode`'s `version`) and read. */
export const SAVE_CODE_VERSIONS = [1, 2] as const;
export type SaveCodeVersion = (typeof SAVE_CODE_VERSIONS)[number];

/** Crockford Base32: 32 characters, 5 bits each. */
export const SAVE_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Characters a code is shown in, per group between dashes. */
export const SAVE_CODE_GROUP = 5;

/** Why a code was refused. */
export type SaveCodeRefusalCode =
  | 'code_empty'
  | 'code_typo'
  | 'code_newer'
  | 'code_layout'
  | 'code_campaign'
  | 'code_position'
  | 'code_record'
  | 'code_collision';

export type SaveCodeRefusal = { ok: false; code: SaveCodeRefusalCode; error: string };

/** A world scenario as a save code reads it: its carry spec (`from`, or null) and its factions. */
export interface SaveCodeScenario {
  name: string;
  from: CarryFrom | null;
  /** Every faction id named in its components (`Owner`, `Stockpile`), sorted. */
  factions: readonly string[];
}

/** What a code is read against: a game's campaigns, missions and scenarios, all plain data. */
export interface SaveCodeContext {
  game: string;
  campaigns: readonly CampaignDef[];
  missions: readonly { id: string; outcomes: readonly { id: string }[] }[];
  scenarios: readonly SaveCodeScenario[];
}

const byId = <T extends { id: string }>(list: readonly T[]): T[] =>
  [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** The faction ids named by `Owner` and `Stockpile` components in a scenario's data, sorted. */
function scenarioFactions(value: unknown): string[] {
  const found = new Set<string>();
  const read = (components: unknown) => {
    if (components === null || typeof components !== 'object') return;
    for (const name of ['Owner', 'Stockpile']) {
      const c = (components as Record<string, unknown>)[name] as { faction?: unknown } | undefined;
      if (typeof c?.faction === 'string') found.add(c.faction);
    }
  };
  const v = value as { entities?: unknown; squads?: unknown };
  for (const e of Array.isArray(v.entities) ? v.entities : [])
    read((e as { components?: unknown }).components);
  for (const s of Array.isArray(v.squads) ? v.squads : []) {
    read((s as { components?: unknown }).components);
    const members = (s as { members?: unknown }).members;
    for (const m of Array.isArray(members) ? members : []) read((m as { components?: unknown }).components);
  }
  return [...found].sort();
}

/**
 * A game's save code context from its checked content: `id` in `game.json`, its `campaign` and
 * `mission` entries, and every content entry in the `worlds-within/scenario` format (any kind),
 * with its `from` (when it parses) and its factions.
 */
export function saveCodeContext(content: ContentBundle): SaveCodeContext {
  const scenarios: SaveCodeScenario[] = [];
  for (const e of content.entries) {
    const v = e.value as { format?: unknown; from?: unknown } | null;
    if (v === null || typeof v !== 'object' || v.format !== SCENARIO_FORMAT) continue;
    const from = v.from === undefined ? null : carryFromSchema.safeParse(v.from);
    scenarios.push({
      name: e.name,
      from: from?.success ? from.data : null,
      factions: scenarioFactions(v),
    });
  }
  return {
    game: content.manifest.id,
    campaigns: content.entries.filter((e) => e.kind === 'campaign').map((e) => e.value as CampaignDef),
    missions: content.entries
      .filter((e) => e.kind === 'mission')
      .map((e) => e.value as { id: string; outcomes: { id: string }[] }),
    scenarios,
  };
}

/** The carry spec the save's `carried` must fit at `position`: the next scenario entry's `from`. */
function carrySpecAt(
  campaign: CampaignDef,
  position: number,
  ctx: SaveCodeContext,
): { from: CarryFrom; factions: string[] } | null {
  const next = scenarioFrom(campaignOrder(campaign), position);
  const sc = next === null ? undefined : ctx.scenarios.find((s) => s.name === next);
  if (sc?.from === null || sc === undefined) return null;
  const first = ctx.scenarios.find((s) => s.name === sc.from?.scenario);
  const factions = [...new Set([...sc.factions, ...(first?.factions ?? [])])].sort();
  return { from: sc.from, factions };
}

/** Why `record` does not fit `from` (the people, factions and items it names), or null. */
export function carriedMismatch(record: CarriedRecord, from: CarryFrom): string | null {
  if (record.from !== from.scenario)
    return `the carried record is from "${record.from}", the next scenario starts from "${from.scenario}"`;
  const people = Object.keys(record.people).sort();
  const want = [...from.carry.people].sort();
  if (people.join() !== want.join())
    return `the carried record holds people ${JSON.stringify(people)}, the carry spec ${JSON.stringify(want)}`;
  const factions = Object.keys(record.stockpiles).sort();
  const wantFactions = from.carry.stockpiles.map((s) => s.faction).sort();
  if (factions.join() !== wantFactions.join())
    return `the carried record holds stockpiles ${JSON.stringify(factions)}, the carry spec ${JSON.stringify(wantFactions)}`;
  for (const s of from.carry.stockpiles) {
    const items = Object.keys(record.stockpiles[s.faction] ?? {}).sort();
    if (items.join() !== [...s.items].sort().join())
      return `the carried "${s.faction}" stockpile holds items ${JSON.stringify(items)}, the carry spec ${JSON.stringify(s.items)}`;
  }
  return null;
}

/** Bits, most significant first, with the variable-length integers the format uses. */
class BitWriter {
  readonly bits: number[] = [];

  fixed(value: number, width: number): void {
    for (let i = width - 1; i >= 0; i--) this.bits.push(Math.floor(value / 2 ** i) % 2);
  }

  uint(value: number): void {
    let v = value;
    do {
      const group = v % 16;
      v = Math.floor(v / 16);
      this.bits.push(v > 0 ? 1 : 0);
      this.fixed(group, 4);
    } while (v > 0);
  }

  nullable(value: number | null): void {
    this.uint(value === null ? 0 : value + 1);
  }

  int(value: number): void {
    this.uint(value >= 0 ? value * 2 : -value * 2 - 1);
  }
}

/** Thrown inside the reader: a field out of range or bits run out (caught as `code_layout`). */
class LayoutError extends Error {}

class BitReader {
  at = 0;
  constructor(readonly bits: readonly number[]) {}

  fixed(width: number): number {
    if (this.at + width > this.bits.length) throw new LayoutError('the code ends inside a field');
    let v = 0;
    for (let i = 0; i < width; i++) v = v * 2 + (this.bits[this.at++] as number);
    return v;
  }

  uint(): number {
    let v = 0;
    let scale = 1;
    for (let groups = 0; ; groups++) {
      if (groups >= 13) throw new LayoutError('a number is too long');
      const more = this.fixed(1);
      v += this.fixed(4) * scale;
      scale *= 16;
      if (more === 0) return v;
    }
  }

  nullable(): number | null {
    const v = this.uint();
    return v === 0 ? null : v - 1;
  }

  int(): number {
    const z = this.uint();
    return z % 2 === 0 ? z / 2 : -(z + 1) / 2;
  }
}

/** CRC-16/CCITT (polynomial 0x1021, start 0xFFFF) over bits, one at a time. */
export function crc16(bits: readonly number[]): number {
  let crc = 0xffff;
  for (const b of bits) {
    const top = (crc >> 15) & 1;
    crc = (crc << 1) & 0xffff;
    if ((top ^ b) === 1) crc ^= 0x1021;
  }
  return crc;
}

/** A code as typed in its canonical characters: upper case, no dashes or spaces, O as 0, I and L as 1. */
export function normalizeSaveCode(text: string): string {
  return text.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

/** A code in groups of five characters joined by dashes. */
function grouped(chars: string): string {
  const groups: string[] = [];
  for (let i = 0; i < chars.length; i += SAVE_CODE_GROUP) groups.push(chars.slice(i, i + SAVE_CODE_GROUP));
  return groups.join('-');
}

const refuse = (code: SaveCodeRefusalCode, error: string): SaveCodeRefusal => ({ ok: false, code, error });

/** A refusal when another id of `list` shares `id`'s save code id (`validate` refuses such a game first). */
function collision(list: readonly { id: string }[], id: string, kind: string): SaveCodeRefusal | null {
  const code = saveCodeId(id);
  const other = list.find((x) => x.id !== id && saveCodeId(x.id) === code);
  return other === undefined
    ? null
    : refuse('code_collision', `${kind}s "${id}" and "${other.id}" share the save code id ${code}`);
}

/** The game's missions sorted by id (version 1 writes indexes into it) and outcomes per mission. */
function missionTable(ctx: SaveCodeContext) {
  return byId(ctx.missions);
}

/**
 * Packs a campaign save into a save code. Refused, with the decode codes, when the save does not
 * fit the game: another game's or an unknown campaign (`code_campaign`), a position past the end
 * (`code_position`), a mission or outcome the game lacks or a broken save (`code_layout`), or a
 * carried record that does not fit the next scenario's carry spec (`code_record`).
 */
export function encodeSaveCode(
  save: CampaignSave,
  ctx: SaveCodeContext,
  opts: { version?: SaveCodeVersion } = {},
): { ok: true; code: string } | SaveCodeRefusal {
  const version = opts.version ?? SAVE_CODE_VERSION;
  const parsed = campaignSaveSchema.safeParse(save);
  if (!parsed.success)
    return refuse(
      'code_layout',
      `not a campaign save: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(save)'}: ${i.message}`).join('; ')}`,
    );
  if (save.game !== ctx.game)
    return refuse('code_campaign', `the save is game "${save.game}"'s, not "${ctx.game}"'s`);
  const campaigns = byId(ctx.campaigns);
  const campaignIndex = campaigns.findIndex((c) => c.id === save.campaign);
  const campaign = campaigns[campaignIndex];
  if (campaign === undefined) return refuse('code_campaign', `the game has no campaign "${save.campaign}"`);
  const order = campaignOrder(campaign);
  if (save.position > order.length)
    return refuse(
      'code_position',
      `position ${save.position} is past the end of campaign "${campaign.id}" (${order.length} entries)`,
    );

  const w = new BitWriter();
  if (version === 1) {
    if (save.ended !== undefined)
      return refuse('code_layout', 'a version 1 code cannot hold a campaign that ended (`ended`)');
    w.uint(campaignIndex);
  } else {
    const clash = collision(ctx.campaigns, campaign.id, 'campaign');
    if (clash !== null) return clash;
    w.fixed(saveCodeId(campaign.id), SAVE_CODE_ID_BITS);
  }
  w.uint(save.position);
  w.int(save.seed);
  if (version >= 2) w.fixed(save.ended !== undefined ? 1 : 0, 1);

  const spec = carrySpecAt(campaign, save.position, ctx);
  if (save.carried === null) w.fixed(0, 1);
  else {
    if (spec === null)
      return refuse(
        'code_record',
        `the save carries a record, but no scenario entry after position ${save.position} starts from another's results`,
      );
    const mismatch = carriedMismatch(save.carried, spec.from);
    if (mismatch !== null) return refuse('code_record', mismatch);
    w.fixed(1, 1);
    w.uint(save.carried.tick);
    for (const key of spec.from.carry.people) {
      const p = save.carried.people[key] as CarriedPerson;
      w.fixed(CARRIED_FATES.indexOf(p.fate), 3);
      const by = p.by === null ? null : spec.factions.indexOf(p.by);
      if (by === -1)
        return refuse('code_record', `"${key}"'s \`by\` "${p.by}" is a faction of neither scenario`);
      w.nullable(by);
      w.nullable(p.at);
      w.nullable(p.hp);
      w.nullable(p.max);
    }
    for (const s of spec.from.carry.stockpiles)
      for (const item of s.items) w.uint(save.carried.stockpiles[s.faction]?.[item] ?? 0);
  }

  const missions = missionTable(ctx);
  for (const r of save.results) {
    w.uint(r.missions.length);
    for (const m of r.missions) {
      const index = missions.findIndex((d) => d.id === m.mission);
      const def = missions[index];
      if (def === undefined) return refuse('code_layout', `the game has no mission "${m.mission}"`);
      const outcome = def.outcomes.findIndex((o) => o.id === m.outcome);
      if (outcome === -1)
        return refuse('code_layout', `mission "${m.mission}" has no outcome "${m.outcome}"`);
      if (version === 1) w.uint(index);
      else {
        const clash = collision(ctx.missions, def.id, 'mission');
        if (clash !== null) return clash;
        w.fixed(saveCodeId(def.id), SAVE_CODE_ID_BITS);
      }
      w.uint(outcome);
      w.fixed(CAMPAIGN_RESOLUTIONS.indexOf(m.resolution), 2);
    }
  }

  const payload = w.bits;
  while ((4 + 16 + payload.length) % 5 !== 0) payload.push(0);
  const head = new BitWriter();
  head.fixed(version, 4);
  head.fixed(crc16(payload), 16);
  const bits = [...head.bits, ...payload];
  let chars = '';
  for (let i = 0; i < bits.length; i += 5) {
    let v = 0;
    for (let j = 0; j < 5; j++) v = v * 2 + (bits[i + j] as number);
    chars += SAVE_CODE_ALPHABET[v];
  }
  return { ok: true, code: grouped(chars) };
}

/**
 * Reads a save code back into the campaign save it packs, against the game's context. The same
 * code gives the same save on every machine; anything wrong is refused (see the file comment) and
 * nothing is returned but the refusal.
 */
export function decodeSaveCode(
  text: string,
  ctx: SaveCodeContext,
): { ok: true; save: CampaignSave } | SaveCodeRefusal {
  const chars = normalizeSaveCode(text);
  if (chars === '') return refuse('code_empty', 'the code is empty');
  const bits: number[] = [];
  for (let i = 0; i < chars.length; i++) {
    const v = SAVE_CODE_ALPHABET.indexOf(chars[i] as string);
    if (v === -1) return refuse('code_typo', `character ${i + 1} ("${chars[i]}") is not in a save code`);
    for (let j = 4; j >= 0; j--) bits.push((v >> j) & 1);
  }
  if (bits.length < 20) return refuse('code_layout', `the code is too short (${chars.length} characters)`);
  const head = new BitReader(bits);
  const version = head.fixed(4);
  if (version > SAVE_CODE_VERSION)
    return refuse(
      'code_newer',
      `the code is version ${version}, newer than this build reads (${SAVE_CODE_VERSION})`,
    );
  if (version < 1) return refuse('code_layout', `the code's version ${version} was never written`);
  const crc = head.fixed(16);
  const payload = bits.slice(20);
  if (crc16(payload) !== crc) return refuse('code_typo', 'the checksum does not match: a character is wrong');

  try {
    const r = new BitReader(payload);
    const campaigns = byId(ctx.campaigns);
    let campaign: CampaignDef | undefined;
    if (version === 1) {
      const campaignIndex = r.uint();
      campaign = campaigns[campaignIndex];
      if (campaign === undefined)
        return refuse(
          'code_campaign',
          `campaign ${campaignIndex} is not one of the game's ${campaigns.length}`,
        );
    } else {
      const code = r.fixed(SAVE_CODE_ID_BITS);
      campaign = campaigns.find((c) => saveCodeId(c.id) === code);
      if (campaign === undefined)
        return refuse('code_campaign', `no campaign of the game has the save code id ${code}`);
    }
    const order = campaignOrder(campaign);
    const position = r.uint();
    if (position > order.length)
      return refuse(
        'code_position',
        `position ${position} is past the end of campaign "${campaign.id}" (${order.length} entries)`,
      );
    const seed = r.int();
    let ended: CampaignSave['ended'];
    if (version >= 2 && r.fixed(1) === 1) {
      const endIf = order[position - 1]?.endIf;
      if (endIf === undefined)
        throw new LayoutError(`the code says the campaign ended, but entry ${position - 1} has no "endIf"`);
      ended = { entry: position - 1, reason: { ...endIf } };
    }

    let carried: CarriedRecord | null = null;
    if (r.fixed(1) === 1) {
      const spec = carrySpecAt(campaign, position, ctx);
      if (spec === null)
        return refuse(
          'code_record',
          `the code carries a record, but no scenario entry after position ${position} starts from another's results`,
        );
      const tick = r.uint();
      const people: [string, CarriedPerson][] = [];
      for (const key of spec.from.carry.people) {
        const fate = CARRIED_FATES[r.fixed(3)];
        if (fate === undefined) throw new LayoutError(`"${key}"'s fate is out of range`);
        const byIndex = r.nullable();
        const by = byIndex === null ? null : spec.factions[byIndex];
        if (by === undefined) throw new LayoutError(`"${key}"'s \`by\` is out of range`);
        people.push([key, { fate, by, at: r.nullable(), hp: r.nullable(), max: r.nullable() }]);
      }
      const stockpiles: [string, Record<string, number>][] = [];
      for (const s of spec.from.carry.stockpiles) {
        const items: [string, number][] = s.items.map((item) => [item, r.uint()]);
        stockpiles.push([s.faction, sortedObject(items)]);
      }
      const record = carriedRecordSchema.safeParse({
        format: CARRIED_FORMAT,
        version: CARRIED_VERSION,
        from: spec.from.scenario,
        tick,
        people: sortedObject(people),
        stockpiles: sortedObject(stockpiles),
      });
      if (!record.success)
        return refuse(
          'code_record',
          `the carried part is not a carried record: ${record.error.issues[0]?.path.join('.')}: ${record.error.issues[0]?.message}`,
        );
      carried = record.data;
    }

    const missions = missionTable(ctx);
    const results: CampaignSave['results'] = [];
    for (let entry = 0; entry < position; entry++) {
      const count = r.uint();
      if (count > payload.length) throw new LayoutError('too many missions');
      const done: CampaignMissionResult[] = [];
      for (let k = 0; k < count; k++) {
        let def: (typeof missions)[number] | undefined;
        if (version === 1) def = missions[r.uint()];
        else {
          const code = r.fixed(SAVE_CODE_ID_BITS);
          def = missions.find((m) => saveCodeId(m.id) === code);
        }
        if (def === undefined) throw new LayoutError('a mission is out of range');
        const outcome = def.outcomes[r.uint()];
        if (outcome === undefined) throw new LayoutError(`an outcome of "${def.id}" is out of range`);
        const resolution = CAMPAIGN_RESOLUTIONS[r.fixed(2)] as CampaignMissionResult['resolution'];
        done.push({ mission: def.id, outcome: outcome.id, resolution });
      }
      results.push({ entry, missions: done });
    }

    const left = payload.length - r.at;
    if (left >= 5 || payload.slice(r.at).some((b) => b !== 0))
      return refuse('code_layout', `${left} bit(s) are left over after the save`);
    const save: CampaignSave = {
      format: CAMPAIGN_SAVE_FORMAT,
      version: CAMPAIGN_SAVE_VERSION,
      game: ctx.game,
      campaign: campaign.id,
      seed,
      position,
      carried,
      results,
      ...(ended !== undefined ? { ended } : {}),
    };
    const checked = campaignSaveSchema.safeParse(save);
    if (!checked.success)
      return refuse('code_layout', checked.error.issues[0]?.message ?? 'not a campaign save');
    return { ok: true, save: checked.data };
  } catch (error) {
    if (error instanceof LayoutError) return refuse('code_layout', error.message);
    throw error;
  }
}

/** `entries` as an object with its keys in sorted order. */
function sortedObject<T>(entries: readonly (readonly [string, T])[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of [...entries].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) out[k] = v;
  return out;
}
