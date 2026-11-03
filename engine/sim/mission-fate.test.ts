import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../core/headless';
import type { MissionDef } from '../core/missions';
import { Health, Inventory, Position, Squad } from './components';
import { Fate, fateOf } from './fate';
import {
  commitMission,
  delegateMission,
  missionsOf,
  openMission,
  playMission,
  quitMission,
  settleMissions,
} from './mission';
import { opportunitiesOf } from './opportunity';
import { Unit } from './rts';
import { loadWorld, saveWorld } from './save';
import { scenarioKeys, worldFromScenario } from './scenario';
import { SYSTEM_SETS } from './system-sets';
import type { Entity, World } from './world';

// Fate effects and capture follow-ups (Engine 0.13 T3; docs/BUILD-LOG.md, Engine 0.13, decision 2,
// item 221) over the captive fixture: `ambush` captures the captain and opens a rescue, an
// exchange and a leave-behind in one exclusive group; a failed rescue opens a dearer ransom.

const DIR = new URL('./__fixtures__/', import.meta.url);
const read = (name: string): unknown => JSON.parse(readFileSync(new URL(name, DIR), 'utf8')) as unknown;
const SCENARIO = read('captive.world.json');
const mission = (id: string): MissionDef => read(`${id}.mission.json`) as MissionDef;
const FOLLOW_UPS = ['rescue-window', 'exchange-window', 'leave-window'];

const hash = (world: World): string =>
  createHash('sha256').update(world.canonical()).digest('hex').slice(0, 16);

function captive(): { world: World; refs: Record<string, Entity> } {
  return { world: worldFromScenario(SCENARIO), refs: scenarioKeys(SCENARIO) };
}

function open(world: World, refs: Record<string, Entity>, id: string): void {
  const r = openMission(world, mission(id), { refs });
  if (!r.ok) throw new Error(`${id}: ${r.error}`);
}

/** The captive world after `ambush` was delegated at tick 2 and committed (captain captured). */
function captured(): { world: World; refs: Record<string, Entity> } {
  const made = captive();
  made.world.step();
  made.world.step();
  open(made.world, made.refs, 'ambush');
  expect(delegateMission(made.world, 'ambush').ok).toBe(true);
  const done = commitMission(made.world, 'ambush');
  if (!done.ok) throw new Error(done.error);
  return made;
}

const status = (world: World, id: string) => opportunitiesOf(world).status(id);

describe('a delegated capture', () => {
  it('captures the captain at the commit, keeping his hp, and opens the three follow-ups', () => {
    const { world, refs } = captured();
    const captain = refs['captain'] as Entity;
    const record = missionsOf(world).record('ambush');
    expect(record?.outcome).toBe('taken');
    expect(record?.resolution).toBe('delegated');
    expect(record?.skipped).toEqual([]);
    expect(fateOf(world, captain)).toMatchObject({ state: 'captured', by: 'raiders', at: 12 });
    expect(world.get(captain, Fate)?.history.map((h) => h.cause)).toEqual(['mission:ambush']);
    expect(world.get(captain, Health)).toEqual({ hp: 20, max: 30 });
    expect(world.has(captain, Position)).toBe(false);
    expect(world.get(refs['guard'] as Entity, Squad)).toMatchObject({ strength: 5, captain: null });
    for (const id of FOLLOW_UPS) {
      expect(status(world, id)).toBe('offered');
      expect(opportunitiesOf(world).get(id)).toMatchObject({ opens: 12, closes: 52, by: 'mission:ambush' });
    }
    expect(status(world, 'ransom-window')).toBe('dormant');
  });

  it.each([
    ['rescue-captain', 'rescue-window'],
    ['exchange-captain', 'exchange-window'],
    ['leave-captain', 'leave-window'],
  ])('taking %s closes its rivals (one exclusive group)', (id, window) => {
    const { world, refs } = captured();
    open(world, refs, id);
    expect(status(world, window)).toBe('taken');
    for (const other of FOLLOW_UPS.filter((w) => w !== window)) {
      expect(status(world, other)).toBe('closed');
      expect(opportunitiesOf(world).get(other)?.by).toBe(`mission:${id}`);
    }
    for (const other of ['rescue-captain', 'exchange-captain', 'leave-captain'].filter((m) => m !== id)) {
      const r = openMission(world, mission(other), { refs });
      expect(r.ok ? null : r.code).toBe('opportunity_closed');
    }
  });
});

