import { describe, expect, it } from 'vitest';
import {
  advanceCampaign,
  campaignLevels,
  campaignRun,
  campaignSaveAt,
  campaignSaveSchema,
  campaignOrder,
  campaignSchema,
  checkCampaigns,
  entryId,
  entryOver,
  entryWorldClock,
  newCampaignSave,
  type CampaignDef,
} from './campaign';
import { loadContent } from './content/bundle';
import { engineContentKinds } from './content/engine-kinds';
import { validate } from './content/validate';

const MAIN = {
  version: 1,
  id: 'main',
  entries: [{ level: 'level-2' }, { mission: 'raid' }, { level: 'level-1' }],
};

const codes = (data: unknown) => {
  const r = validate('main.campaign.json', data, campaignSchema);
  return r.ok ? [] : r.errors.map((e) => [e.path, e.code]);
};

describe('the campaign schema', () => {
  it('reads a campaign', () => {
    expect(codes(MAIN)).toEqual([]);
    expect(codes({ ...MAIN, title: 'Main', start: 'raid' })).toEqual([]);
  });

  it("takes an entry's briefing text (Engine 0.15 T10, gap M34), never an empty one", () => {
    const entries = MAIN.entries.map((e, i) => (i === 0 ? { ...e, text: 'Hold the gate.' } : e));
    expect(codes({ ...MAIN, entries })).toEqual([]);
    const empty = MAIN.entries.map((e, i) => (i === 0 ? { ...e, text: '' } : e));
    expect(codes({ ...MAIN, entries: empty })).toEqual([['entries.0.text', 'too_small']]);
  });

  it('names the field of a broken campaign', () => {
    expect(codes({ ...MAIN, version: 2 })).toEqual([['version', 'invalid_value']]);
    expect(codes({ ...MAIN, entries: [] })).toEqual([['entries', 'too_small']]);
    expect(codes({ ...MAIN, entries: [{ level: 'a', mission: 'b' }] })).toEqual([['entries.0', 'bad_entry']]);
    expect(codes({ ...MAIN, entries: [{}] })).toEqual([['entries.0', 'bad_entry']]);
    expect(codes({ ...MAIN, entries: [{ room: 'a' }] })).toEqual([
      ['entries.0.room', 'unrecognized_keys'],
      ['entries.0', 'bad_entry'],
    ]);
    expect(codes({ ...MAIN, entries: [...MAIN.entries, { level: 'level-2' }] })).toEqual([
      ['entries.3.level', 'duplicate_entry'],
    ]);
    expect(codes({ ...MAIN, start: 'nope' })).toEqual([['start', 'unknown_entry']]);
    expect(codes({ ...MAIN, entries: [{ level: 'x' }, { mission: 'x' }], start: 'x' })).toEqual([
      ['start', 'ambiguous_start'],
    ]);
  });

  it('reads scenario entries with their ticks (Engine 0.13)', () => {
    const entries = [
      { scenario: 'village', ticks: 400 },
      { mission: 'raid' },
      { scenario: 'dawn', ticks: 300 },
    ];
    expect(codes({ ...MAIN, entries })).toEqual([]);
    expect(codes({ ...MAIN, entries: [{ scenario: 'village' }] })).toEqual([
      ['entries.0.ticks', 'bad_entry'],
    ]);
    expect(codes({ ...MAIN, entries: [{ level: 'a', ticks: 3 }] })).toEqual([
      ['entries.0.ticks', 'bad_entry'],
    ]);
    expect(codes({ ...MAIN, entries: [{ scenario: 'a', mission: 'a', ticks: 3 }] })).toEqual([
      ['entries.0', 'bad_entry'],
    ]);
    expect(codes({ ...MAIN, entries: [{ scenario: 'v', ticks: 0 }] })).toEqual([
      ['entries.0.ticks', 'too_small'],
    ]);
    expect(
      codes({
        ...MAIN,
        entries: [
          { scenario: 'v', ticks: 1 },
          { scenario: 'v', ticks: 2 },
        ],
      }),
    ).toEqual([['entries.1.scenario', 'duplicate_entry']]);
  });

  it('reads an entry title for a page (Engine 0.13 T8)', () => {
    const entries = [
      { scenario: 'village', ticks: 400, title: 'The siege' },
      { mission: 'raid', title: 'Raid' },
    ];
    expect(codes({ ...MAIN, entries })).toEqual([]);
    expect(codes({ ...MAIN, entries: [{ level: 'a', title: '' }] })).toEqual([
      ['entries.0.title', 'too_small'],
    ]);
  });
});

