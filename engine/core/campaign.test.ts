import { describe, expect, it } from 'vitest';
import {
  campaignLevels,
  campaignOrder,
  campaignSchema,
  checkCampaigns,
  entryId,
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
