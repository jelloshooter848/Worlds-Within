import { describe, expect, it } from 'vitest';
import { durationText } from './clock';
import type { MissionDef, MissionRecord } from './missions';
import {
  buildingText,
  changeLines,
  changeSections,
  displayName,
  lossText,
  missionChips,
  NO_CARD_FACTS,
  noChanges,
  personText,
  windowText,
  type WorldChanges,
} from './world-changes';

// The text the in-picture mission screens show of the world's changes and a mission's card
// (Engine 0.16 F5). The sim computes the changes (`engine/sim/world-changes.test.ts`).

const SABOTAGE: MissionDef = {
  id: 'sabotage',
  title: 'Burn the siege engines',
  worldTimeCost: 120,
  onQuit: 'driven-off',
  outcomes: [{ id: 'driven-off', title: 'Driven off', weight: 1, effects: [] }],
};

const RECORD: MissionRecord = {
  mission: 'sabotage',
  outcome: 'driven-off',
  effects: [],
  resolution: 'quit',
  openTick: 40,
  commitTick: 160,
  experienceTicks: 0,
  skipped: [],
};

describe('durationText', () => {
  it('writes world ticks as hours and minutes on the clock', () => {
    expect(durationText(120)).toBe('2 hours');
    expect(durationText(60)).toBe('1 hour');
    expect(durationText(90)).toBe('1 hour 30 min');
    expect(durationText(40)).toBe('40 min');
    expect(durationText(0)).toBe('0 min');
    expect(durationText(10, 20)).toBe('30 min');
  });
});

describe('the changes as text', () => {
  const changes: WorldChanges = {
    since: 40,
    tick: 260,
    records: [RECORD],
    losses: [
      {
        faction: 'raiders',
        units: [
          { entity: 5, key: null, name: null, type: 'raider' },
          { entity: 6, key: null, name: null, type: 'raider' },
          { entity: 7, key: 'ram', name: null, type: 'ram' },
          { entity: 8, key: 'guard-1', name: 'Grell', type: 'raider' },
        ],
      },
    ],
    people: [
      {
        entity: 3,
        key: 'captain',
        name: 'Captain Hale',
        faction: 'village',
        was: 'active',
        fate: 'captured',
        by: 'raiders',
      },
      { entity: 4, key: null, name: 'Mara', faction: 'village', was: 'captured', fate: 'freed', by: null },
    ],
    buildings: [
      {
        entity: 1,
        key: 'hall',
        kind: 'hall',
        faction: 'village',
        destroyed: false,
        hp: 280,
        max: 400,
        lost: 120,
      },
      {
        entity: 2,
        key: 'north-wall',
        kind: 'wall',
        faction: 'village',
        destroyed: true,
        hp: 0,
        max: 80,
        lost: 80,
      },
    ],
  };

  it('counts units of a type and names people, factions and keys as words', () => {
    expect(lossText(changes.losses[0]!.units)).toBe('2 raiders, ram, Grell');
    expect(displayName('north-wall')).toBe('North wall');
    expect(personText(changes.people[0]!)).toBe('Captain Hale: captured by raiders');
    expect(personText(changes.people[1]!)).toBe('Mara: freed');
    expect(buildingText(changes.buildings[0]!)).toBe('Hall: 120 hp lost (280/400)');
    expect(buildingText(changes.buildings[1]!)).toBe('North wall: destroyed');
  });

  it('writes one unit of a type bare, more with a count and the plural, and never counts named people', () => {
    const u = (entity: number, type: string, name: string | null = null) => ({
      entity,
      key: null,
      name,
      type,
    });
    expect(lossText([u(1, 'soldier')])).toBe('soldier');
    expect(lossText([u(1, 'soldier'), u(2, 'soldier')])).toBe('2 soldiers');
    expect(lossText([u(1, 'raider'), u(2, 'ram'), u(3, 'raider'), u(4, 'raider'), u(5, 'raider')])).toBe(
      '4 raiders, ram',
    );
    expect(lossText([u(1, 'raider', 'Grell'), u(2, 'raider', 'Grell'), u(3, 'raider')])).toBe(
      'Grell, Grell, raider',
    );
    expect(lossText([])).toBe('');
  });

  it('gives the sections in order with the outcome titles, leaving empty ones out', () => {
    expect(changeSections(changes, { title: () => 'Driven off' })).toEqual([
      { heading: 'Missions', lines: ['Driven off (quit)'] },
      { heading: 'Losses', lines: ['Raiders: 2 raiders, ram, Grell'] },
      { heading: 'People', lines: ['Captain Hale: captured by raiders', 'Mara: freed'] },
      { heading: 'Buildings', lines: ['Hall: 120 hp lost (280/400)', 'North wall: destroyed'] },
    ]);
    expect(changeLines(changes)[0]).toBe('driven-off (quit)');
    expect(changeSections(noChanges(0, 5))).toEqual([]);
  });
});

describe("a mission card's chips", () => {
  it('gives the cost on the clock, the hero and the foes, and the window line', () => {
    const facts = { hero: 'Captain Hale', foes: 'ram, catapult', ticksLeft: 136 };
    expect(missionChips(SABOTAGE, facts)).toEqual([
      'Costs 2 hours of world time',
      'Hero Captain Hale',
      'Foes ram, catapult',
    ]);
    expect(missionChips(SABOTAGE, NO_CARD_FACTS, 120)).toEqual(['Costs 1 hour of world time']);
    expect(windowText(facts)).toBe('Window closes in 136 ticks');
    expect(windowText({ ...facts, ticksLeft: 1 })).toBe('Window closes in 1 tick');
    expect(windowText(NO_CARD_FACTS)).toBe('');
  });
});