describe('campaign order', () => {
  const main = campaignSchema.parse(MAIN) as CampaignDef;

  it('plays the entries in file order, from the start entry round to the one before it', () => {
    expect(campaignOrder(main).map(entryId)).toEqual(['level-2', 'raid', 'level-1']);
    expect(campaignOrder({ ...main, start: 'raid' }).map(entryId)).toEqual(['raid', 'level-1', 'level-2']);
    expect(campaignLevels(main)).toEqual(['level-2', 'level-1']);
    expect(campaignLevels({ ...main, start: 'level-1' })).toEqual(['level-1', 'level-2']);
  });

  it('finds each level and mission an entry names that the game lacks', () => {
    const others = (kind: string) => (kind === 'level' ? [{ name: 'level-1', value: {} }] : []);
    expect(checkCampaigns([{ name: 'main', value: main }], others)).toEqual([
      {
        name: 'main',
        path: ['entries', 0, 'level'],
        code: 'missing_level',
        message: 'the game has no level "level-2" (no level file of that name)',
      },
      {
        name: 'main',
        path: ['entries', 1, 'mission'],
        code: 'missing_mission',
        message: 'the game has no mission "raid" (no mission file of that name)',
      },
    ]);
  });

  it('finds scenario entries the game lacks and a follow-up that does not follow its scenario', () => {
    const scenario = (from?: string) => ({
      format: 'worlds-within/scenario',
      ...(from === undefined ? {} : { from: { scenario: from } }),
    });
    const all = [
      { name: 'village', value: scenario() },
      { name: 'dawn', value: scenario('village') },
      { name: 'dusk', value: scenario('nowhere') },
      { name: 'not-a-world', value: { format: 'other' } },
    ];
    const others = (kind: string) =>
      kind === '*' ? all : kind === 'mission' ? [{ name: 'raid', value: {} }] : [];
    const check = (entries: unknown[]) =>
      checkCampaigns(
        [{ name: 'c', value: campaignSchema.parse({ version: 1, id: 'c', entries }) }],
        others,
      ).map((i) => [i.path.join('.'), i.code]);
    const s = (id: string) => ({ scenario: id, ticks: 10 });
    expect(check([s('village'), { mission: 'raid' }, s('dawn')])).toEqual([]);
    // A follow-up first in the campaign plays alone (it starts as written).
    expect(check([s('dawn')])).toEqual([]);
    expect(check([s('village'), s('not-a-world')])).toEqual([['entries.1.scenario', 'missing_scenario']]);
    expect(check([s('village'), s('dusk')])).toEqual([['entries.1.scenario', 'bad_from']]);
    expect(check([s('dusk'), s('dawn')])).toEqual([['entries.1.scenario', 'bad_from']]);
  });

  it('takes an entry clock and ticks an hour, and finds a clock that runs backwards (Engine 0.16 F4)', () => {
    const all = [
      { name: 'village', value: { format: 'worlds-within/scenario' } },
      { name: 'dawn', value: { format: 'worlds-within/scenario', from: { scenario: 'village' } } },
    ];
    const others = (kind: string) => (kind === '*' ? all : []);
    const check = (entries: unknown[]) =>
      checkCampaigns(
        [{ name: 'c', value: campaignSchema.parse({ version: 1, id: 'c', entries }) }],
        others,
      ).map((i) => [i.path.join('.'), i.code]);
    const village = { scenario: 'village', ticks: 260, clock: { day: 2, hour: 14 } };
    const dawn = { scenario: 'dawn', ticks: 200, clock: { day: 3, hour: 5, minute: 30 } };
    expect(codes({ version: 1, id: 'c', ticksPerHour: 60, entries: [village, dawn] })).toEqual([]);
    expect(check([village, dawn])).toEqual([]);
    expect(check([village, { ...dawn, clock: { day: 2, hour: 13 } }])).toEqual([
      ['entries.1.clock', 'clock_backwards'],
    ]);
    // Entries without a clock are skipped.
    expect(check([village, { scenario: 'dawn', ticks: 5 }])).toEqual([]);
    expect(codes({ version: 1, id: 'c', entries: [{ level: 'a', clock: { day: 1, hour: 6 } }] })).toEqual([
      ['entries.0.clock', 'bad_entry'],
    ]);
    expect(codes({ version: 1, id: 'c', entries: [{ ...village, clock: { day: 1, hour: 25 } }] })).toEqual([
      ['entries.0.clock.hour', 'too_big'],
    ]);
    expect(codes({ version: 1, id: 'c', ticksPerHour: 0, entries: [village] })).toEqual([
      ['ticksPerHour', 'too_small'],
    ]);
  });

  it('is checked across the content by the loader, naming file and field', () => {
    const files = {
      'game.json': JSON.stringify({
        id: 'g',
        kit: 'k',
        content: { campaign: ['content/*.campaign.json'], mission: ['content/*.mission.json'] },
        start: { seed: 1 },
        headless: 'headless.ts',
      }),
      'content/main.campaign.json': JSON.stringify({
        version: 1,
        id: 'main',
        entries: [{ mission: 'raid' }],
      }),
      'content/raid.mission.json': JSON.stringify({
        id: 'raid',
        title: 'Raid',
        worldTimeCost: 5,
        play: 'sabotage',
        onQuit: 'lost',
        outcomes: [{ id: 'lost', title: 'Lost' }],
      }),
    };
    expect(loadContent(files, engineContentKinds()).ok).toBe(true);
    const bad = loadContent(
      {
        ...files,
        'content/main.campaign.json': JSON.stringify({
          version: 1,
          id: 'main',
          entries: [{ mission: 'rescue' }],
        }),
      },
      engineContentKinds(),
      { root: 'games/g/' },
    );
    expect(bad.ok ? [] : bad.errors.map((e) => [e.file, e.path, e.code])).toEqual([
      ['games/g/content/main.campaign.json', 'entries.0.mission', 'missing_mission'],
    ]);
  });
});