describe('the follow-ups', () => {
  it('a played rescue frees the captain on his cell with his hp and unit kept', () => {
    const { world, refs } = captured();
    const captain = refs['captain'] as Entity;
    open(world, refs, 'rescue-captain');
    expect(playMission(world, 'rescue-captain', 'freed').ok).toBe(true);
    const done = commitMission(world, 'rescue-captain');
    expect(done.ok && done.record.skipped).toEqual([]);
    expect(fateOf(world, captain)?.state).toBe('freed');
    expect(fateOf(world, captain)?.history.map((h) => `${h.state} ${h.cause}`)).toEqual([
      'captured mission:ambush',
      'freed mission:rescue-captain',
    ]);
    expect(world.get(captain, Health)).toEqual({ hp: 20, max: 30 });
    expect(world.get(captain, Position)).toEqual({ x: 1, y: 1, z: 0 });
    expect(world.get(captain, Unit)?.type).toBe('soldier');
    // Freed, he joins no squad.
    expect(world.get(refs['guard'] as Entity, Squad)?.members).toEqual([refs['sergeant']]);
  });

  it('a failed rescue is an ordinary outcome: it opens the ransom and never reopens the rescue', () => {
    const { world, refs } = captured();
    const sergeant = refs['sergeant'] as Entity;
    open(world, refs, 'rescue-captain');
    expect(delegateMission(world, 'rescue-captain').ok).toBe(true);
    const done = commitMission(world, 'rescue-captain');
    expect(done.ok && done.record.outcome).toBe('failed');
    expect(fateOf(world, refs['captain'] as Entity)?.state).toBe('captured');
    expect(fateOf(world, sergeant)?.state).toBe('injured');
    expect(world.get(sergeant, Health)?.hp).toBe(18);
    expect(status(world, 'ransom-window')).toBe('offered');
    expect(status(world, 'rescue-window')).toBe('taken');
    for (const [id, code] of [
      ['rescue-captain', 'mission_committed'],
      ['exchange-captain', 'opportunity_closed'],
      ['leave-captain', 'opportunity_closed'],
    ] as const) {
      const r = openMission(world, mission(id), { refs });
      expect(r.ok ? null : r.code).toBe(code);
    }
    expect(delegateMission(world, 'rescue-captain').ok ? null : 'refused').toBe('refused');
    // The ransom it opened is paid from the stockpile and frees him.
    open(world, refs, 'ransom-captain');
    expect(delegateMission(world, 'ransom-captain').ok).toBe(true);
    expect(commitMission(world, 'ransom-captain').ok).toBe(true);
    expect(world.get(refs['hall'] as Entity, Inventory)).toEqual({ gold: 50 });
    expect(fateOf(world, refs['captain'] as Entity)?.state).toBe('freed');
  });

  it('an exchange is a choice: only delegated, it pays from the stockpile and frees him', () => {
    const { world, refs } = captured();
    open(world, refs, 'exchange-captain');
    for (const r of [playMission(world, 'exchange-captain', 'paid'), quitMission(world, 'exchange-captain')])
      expect(r.ok ? null : r.code).toBe('not_playable');
    expect(delegateMission(world, 'exchange-captain').ok).toBe(true);
    expect(commitMission(world, 'exchange-captain').ok).toBe(true);
    expect(world.get(refs['hall'] as Entity, Inventory)).toEqual({ gold: 120 });
    expect(fateOf(world, refs['captain'] as Entity)?.state).toBe('freed');
  });

  it('leaving him behind changes nothing: the capture stands, and every follow-up is gone', () => {
    const { world, refs } = captured();
    const captain = refs['captain'] as Entity;
    const before = world.get(captain, Fate);
    open(world, refs, 'leave-captain');
    expect(delegateMission(world, 'leave-captain').ok).toBe(true);
    const done = commitMission(world, 'leave-captain');
    expect(done.ok && done.record.outcome).toBe('left');
    expect(world.get(captain, Fate)).toEqual(before);
    for (let i = 0; i < 60; i++) world.step();
    expect(world.get(captain, Fate)).toEqual(before);
    expect(FOLLOW_UPS.map((id) => status(world, id))).toEqual(['closed', 'closed', 'taken']);
  });
});

