import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { advanceCampaign, campaignSchema, newCampaignSave, type CampaignSave } from './campaign';
import {
  crc16,
  decodeSaveCode,
  encodeSaveCode,
  normalizeSaveCode,
  saveCodeContext,
  SAVE_CODE_ALPHABET,
  type SaveCodeContext,
} from './campaign-code';
import type { CarriedRecord } from './carried';
import { loadContent } from './content/bundle';
import { engineContentKinds } from './content/engine-kinds';
import { canonicalJson } from './headless';

// Engine 0.13 T6 (decision 7, item 226): save codes. A campaign of two world scenarios (the sim's
// captive fixtures) with a capture mission between them, as data only: the codec never builds a
// world (engine/tools/save-code.test.ts restores one from a code and compares hashes).

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../sim/__fixtures__/${name}`, import.meta.url), 'utf8'));

const CAMPAIGN = campaignSchema.parse({
  version: 1,
  id: 'captive',
  entries: [
    { scenario: 'captive', ticks: 40 },
    { mission: 'ransom-captain' },
    { scenario: 'captive-after', ticks: 30 },
  ],
});

/** The context `saveCodeContext` builds from a bundle holding the fixtures as plain entries. */
function context(): SaveCodeContext {
  const entries = [
    { kind: 'rts-map', name: 'captive', file: 'captive.world.json', value: fixture('captive.world.json') },
    {
      kind: 'rts-map',
      name: 'captive-after',
      file: 'captive-after.world.json',
      value: fixture('captive-after.world.json'),
    },
    { kind: 'campaign', name: 'captive', file: 'captive.campaign.json', value: CAMPAIGN },
    ...['ambush', 'rescue-captain', 'exchange-captain', 'leave-captain', 'ransom-captain'].map((id) => ({
      kind: 'mission',
      name: id,
      file: `${id}.mission.json`,
      value: fixture(`${id}.mission.json`),
    })),
  ];
  const manifest = { id: 'captive-game' } as never;
  return saveCodeContext({ manifest, entries });
}

const CARRIED: CarriedRecord = {
  format: 'worlds-within/carried',
  version: 1,
  from: 'captive',
  tick: 40,
  people: {
    captain: { fate: 'captured', by: 'raiders', at: 12, hp: 0, max: 30 },
    sergeant: { fate: 'active', by: null, at: null, hp: 30, max: 30 },
  },
  stockpiles: { village: { gold: 200 } },
};

/** The save at the end of the first scenario (position 1), with the ambush committed. */
function afterFirst(carried: CarriedRecord = CARRIED): CampaignSave {
  const r = advanceCampaign(
    CAMPAIGN,
    newCampaignSave({ game: 'captive-game', campaign: 'captive', seed: 7 }),
    {
      missions: [{ mission: 'ambush', outcome: 'taken', resolution: 'delegated' }],
      carried,
    },
  );
  if (!r.ok) throw new Error(r.error);
  return r.save;
}

const encode = (save: CampaignSave, ctx = context()) => {
  const r = encodeSaveCode(save, ctx);
  if (!r.ok) throw new Error(`${r.code}: ${r.error}`);
  return r.code;
};

/** A code with one character replaced by the next one in the alphabet. */
function flip(code: string, at: number): string {
  const chars = [...code];
  let seen = -1;
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === '-') continue;
    if (++seen !== at) continue;
    chars[i] = SAVE_CODE_ALPHABET[(SAVE_CODE_ALPHABET.indexOf(chars[i]!) + 1) % 32]!;
  }
  return chars.join('');
}

describe('save codes', () => {
  it('reads the context from a game bundle', () => {
    const ctx = context();
    expect(ctx.game).toBe('captive-game');
    expect(ctx.campaigns.map((c) => c.id)).toEqual(['captive']);
    expect(ctx.scenarios.map((s) => [s.name, s.from?.scenario ?? null, s.factions])).toEqual([
      ['captive', null, ['village']],
      ['captive-after', 'captive', ['raiders', 'village']],
    ]);
  });

  it('round-trips a save at every position, giving the same save and the same code every time', () => {
    const ctx = context();
    const start = newCampaignSave({ game: 'captive-game', campaign: 'captive', seed: -12345 });
    const first = afterFirst();
    const second = advanceCampaign(CAMPAIGN, first, {
      missions: [{ mission: 'ransom-captain', outcome: 'paid', resolution: 'delegated' }],
      carried: {
        ...CARRIED,
        people: { ...CARRIED.people, captain: { fate: 'freed', by: 'village', at: 41, hp: 0, max: 30 } },
        stockpiles: { village: { gold: 50 } },
      },
    });
    if (!second.ok) throw new Error(second.error);
    const done = advanceCampaign(CAMPAIGN, second.save, { carried: null });
    if (!done.ok) throw new Error(done.error);
    for (const save of [start, first, second.save, done.save]) {
      const code = encode(save, ctx);
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{1,5}(-[0-9A-HJKMNP-TV-Z]{1,5})*$/);
      expect(encode(save, ctx)).toBe(code);
      const back = decodeSaveCode(code, ctx);
      expect(back.ok && canonicalJson(back.save)).toBe(canonicalJson(save));
    }
  });

  it('stays short: at most 40 characters for a two-scenario campaign, about 27 after the first', () => {
    const chars = (save: CampaignSave) => encode(save).replace(/-/g, '').length;
    expect(chars(afterFirst())).toBeLessThanOrEqual(28);
    const big = afterFirst({
      ...CARRIED,
      tick: 1_000,
      people: {
        captain: { fate: 'dead', by: 'raiders', at: 999, hp: 0, max: 400 },
        sergeant: { fate: 'injured', by: null, at: 990, hp: 399, max: 400 },
      },
      stockpiles: { village: { gold: 4_000 } },
    });
    expect(chars(big)).toBeLessThanOrEqual(40);
  });

  it('reads a code typed in lower case, without dashes, with spaces, O for 0 and I or L for 1', () => {
    const ctx = context();
    const code = encode(afterFirst(), ctx);
    const typed = code.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'l');
    expect(normalizeSaveCode(typed)).toBe(code.replace(/-/g, ''));
    const back = decodeSaveCode(typed, ctx);
    expect(back.ok && back.save).toEqual(afterFirst());
  });

  it('refuses every tampered character as a typo', () => {
    const ctx = context();
    const code = encode(afterFirst(), ctx);
    const length = code.replace(/-/g, '').length;
    for (let i = 1; i < length; i++) {
      const r = decodeSaveCode(flip(code, i), ctx);
      expect(r.ok ? 'ok' : r.code).toBe('code_typo');
    }
  });

  it('refuses bad codes with a code, naming why', () => {
    const ctx = context();
    const code = encode(afterFirst(), ctx);
    const refused = (text: string, c = ctx) => {
      const r = decodeSaveCode(text, c);
      return r.ok ? 'ok' : r.code;
    };
    expect(refused('')).toBe('code_empty');
    expect(refused(' - ')).toBe('code_empty');
    expect(refused(`${code}U`)).toBe('code_typo');
    expect(refused(`${code}0`)).toBe('code_typo');
    expect(refused('1')).toBe('code_layout');
    // A version above this build's: the first character's top bits.
    expect(refused(`Z${code.slice(1)}`)).toBe('code_newer');
    expect(refused(`0${code.slice(1)}`)).toBe('code_layout');
    // The same code read against a game without the campaign, or with a shorter one.
    expect(refused(code, { ...ctx, campaigns: [] })).toBe('code_campaign');
    // No scenario starting from another's results: the carried part fits nothing.
    const noFrom = { ...ctx, scenarios: ctx.scenarios.map((s) => ({ ...s, from: null })) };
    expect(refused(code, noFrom)).toBe('code_record');
  });

  it('refuses a position past the end and changes nothing', () => {
    const ctx = context();
    const short = { ...ctx, campaigns: [{ ...CAMPAIGN, entries: [CAMPAIGN.entries[0]!] }] };
    const save = afterFirst();
    const before = canonicalJson(save);
    const longer = { ...save, position: 2, results: [...save.results, { entry: 1, missions: [] }] };
    const code = encode({ ...longer, carried: null }, ctx);
    const r = decodeSaveCode(code, short);
    expect(r.ok ? 'ok' : r.code).toBe('code_position');
    expect(canonicalJson(save)).toBe(before);
  });

  it('refuses to encode a save that does not fit the game', () => {
    const ctx = context();
    const save = afterFirst();
    const code = (s: CampaignSave, c = ctx) => {
      const r = encodeSaveCode(s, c);
      return r.ok ? 'ok' : r.code;
    };
    expect(code({ ...save, game: 'other' })).toBe('code_campaign');
    expect(code({ ...save, campaign: 'nope' })).toBe('code_campaign');
    expect(
      code({ ...save, position: 5, results: [0, 1, 2, 3, 4].map((entry) => ({ entry, missions: [] })) }),
    ).toBe('code_position');
    expect(
      code({
        ...save,
        results: [{ entry: 0, missions: [{ mission: 'nope', outcome: 'x', resolution: 'played' }] }],
      }),
    ).toBe('code_layout');
    expect(code({ ...save, carried: { ...CARRIED, from: 'elsewhere' } })).toBe('code_record');
    expect(code({ ...save, carried: { ...CARRIED, people: { captain: CARRIED.people['captain']! } } })).toBe(
      'code_record',
    );
    expect(code({ ...save, results: [] })).toBe('code_layout');
  });

  it('checks with CRC-16/CCITT (0x1021, start 0xFFFF)', () => {
    // "123456789" as bits gives the standard check value 0x29B1.
    const bits = [...'123456789'].flatMap((c) =>
      [7, 6, 5, 4, 3, 2, 1, 0].map((b) => (c.charCodeAt(0) >> b) & 1),
    );
    expect(crc16(bits)).toBe(0x29b1);
  });

  it('builds the context through loadContent like any game', () => {
    const files = {
      'game.json': JSON.stringify({
        id: 'g',
        kit: 'k',
        content: { campaign: ['c/*.campaign.json'], mission: ['m/*.mission.json'] },
        start: { seed: 1 },
        headless: 'h.ts',
      }),
      'c/main.campaign.json': JSON.stringify({ version: 1, id: 'main', entries: [{ mission: 'raid' }] }),
      'm/raid.mission.json': JSON.stringify({
        id: 'raid',
        title: 'Raid',
        worldTimeCost: 5,
        onQuit: 'lost',
        outcomes: [
          { id: 'won', title: 'Won' },
          { id: 'lost', title: 'Lost' },
        ],
      }),
    };
    const loaded = loadContent(files, engineContentKinds());
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
    const ctx = saveCodeContext(loaded.value);
    const main = ctx.campaigns[0]!;
    const save = advanceCampaign(main, newCampaignSave({ game: 'g', campaign: 'main', seed: 1 }), {
      missions: [{ mission: 'raid', outcome: 'lost', resolution: 'quit' }],
    });
    if (!save.ok) throw new Error(save.error);
    const back = decodeSaveCode(encode(save.save, ctx), ctx);
    expect(back.ok && back.save).toEqual(save.save);
  });
});