describe('campaigns played in order (Engine 0.13)', () => {
  const campaign = campaignSchema.parse({
    version: 1,
    id: 'siege',
    entries: [
      { scenario: 'village', ticks: 400 },
      { mission: 'parley' },
      { level: 'interlude' },
      { scenario: 'dawn', ticks: 300 },
    ],
  });
  const carried = {
    format: 'worlds-within/carried' as const,
    version: 1 as const,
    from: 'village',
    tick: 400,
    people: { captain: { fate: 'captured' as const, by: 'raiders', at: 161, hp: 90, max: 120 } },
    stockpiles: { village: { gold: 70 } },
  };
  const start = newCampaignSave({ game: 'mini-siege', campaign: 'siege', seed: 11 });

  it('plays each entry once, in order, carrying the record and the committed results', () => {
    expect(campaignRun(campaign, start)).toMatchObject({
      position: 0,
      scenario: 'village',
      nextScenario: 'village',
    });
    const one = advanceCampaign(campaign, start, {
      missions: [{ mission: 'sabotage', outcome: 'driven-off', resolution: 'quit' }],
      carried,
    });
    if (!one.ok) throw new Error(one.error);
    expect(campaignRun(campaign, one.save)).toMatchObject({
      position: 1,
      entry: { mission: 'parley' },
      scenario: 'village',
      nextScenario: 'dawn',
      carried,
    });
    const two = advanceCampaign(campaign, one.save, {
      missions: [{ mission: 'parley', outcome: 'refused', resolution: 'delegated' }],
    });
    if (!two.ok) throw new Error(two.error);
    expect(two.save.carried).toEqual(carried);
    const three = advanceCampaign(campaign, two.save);
    if (!three.ok) throw new Error(three.error);
    expect(campaignRun(campaign, three.save)).toMatchObject({ position: 3, scenario: 'dawn', done: false });
    const four = advanceCampaign(campaign, three.save, { carried: null });
    if (!four.ok) throw new Error(four.error);
    expect(campaignRun(campaign, four.save)).toMatchObject({ done: true, entry: null });
    expect(four.save.results.map((r) => [r.entry, r.missions.map((m) => m.mission)])).toEqual([
      [0, ['sabotage']],
      [1, ['parley']],
      [2, []],
      [3, []],
    ]);
    expect(campaignSaveSchema.safeParse(four.save).success).toBe(true);
    // Pure: the same save and result give the same next save; the old save is unchanged.
    expect(advanceCampaign(campaign, start, { carried })).toEqual(
      advanceCampaign(campaign, start, { carried }),
    );
    expect(start.position).toBe(0);
  });

  it('refuses a result that breaks the rules, changing nothing', () => {
    const refused = (save = start, result = {}) => {
      const r = advanceCampaign(campaign, save, result);
      return r.ok ? 'ok' : r.code;
    };
    const one = advanceCampaign(campaign, start, { carried });
    if (!one.ok) throw new Error(one.error);
    expect(refused({ ...start, campaign: 'other' })).toBe('wrong_campaign');
    expect(refused(one.save)).toBe('bad_result');
    expect(refused(one.save, { missions: [{ mission: 'raid', outcome: 'x', resolution: 'played' }] })).toBe(
      'bad_result',
    );
    const two = advanceCampaign(campaign, one.save, {
      missions: [{ mission: 'parley', outcome: 'x', resolution: 'played' }],
    });
    if (!two.ok) throw new Error(two.error);
    expect(refused(two.save, { carried: null })).toBe('bad_result');
    expect(refused(start, { carried: { ...carried, tick: -1 } })).toBe('bad_result');
    const done = { ...start, position: 4, results: [0, 1, 2, 3].map((entry) => ({ entry, missions: [] })) };
    expect(refused(done)).toBe('campaign_done');
  });

  it('checks a save: results match the position, in play order', () => {
    const bad = (save: unknown) => {
      const r = validate('save.json', save, campaignSaveSchema);
      return r.ok ? [] : r.errors.map((e) => [e.path, e.code]);
    };
    expect(bad(start)).toEqual([]);
    expect(bad({ ...start, position: 1 })).toEqual([['results', 'custom']]);
    expect(bad({ ...start, position: 1, results: [{ entry: 3, missions: [] }] })).toEqual([
      ['results.0.entry', 'custom'],
    ]);
    expect(bad({ ...start, format: 'x' })).toEqual([['format', 'invalid_value']]);
  });
});

