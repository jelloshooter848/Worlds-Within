import { afterEach, describe, expect, it, vi } from 'vitest';
import { advanceCampaign, campaignSchema, newCampaignSave, type CampaignSave } from '../campaign';
import type { SaveCodeContext } from '../campaign-code';
import { campaignSaveKey } from '../save/campaign-store';
import { CampaignSession } from './campaign-session';

// Engine 0.13 T8: a campaign as a page plays it. An entry's end stores the save and packs its
// code; a typed code resumes the campaign or is refused with the codec's reason; a finished
// campaign's code and a page without storage are handled without throwing.

afterEach(() => vi.unstubAllGlobals());

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

const CAMPAIGN = campaignSchema.parse({
  version: 1,
  id: 'two',
  entries: [{ mission: 'first' }, { mission: 'second' }],
});
const CONTEXT: SaveCodeContext = {
  game: 'demo',
  campaigns: [CAMPAIGN],
  missions: [
    { id: 'first', outcomes: [{ id: 'won' }, { id: 'lost' }] },
    { id: 'second', outcomes: [{ id: 'won' }] },
  ],
  scenarios: [],
};

const advance = (save: CampaignSave, mission: string): CampaignSave => {
  const r = advanceCampaign(CAMPAIGN, save, {
    missions: [{ mission, outcome: 'won', resolution: 'played' }],
  });
  if (!r.ok) throw new Error(r.error);
  return r.save;
};
const START = newCampaignSave({ game: 'demo', campaign: 'two', seed: 3 });
const AFTER_FIRST = advance(START, 'first');
const DONE = advance(AFTER_FIRST, 'second');

describe('CampaignSession', () => {
  it("stores an entry's save, packs its code, and resumes from that code", () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const session = new CampaignSession(CONTEXT, CAMPAIGN);
    expect(session.stored()).toBeNull();
    const end = session.end(AFTER_FIRST);
    expect(end).toMatchObject({ save: AFTER_FIRST, stored: true, done: false, codeError: null });
    expect(end.code).toMatch(/^[0-9A-Z-]+$/);
    expect(session.stored()).toEqual(AFTER_FIRST);
    const resumed = session.resume(end.code!.toLowerCase());
    expect(resumed).toMatchObject({ ok: true, save: AFTER_FIRST });
    if (resumed.ok) expect(resumed.run.position).toBe(1);
  });

  it('refuses a bad code with its reason, and a finished campaign as campaign_done', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const session = new CampaignSession(CONTEXT, CAMPAIGN);
    expect(session.resume('')).toMatchObject({ ok: false, code: 'code_empty' });
    const code = session.end(AFTER_FIRST).code!;
    const last = code.at(-1) === '0' ? '1' : '0';
    expect(session.resume(code.slice(0, -1) + last)).toMatchObject({ ok: false, code: 'code_typo' });
    expect(session.resume('U')).toMatchObject({ ok: false, code: 'code_typo' });
    const done = session.end(DONE);
    expect(done.done).toBe(true);
    expect(session.resume(done.code!)).toMatchObject({ ok: false, code: 'campaign_done' });
    // A finished campaign stored is nothing to carry on from.
    expect(session.stored()).toBeNull();
  });

  it('keeps nothing for a null save and plays on without storage', () => {
    const session = new CampaignSession(CONTEXT, CAMPAIGN);
    expect(session.end(null)).toEqual({
      save: null,
      code: null,
      codeError: null,
      stored: false,
      done: false,
    });
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(session.stored()).toBeNull();
    expect(session.end(AFTER_FIRST)).toMatchObject({ stored: false, done: false });
    expect(session.end(AFTER_FIRST).code).not.toBeNull();
    expect(campaignSaveKey('demo', 'two')).toBe('ww:demo:campaign:two');
  });
});
