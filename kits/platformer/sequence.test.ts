import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { canonicalJson } from '@engine/core/headless';
import type { Action } from '@engine/core/input/actions';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import type { MiniGameDef } from '@engine/core/minigame';
import { levelSchema, type LevelDef } from './level';
import { profileSchema } from './profile';
import { campaignSchema } from '@engine/core/campaign';
import type { ContentBundle } from '@engine/core/content/bundle';
import {
  contentStages,
  LEVEL_PAUSE,
  LevelSequence,
  levelsInPlayOrder,
  levelStages,
  type LevelStage,
  type SequenceSnapshot,
} from './sequence';

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
const PROFILE = profileSchema.parse(JSON.parse(fixture('runner.profile.json')));

const level = (id: string, map: string[], extra: Record<string, unknown> = {}): LevelDef =>
  levelSchema.parse({ id, profile: 'runner', map, ...extra });

/** Three small levels: the goal a few tiles right of the start. */
const STAGES: LevelStage[] = levelStages(
  ['one', 'two', 'three'].map((id) => level(id, ['......', '.@..G.', '######'])),
  [PROFILE],
);

const idle = () => new ScriptedInput({ steps: [] });

function held(actions: Action[]): ScriptedInput {
  const input = idle();
  input.setHeld(actions);
  input.next();
  return input;
}

/** Ends the current level with `outcome`, then steps through the whole pause with no input. */
function finish(seq: LevelSequence, outcome: 'cleared' | 'failed'): void {
  seq.world.outcome = outcome;
  for (let i = 0; i < LEVEL_PAUSE; i++) seq.step(idle());
}