describe('a save at an entry (Engine 0.14, gap G9)', () => {
  const main = campaignSchema.parse(MAIN) as CampaignDef;

  it('starts the named entry fresh, the entries before it finished with nothing committed', () => {
    const save = campaignSaveAt(main, { game: 'g', seed: 5 }, 'level-1');
    expect(save).toMatchObject({ campaign: 'main', seed: 5, position: 2, carried: null });
    expect(save?.results).toEqual([
      { entry: 0, missions: [] },
      { entry: 1, missions: [] },
    ]);
    expect(campaignSaveSchema.safeParse(save).success).toBe(true);
    expect(campaignRun(main, save ?? undefined).entry).toEqual({ level: 'level-1' });
    expect(campaignSaveAt(main, { game: 'g', seed: 5 }, 'level-2')).toEqual(
      newCampaignSave({ game: 'g', campaign: 'main', seed: 5 }),
    );
  });

  it('follows the play order and gives null for an id the campaign lacks', () => {
    expect(campaignSaveAt({ ...main, start: 'raid' }, { game: 'g', seed: 1 }, 'level-2')?.position).toBe(2);
    expect(campaignSaveAt(main, { game: 'g', seed: 1 }, 'nowhere')).toBeNull();
  });
});

describe('a campaign that ends on a loss in its data (Engine 0.15 T8, gap M31)', () => {
  const campaign = campaignSchema.parse({
    version: 1,
    id: 'siege',
    entries: [
      { scenario: 'village', ticks: 260, endIf: { gone: 'hall' } },
      { scenario: 'dawn', ticks: 200 },
    ],
  });
  const start = newCampaignSave({ game: 'g', campaign: 'siege', seed: 3 });

  it('takes `endIf` on a scenario entry only', () => {
    expect(codes({ version: 1, id: 'c', entries: [{ level: 'a', endIf: { gone: 'hall' } }] })).toEqual([
      ['entries.0.endIf', 'bad_entry'],
    ]);
  });

  it("ends the campaign when the keyed entity is gone at the entry's end, recording why", () => {
    const r = advanceCampaign(campaign, start, { gone: (key) => key === 'hall' });
    if (!r.ok) throw new Error(r.error);
    expect(r.save.ended).toEqual({ entry: 0, reason: { gone: 'hall' } });
    expect(r.save.carried).toBeNull();
    expect(campaignSaveSchema.safeParse(r.save).success).toBe(true);
    const run = campaignRun(campaign, r.save);
    expect(run.done).toBe(true);
    expect(run.entry).toBeNull();
    expect(run.ended).toEqual({ entry: 0, reason: { gone: 'hall' } });
    const after = advanceCampaign(campaign, r.save);
    expect(!after.ok && after.code).toBe('campaign_done');
  });

  it('goes on when the entity stands (or no `gone` is given)', () => {
    for (const result of [{ gone: () => false }, {}]) {
      const r = advanceCampaign(campaign, start, result);
      expect(r.ok && r.save.ended).toBeUndefined();
      expect(r.ok && campaignRun(campaign, r.save).entry?.scenario).toBe('dawn');
    }
  });

  it("checks the key against the entry's scenario", () => {
    const all = [
      { name: 'village', value: { format: 'worlds-within/scenario', entities: [{ key: 'hall' }] } },
    ];
    const others = (kind: string) => (kind === '*' ? all : []);
    const check = (gone: string) =>
      checkCampaigns(
        [
          {
            name: 'c',
            value: campaignSchema.parse({
              version: 1,
              id: 'c',
              entries: [{ scenario: 'village', ticks: 5, endIf: { gone } }],
            }),
          },
        ],
        others,
      ).map((i) => [i.path.join('.'), i.code]);
    expect(check('hall')).toEqual([]);
    expect(check('barn')).toEqual([['entries.0.endIf.gone', 'unknown_key']]);
  });

  it('refuses a save whose `ended` is not its last finished entry', () => {
    const r = advanceCampaign(campaign, start, { gone: () => true });
    if (!r.ok) throw new Error(r.error);
    expect(campaignSaveSchema.safeParse({ ...r.save, ended: { ...r.save.ended, entry: 1 } }).success).toBe(
      false,
    );
  });
});

