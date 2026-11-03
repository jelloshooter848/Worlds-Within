import { describe, expect, it } from 'vitest';
import {
  advanceCampaign,
  campaignLevels,
  campaignRun,
  campaignSaveSchema,
  campaignOrder,
  campaignSchema,
  checkCampaigns,
  entryId,
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
