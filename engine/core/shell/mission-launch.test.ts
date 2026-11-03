import { describe, expect, it } from 'vitest';
import { campaignRun, newCampaignSave, type CampaignDef, type CampaignSave } from '../campaign';
import type { JsonObject } from '../headless';
import type { InputFrame } from '../input/input-manager';
import { ScriptedInput } from '../input/scripted-input';
import type { MiniGameEnd } from '../mission-adapter';
import { MissionHost, type MissionWorldPort } from '../mission-host';
import type { MiniGame, MiniGameDef } from '../minigame';
import type { MissionAdapter, MissionDef } from '../missions';
import { SceneStack } from '../scene';
import type { CampaignEntryEnd } from './campaign-session';
import { MissionLaunch, type LaunchCampaignSession } from './mission-launch';

// The shared mission-launch scene and campaign flow (Engine 0.15 T10, gaps M26, M34, M36, lesson
// D14) over a `MissionHost` with a fake world (a tick, missions committing at open + cost) and a
// fake campaign session (no storage, codes "CODE-<position>"). The mini siege's page plays the
// real one (`games/samples/mini-siege/play.test.ts`, `tests/browser/mini-siege-page.test.ts`).

const RAID: MissionDef = {
  id: 'raid',
  title: 'Burn the engines',
  worldTimeCost: 3,
  play: 'count',
  onQuit: 'lost',
  outcomes: [
    { id: 'won', title: 'Both burnt', weight: 1, effects: [] },
    { id: 'lost', title: 'Driven off', weight: 1, effects: [] },
  ],
};
const PAY: MissionDef = {
  id: 'pay',
  title: 'Pay the toll',
  worldTimeCost: 1,
  onQuit: 'paid',
  outcomes: [{ id: 'paid', title: 'Paid', weight: 1, effects: [] }],
};

/** A round that passes on attack and quits on select. */
const COUNT: MiniGameDef = {
  id: 'count',
  title: 'COUNT',
  controls: [
    { actions: ['attack'], label: 'win' },
    { actions: ['select'], label: 'give up' },
  ],
  create(): MiniGame {
    let result: 'pass' | 'quit' | null = null;
    return {
      step(input) {
        if (input.pressed('select')) result = 'quit';
        else if (input.pressed('attack')) result = 'pass';
      },
      snapshot: () => ({}),
      result: () => result,
      report: () => ({}),
    };
  },
};

const ADAPTER: MissionAdapter<JsonObject, MiniGameEnd> = {
  input: () => ({}),
  outcome: (end) => ({ outcome: end.result === 'pass' ? 'won' : 'lost' }),
};

const CAMPAIGN: CampaignDef = {
  version: 1,
  id: 'main',
  entries: [
    { scenario: 'first', ticks: 10, title: 'The first', text: 'Hold on.' },
    { scenario: 'second', ticks: 5 },
  ],
};

/** A game: a MissionHost over a fake world that stands still while a mission is open. */
class FakeGame extends MissionHost {
  tick = 0;
  constructor(readonly save: CampaignSave) {
    const open = new Map<string, number>();
    const committed: { mission: string; outcome: string; resolution: string }[] = [];
    let resolved = new Map<string, string>();
    const port: MissionWorldPort = {
      open: (def) => {
        if (def.id === 'raid' && this.tick < 2) return { ok: false, code: 'not_offered', error: 'not yet' };
        open.set(def.id, this.tick + def.worldTimeCost);
        return { ok: true, snapshot: {}, commitTick: this.tick + def.worldTimeCost, seed: 1 };
      },
      delegate: (id) => (resolved.set(id, id === 'pay' ? 'paid' : 'won'), { ok: true }),
      play: (id, result) => (resolved.set(id, result.outcome), { ok: true }),
      quit: (id) => (resolved.set(id, 'lost'), { ok: true }),
      settle: () => {
        const due = [...open].filter(([, at]) => at <= this.tick).map(([id]) => id);
        for (const id of due) {
          open.delete(id);
          committed.push({ mission: id, outcome: resolved.get(id) ?? 'lost', resolution: 'delegated' });
        }
        resolved = new Map([...resolved].filter(([id]) => open.has(id)));
        return due;
      },
      records: () =>
        committed.map((c) => ({
          ...c,
          openTick: 0,
          commitTick: 0,
          experienceTicks: 0,
          skipped: [],
        })) as never,
      snapshot: () => ({ tick: this.tick }),
      step: () => void this.tick++,
    };
    super({ port, missions: [RAID, PAY], miniGames: [COUNT], adapters: { count: ADAPTER } });
    this.openIds = () => [...open.keys()];
  }
  openIds: () => string[];
}