describe('one entry-end rule (Engine 0.15 T8, gap M35)', () => {
  const entry = { scenario: 'village', ticks: 260 };

  it('is over at its ticks with no mission open', () => {
    expect(entryOver(entry, { worldTick: 259, missionsOpen: 0 })).toBe(false);
    expect(entryOver(entry, { worldTick: 260, missionsOpen: 0 })).toBe(true);
    expect(entryOver(entry, { worldTick: 300, missionsOpen: 0 })).toBe(true);
  });

  it('waits for an open mission to commit', () => {
    expect(entryOver(entry, { worldTick: 260, missionsOpen: 1 })).toBe(false);
  });

  it('leaves level and mission entries to their own play', () => {
    expect(entryOver({ level: 'a' }, { worldTick: 1_000, missionsOpen: 0 })).toBe(false);
    expect(entryOver({ mission: 'raid' }, { worldTick: 1_000, missionsOpen: 0 })).toBe(false);
  });
});

describe('the world clock of an entry (Engine 0.16 F4)', () => {
  it("moves the entry clock on by the world tick at the campaign's ticks an hour", () => {
    const def = campaignSchema.parse({
      version: 1,
      id: 'c',
      ticksPerHour: 30,
      entries: [
        { scenario: 'village', ticks: 100, clock: { day: 2, hour: 14 } },
        { scenario: 'dawn', ticks: 100 },
      ],
    });
    expect(entryWorldClock(def, def.entries[0]!, 45)?.text).toBe('Day 2 15:30');
    const { ticksPerHour: _, ...plain } = def;
    expect(entryWorldClock(plain, def.entries[0]!, 45)?.time).toBe('14:45');
    expect(entryWorldClock(def, def.entries[1]!, 45)).toBeNull();
    expect(entryWorldClock(def, null, 45)).toBeNull();
  });
});