describe('LevelSequence', () => {
  it('starts on the first level with stage and pause at 0', () => {
    const seq = new LevelSequence(STAGES, { seed: 1 });
    const s = seq.snapshot();
    expect(s).toMatchObject({ level: 'one', stage: 0, pause: 0, outcome: 'playing' });
    expect(seq.stageCount).toBe(3);
  });

  it('starts the next level LEVEL_PAUSE ticks after a level is cleared', () => {
    const seq = new LevelSequence(STAGES, { seed: 1 });
    seq.world.outcome = 'cleared';
    for (let i = 1; i < LEVEL_PAUSE; i++) {
      seq.step(idle());
      expect(seq.snapshot()).toMatchObject({ level: 'one', stage: 0, pause: i });
    }
    seq.step(idle());
    expect(seq.snapshot()).toMatchObject({ level: 'two', stage: 1, pause: 0, outcome: 'playing' });
  });

  it('starts a failed level afresh, as a new world', () => {
    const seq = new LevelSequence(STAGES, { seed: 1 });
    const before = canonicalJson(seq.snapshot());
    const failed = seq.world;
    finish(seq, 'failed');
    expect(seq.world).not.toBe(failed);
    expect(seq.snapshot()).toMatchObject({ level: 'one', stage: 0, pause: 0, outcome: 'playing' });
    expect(canonicalJson(seq.snapshot())).toBe(before);
  });

  it('wraps round to the first level after the last is cleared', () => {
    const seq = new LevelSequence(STAGES, { seed: 1 });
    finish(seq, 'cleared');
    finish(seq, 'cleared');
    expect(seq.snapshot().level).toBe('three');
    finish(seq, 'cleared');
    expect(seq.snapshot()).toMatchObject({ level: 'one', stage: 0 });
  });

  it('plays a level to its goal and ignores the input while it pauses', () => {
    const seq = new LevelSequence(STAGES, { seed: 1 });
    let ticks = 0;
    while (seq.world.outcome === 'playing' && ticks++ < 300) seq.step(held(['right']));
    expect(seq.world.outcome).toBe('cleared');
    const end = seq.snapshot();
    expect(end.events.some((e) => e.type === 'cleared')).toBe(true);
    seq.step(held(['right', 'jump']));
    const paused = seq.snapshot();
    expect(paused.pause).toBe(1);
    expect(paused.events).toEqual([]);
    const strip = (s: SequenceSnapshot) => canonicalJson({ ...s, events: [], pause: 0 });
    expect(strip(paused)).toBe(strip(end));
  });

  it('takes its pause from the options', () => {
    const seq = new LevelSequence(STAGES, { seed: 1, pause: 3 });
    seq.world.outcome = 'cleared';
    seq.step(idle());
    seq.step(idle());
    expect(seq.snapshot().stage).toBe(0);
    seq.step(idle());
    expect(seq.snapshot()).toMatchObject({ stage: 1, pause: 0 });
    expect(() => new LevelSequence(STAGES, { seed: 1, pause: 0 })).toThrow(/pause/);
    expect(() => new LevelSequence([], { seed: 1 })).toThrow(/at least one level/);
  });

  it('gives every level the seed, the switched-off rules and the mini games', () => {
    const hold: MiniGameDef = {
      id: 'hold',
      title: 'HOLD',
      create: () => ({ step() {}, snapshot: () => ({}), result: () => null }),
    };
    const stages = levelStages(
      [
        level('a', ['......', '.@..G.', '######']),
        level('b', ['......', '.@!.G.', '######'], { triggers: [{ game: 'hold' }] }),
      ],
      [PROFILE],
    );
    const seq = new LevelSequence(stages, { seed: 7, disabledRules: ['gravity'], miniGames: [hold] });
    const rng = seq.snapshot().rng;
    for (let stage = 0; stage < 2; stage++) {
      expect(seq.stage).toBe(stage);
      expect(seq.world.rules.isOn('gravity')).toBe(false);
      expect(seq.world.rules.isOn('walk')).toBe(true);
      expect(seq.snapshot().rng).toBe(rng);
      finish(seq, 'cleared');
    }
    expect(() => new LevelSequence(stages.slice(1), { seed: 7 })).toThrow(/hold/);
  });

  it('gives equal snapshots on two runs', () => {
    const run = () => {
      const seq = new LevelSequence(STAGES, { seed: 5 });
      const out: string[] = [];
      for (let i = 0; i < 400; i++) {
        seq.step(held(i % 7 === 0 ? ['right', 'jump'] : ['right']));
        out.push(canonicalJson(seq.snapshot()));
      }
      return out;
    };
    const a = run();
    expect(a.some((s) => s.includes('"stage":1'))).toBe(true);
    expect(run()).toEqual(a);
  });
});

describe('levelStages', () => {
  it('pairs each level with the profile it names, in the order given', () => {
    const stages = levelStages([level('z', ['@G', '##']), level('a', ['@G', '##'])], [PROFILE]);
    expect(stages.map((s) => s.level.id)).toEqual(['z', 'a']);
    expect(stages.every((s) => s.profile === PROFILE)).toBe(true);
  });

  it('throws when a level names a profile that is missing', () => {
    expect(() => levelStages([level('x', ['@G', '##'])], [], 'the lab')).toThrow(
      'level "x" names profile "runner", which the lab lacks',
    );
  });
});