describe('fate effects', () => {
  const DOOM: MissionDef = {
    id: 'doom',
    title: 'A bad night',
    worldTimeCost: 1,
    onQuit: 'night',
    outcomes: [
      {
        id: 'night',
        title: 'Everything goes wrong',
        weight: 1,
        effects: [
          { type: 'fate', entity: 'captain', fate: 'dead', by: 'raiders' },
          { type: 'fate', entity: 'captain', fate: 'injured' },
          { type: 'fate', entity: 'captain', fate: 'freed', at: { x: 1, y: 1 } },
          { type: 'fate', entity: 'hall', fate: 'captured' },
          { type: 'destroy', entity: 'sergeant' },
          { type: 'fate', entity: 'sergeant', fate: 'dead' },
          { type: 'fate', entity: 99, fate: 'injured' },
        ],
      },
    ],
  };

  it('skips, never errors, a fate that cannot apply: after a death, on no named person, on one gone', () => {
    const { world, refs } = captive();
    const ok = openMission(world, DOOM, { refs });
    expect(ok.ok).toBe(true);
    expect(delegateMission(world, 'doom').ok).toBe(true);
    const done = commitMission(world, 'doom');
    if (!done.ok) throw new Error(done.error);
    expect(done.record.skipped).toEqual(DOOM.outcomes[0]?.effects.filter((_, i) => ![0, 4].includes(i)));
    const captain = refs['captain'] as Entity;
    expect(fateOf(world, captain)).toMatchObject({ state: 'dead', by: 'raiders' });
    expect(world.get(captain, Health)?.hp).toBe(0);
  });

  it('skips a freed onto a cell that cannot be entered, leaving the captive held', () => {
    const { world, refs } = captured();
    const def = mission('exchange-captain');
    const rock = {
      ...def,
      outcomes: def.outcomes.map((o) => ({
        ...o,
        effects: o.effects.map((e) => (e.type === 'fate' ? { ...e, at: { x: 3, y: 2 } } : e)),
      })),
    };
    expect(openMission(world, rock, { refs }).ok).toBe(true);
    delegateMission(world, 'exchange-captain');
    const done = commitMission(world, 'exchange-captain');
    expect(done.ok && done.record.skipped.map((e) => e.type)).toEqual(['fate']);
    expect(fateOf(world, refs['captain'] as Entity)?.state).toBe('captured');
  });

  it('refuses at open a fate effect naming a key not in refs, and an outcome reopening its own opportunity', () => {
    const { world, refs } = captive();
    const noKey = {
      ...DOOM,
      outcomes: [{ ...DOOM.outcomes[0], effects: [{ type: 'fate', entity: 'nobody', fate: 'dead' }] }],
    };
    const r1 = openMission(world, noKey, { refs });
    expect(r1.ok ? null : r1.code).toBe('unknown_ref');
    const rescue = mission('rescue-captain');
    const again = {
      ...rescue,
      outcomes: [
        ...rescue.outcomes,
        {
          id: 'again',
          title: 'Try again',
          weight: 1,
          effects: [{ type: 'opportunity', open: 'rescue-window' }],
        },
      ],
    };
    const r2 = openMission(world, again, { refs });
    expect(r2.ok ? null : r2.code).toBe('reopens_self');
    expect(missionsOf(world).open()).toEqual([]);
  });
});

describe('repeatable and saved', () => {
  /** Capture, a failed rescue and the ransom, one hash per tick to tick 45. */
  function chain(saveAt?: number): string[] {
    let { world } = captive();
    const { refs } = captive();
    const hashes: string[] = [];
    const at = (tick: number, fn: () => void) => {
      if (world.tick === tick) fn();
    };
    while (world.tick < 45) {
      if (world.tick === saveAt) {
        world = loadWorld(JSON.parse(canonicalJson(saveWorld(world))) as unknown, SYSTEM_SETS.rts);
      }
      at(2, () => {
        open(world, refs, 'ambush');
        delegateMission(world, 'ambush');
      });
      at(14, () => {
        open(world, refs, 'rescue-captain');
        delegateMission(world, 'rescue-captain');
      });
      at(31, () => {
        open(world, refs, 'ransom-captain');
        delegateMission(world, 'ransom-captain');
      });
      world.step();
      settleMissions(world);
      hashes.push(hash(world));
    }
    expect(
      missionsOf(world)
        .committed()
        .map((r) => r.outcome),
    ).toEqual(['taken', 'failed', 'paid']);
    return hashes;
  }

  it('gives the same hashes on every run, and the same after a save and load at any of five ticks', () => {
    const first = chain();
    expect(chain()).toEqual(first);
    for (const tick of [0, 12, 13, 29, 33]) expect(chain(tick)).toEqual(first);
  });

  it('keeps committed records and fates unchanged after save and load', () => {
    const { world, refs } = captured();
    open(world, refs, 'rescue-captain');
    delegateMission(world, 'rescue-captain');
    commitMission(world, 'rescue-captain');
    const records = canonicalJson(missionsOf(world).committed() as never);
    const fates = canonicalJson(world.snapshot().components['Fate'] as never);
    const back = loadWorld(JSON.parse(canonicalJson(saveWorld(world))) as unknown, SYSTEM_SETS.rts);
    for (let i = 0; i < 20; i++) back.step();
    expect(canonicalJson(missionsOf(back).committed() as never)).toBe(records);
    expect(canonicalJson(back.snapshot().components['Fate'] as never)).toBe(fates);
  });
});