/** A session without storage: a save's code is "CODE-<position>". */
function session(): LaunchCampaignSession & { stored: () => CampaignSave | null; kept: CampaignSave | null } {
  const s = {
    kept: null as CampaignSave | null,
    run: (save?: CampaignSave) => campaignRun(CAMPAIGN, save),
    end(save: CampaignSave | null): CampaignEntryEnd {
      if (save === null) return { save, code: null, codeError: null, stored: false, done: false };
      s.kept = save;
      return {
        save,
        code: `CODE-${save.position}`,
        codeError: null,
        stored: true,
        done: campaignRun(CAMPAIGN, save).done,
      };
    },
    resume(text: string) {
      const m = /^CODE-(\d)$/.exec(text);
      if (m === null) return { ok: false as const, code: 'code_typo' as const, error: 'not a code' };
      const save = { ...newCampaignSave({ game: 'g', campaign: 'main', seed: 1 }), position: Number(m[1]) };
      return { ok: true as const, save, run: campaignRun(CAMPAIGN, save) };
    },
    stored: () => (s.kept !== null && s.kept.position > 0 ? s.kept : null),
  };
  return s;
}

function flow(hold?: boolean) {
  const store = session();
  const launch = new MissionLaunch<FakeGame>({
    create: (save) => new FakeGame(save ?? newCampaignSave({ game: 'g', campaign: 'main', seed: 1 })),
    missions: [RAID, PAY],
    offers: (game) => (game.tick >= 2 && game.openIds().length === 0 ? ['raid', 'pay'] : []),
    tick: (game) => game.tick,
    stepsPerTick: 2,
    status: (game) => (game.tick >= 8 ? 'nearly over' : ''),
    campaign: {
      session: store,
      entryOver: (game) => {
        const ticks = campaignRun(CAMPAIGN, game.save).entry?.ticks ?? 0;
        return game.tick >= ticks && game.openIds().length === 0;
      },
      save: (game) => ({ ...game.save, position: game.save.position + 1 }),
      summary: (game) => ({ people: [`tick ${game.tick}`], verdict: 'held' }),
      ...(hold === undefined ? {} : { hold }),
    },
  });
  const stack = new SceneStack();
  stack.push(launch.scene(stack, () => ({ draw: () => undefined })));
  const step = (input: InputFrame = new ScriptedInput({ steps: [] })) => stack.update([input]);
  return { launch, step, store };
}

/** A frame pressing `action` on its first frame. */
function pressing(action: 'attack' | 'select'): ScriptedInput {
  const input = new ScriptedInput({ steps: [{ frame: 0, hold: [action] }] });
  input.next();
  return input;
}