describe('levels in play order (gap G2)', () => {
  const ids = (levels: readonly { id: string }[]) => levels.map((l) => l.id);
  const map = ['......', '.@..G.', '######'];
  const levels = ['level-10', 'level-2', 'tiny', 'level-1'].map((id) => level(id, map));

  it('sorts by id with numbers compared as numbers, the first level ahead', () => {
    expect(ids(levelsInPlayOrder(levels))).toEqual(['level-1', 'level-2', 'level-10', 'tiny']);
    expect(ids(levelsInPlayOrder(levels, 'tiny'))).toEqual(['tiny', 'level-1', 'level-2', 'level-10']);
    expect(() => levelsInPlayOrder(levels, 'nope')).toThrow(/nope/);
  });

  it("pairs a bundle's levels with their profiles", () => {
    const entry = (kind: string, value: { id: string }) => ({
      kind,
      name: value.id,
      file: `${value.id}.json`,
      value,
    });
    const content = {
      manifest: {},
      entries: [...levels.map((l) => entry('level', l)), entry('profile', PROFILE)],
    } as unknown as ContentBundle;
    const stages = contentStages(content, { first: 'tiny' });
    expect(ids(stages.map((s) => s.level))).toEqual(['tiny', 'level-1', 'level-2', 'level-10']);
    expect(stages[0]?.profile).toBe(PROFILE);
    expect(() => contentStages(content, { first: 'nope', who: 'the lab' })).toThrow(
      /the lab has no level "nope"/,
    );
    const empty = { manifest: {}, entries: [] } as unknown as ContentBundle;
    expect(() => contentStages(empty)).toThrow(/has no levels/);
  });

  const campaign = (id: string, entries: object[], start?: string) =>
    campaignSchema.parse({ version: 1, id, entries, ...(start ? { start } : {}) });

  it("plays a campaign's levels in its order, from its start, skipping its missions (Engine 0.10)", () => {
    const main = campaign('main', [
      { level: 'tiny' },
      { mission: 'raid' },
      { level: 'level-10' },
      { level: 'level-1' },
    ]);
    expect(ids(levelsInPlayOrder(levels, undefined, main))).toEqual(['tiny', 'level-10', 'level-1']);
    expect(ids(levelsInPlayOrder(levels, 'level-10', main))).toEqual(['level-10', 'level-1', 'tiny']);
    const started = campaign('main', [{ level: 'tiny' }, { level: 'level-2' }], 'level-2');
    expect(ids(levelsInPlayOrder(levels, undefined, started))).toEqual(['level-2', 'tiny']);
    expect(() => levelsInPlayOrder(levels, undefined, campaign('m', [{ level: 'gone' }]))).toThrow(
      'campaign "m" names level "gone", which is not there',
    );
    expect(() => levelsInPlayOrder(levels, undefined, campaign('m', [{ mission: 'raid' }]))).toThrow(
      'campaign "m" names no level',
    );
  });

  it("uses the bundle's campaign when it has one, else the id order", () => {
    const entry = (kind: string, value: { id: string }) => ({
      kind,
      name: value.id,
      file: `${value.id}.json`,
      value,
    });
    const bundle = (...campaigns: object[]) =>
      ({
        manifest: {},
        entries: [
          ...levels.map((l) => entry('level', l)),
          entry('profile', PROFILE),
          ...campaigns.map((c) => entry('campaign', c as { id: string })),
        ],
      }) as unknown as ContentBundle;
    const forward = campaign('forward', [{ level: 'level-1' }, { level: 'level-2' }, { level: 'level-10' }]);
    const backward = campaign('backward', [
      { level: 'level-10' },
      { level: 'level-2' },
      { level: 'level-1' },
    ]);
    const order = (content: ContentBundle, opts = {}) =>
      ids(contentStages(content, opts).map((s) => s.level));
    expect(order(bundle())).toEqual(['level-1', 'level-2', 'level-10', 'tiny']);
    expect(order(bundle(forward))).toEqual(['level-1', 'level-2', 'level-10']);
    expect(order(bundle(backward))).toEqual(['level-10', 'level-2', 'level-1']);
    expect(order(bundle(forward, backward), { campaign: 'backward' })).toEqual([
      'level-10',
      'level-2',
      'level-1',
    ]);
    expect(() => contentStages(bundle(forward, backward), { who: 'the lab' })).toThrow(
      'the lab has 2 campaigns ("forward", "backward"); name the one to play',
    );
    expect(() => contentStages(bundle(forward), { campaign: 'nope', who: 'the lab' })).toThrow(
      'the lab has no campaign "nope"',
    );
    expect(() => contentStages(bundle(forward), { first: 'tiny', who: 'the lab' })).toThrow(
      'the lab: there is no level "tiny" in campaign "forward"',
    );
  });
});