describe('MissionLaunch (Engine 0.15 T10)', () => {
  it('holds each campaign entry at tick 0 until begun, with its briefing (M34)', () => {
    const { launch, step } = flow();
    for (let i = 0; i < 10; i++) step();
    expect(launch.tick).toBe(0);
    expect(launch.held()).toBe(true);
    expect(launch.briefing()).toEqual({ title: 'The first', text: 'Hold on.' });
    expect(launch.status()).toBe('The first, tick 0 | press Begin when ready');
    launch.press({ kind: 'begin' });
    step();
    step();
    expect(launch.held()).toBe(false);
    expect(launch.briefing()).toBeNull();
    expect(launch.tick).toBe(1); // one game step every two loop steps
  });

  it('does not hold without a campaign hold, and offers, launches, refuses and waits for the choice (M26)', () => {
    const { launch, step } = flow(false);
    expect(launch.held()).toBe(false);
    launch.press({ kind: 'launch', mission: 'raid' });
    step();
    expect(launch.message).toBe('not_offered: not yet');
    while (launch.tick < 2) step();
    expect(launch.launchButtons()).toEqual(['raid', 'pay']);
    expect(launch.title('raid')).toBe('Burn the engines');
    launch.press({ kind: 'launch', mission: 'raid' });
    step();
    expect(launch.choice()).toBe('raid');
    expect(launch.message).toBe('');
    expect(launch.launchButtons()).toEqual([]);
    expect(launch.status()).toContain('play the mission yourself, or delegate it?');
    for (let i = 0; i < 6; i++) step();
    expect(launch.tick).toBe(2);
    // The round: pushed by the scene, stepped every loop step, its key hint from the controls (D14).
    expect(launch.canPlay('raid')).toBe(true);
    launch.press({ kind: 'play' });
    step();
    expect(launch.playing()).toBe(true);
    expect(launch.status({ attack: 'X', select: 'BACKSPACE' })).toBe('X: win, BACKSPACE: give up');
    step(pressing('attack'));
    expect(launch.playing()).toBe(false);
    while (launch.records().length === 0) step();
    expect(launch.tick).toBe(5);
    expect(launch.status()).toBe('The first, tick 5 | Both burnt');
  });

  it('decides a choice without a round', () => {
    const { launch, step } = flow(false);
    while (launch.tick < 2) step();
    expect(launch.canPlay('pay')).toBe(false);
    launch.press({ kind: 'launch', mission: 'pay' });
    step();
    expect(launch.status()).toContain('decide?');
    launch.press({ kind: 'delegate' });
    step();
    expect(launch.choice()).toBeNull();
    while (launch.records().length === 0) step();
    expect(launch.records()[0]!.outcome).toBe('paid');
  });

  it("ends an entry by the game's rule, shows its result and code, and continues held (M36)", () => {
    const { launch, step, store } = flow();
    launch.press({ kind: 'begin' });
    while (launch.ended() === null) step();
    expect(launch.tick).toBe(10);
    expect(launch.status()).toContain('nearly over');
    expect(launch.ended()).toMatchObject({
      entry: 'first',
      title: 'The first',
      outcomes: [],
      people: ['tick 10'],
      verdict: 'held',
      code: 'CODE-1',
      stored: true,
      done: false,
      next: 'second',
    });
    step();
    expect(launch.tick).toBe(10);
    expect(launch.launchButtons()).toEqual([]);
    expect(store.stored()?.position).toBe(1);
    launch.press({ kind: 'continue' });
    step();
    expect(launch.entry()?.scenario).toBe('second');
    expect(launch.tick).toBe(0);
    expect(launch.held()).toBe(true);
    launch.press({ kind: 'begin' });
    while (launch.ended() === null) step();
    expect(launch.ended()).toMatchObject({ entry: 'second', done: true, next: null, code: 'CODE-2' });
    launch.press({ kind: 'continue' });
    step();
    expect(launch.entry()?.scenario).toBe('first');
  });

  it("resumes from a typed code or the stored save, and keeps a refused code's reason", () => {
    const { launch, step, store } = flow();
    launch.press({ kind: 'code', text: 'nonsense' });
    step();
    expect(launch.message).toBe('code_typo: not a code');
    expect(launch.entry()?.scenario).toBe('first');
    launch.press({ kind: 'code', text: 'CODE-1' });
    step();
    expect(launch.message).toBe('');
    expect(launch.entry()?.scenario).toBe('second');
    expect(launch.held()).toBe(true);
    store.kept = { ...newCampaignSave({ game: 'g', campaign: 'main', seed: 1 }), position: 1 };
    const fresh = flow();
    fresh.store.kept = store.kept;
    expect(fresh.launch.storedSave()?.position).toBe(1);
    fresh.launch.press({ kind: 'stored' });
    fresh.step();
    expect(fresh.launch.entry()?.scenario).toBe('second');
    expect(fresh.launch.entryTitle()).toBe('second');
  });
});
