import { describe, expect, it } from 'vitest';
import { validate } from '@engine/core/content/validate';
import { presentFrameSchema } from '@engine/core/present';
import { battleSnapshot } from './__fixtures__/world';
import { barkEvent, RtsEventTracker, rtsEvents } from './events';
import { presentWorld } from './present';
import { readWorld, type RtsView } from './snapshot';

/** The battle fixture at `tick`, changed by `edit`. */
function view(tick: number, edit: (v: RtsView) => void = () => {}): RtsView {
  const v = readWorld(battleSnapshot({ tick }));
  edit(v);
  return v;
}

describe('rtsEvents', () => {
  it('gives nothing for two equal views', () => {
    expect(rtsEvents(view(1), view(2), 'red')).toEqual([]);
  });

  it('reads units appearing, falling and hurt, with the side for the player', () => {
    const after = view(2, (v) => {
      v.units = v.units.filter((u) => u.id !== 9); // a blue soldier falls
      v.units.find((u) => u.id === 6)!.hp = 26; // a red soldier hit for 4
      v.units.push({ ...v.units.find((u) => u.id === 5)!, id: 11, x: 1, y: 2 }); // a new red worker
    });
    expect(rtsEvents(view(1), after, 'red')).toEqual([
      { type: 'unit-ready', side: 'own', entity: 'unit-11', unitType: 'worker', x: 24, y: 40 },
      { type: 'unit-down', side: 'enemy', entity: 'unit-9', unitType: 'soldier', x: 104, y: 72 },
      { type: 'unit-hit', side: 'own', entity: 'unit-6', damage: 4, x: 24, y: 56 },
    ]);
    // The same change seen by blue: the sides swap.
    expect(rtsEvents(view(1), after, 'blue').map((e) => e['side'])).toEqual(['enemy', 'own', 'enemy']);
  });

  it('reads a site placed, a building finished, hit and gone, and gold dropped off', () => {
    const before = view(1);
    const site = view(2, (v) => {
      v.buildings.push({ ...v.buildings.find((b) => b.id === 8)!, id: 12, faction: 'red', x: 0, y: 4 });
      v.stock['red']!['gold'] = 125;
    });
    expect(rtsEvents(before, site, 'red')).toEqual([
      { type: 'site-placed', side: 'own', entity: 'building-12', kind: 'barracks', x: 16, y: 80 },
      { type: 'stock-up', side: 'own', item: 'gold', amount: 5 },
    ]);
    const done = view(3, (v) => {
      v.buildings.find((b) => b.id === 8)!.construction = { progress: 30, work: 30, done: true };
      v.buildings.find((b) => b.id === 3)!.hp = 390;
    });
    expect(rtsEvents(before, done, 'red')).toEqual([
      { type: 'building-done', side: 'enemy', entity: 'building-8', kind: 'barracks', x: 112, y: 16 },
      { type: 'building-hit', side: 'own', entity: 'building-3', damage: 10, x: 16, y: 16 },
    ]);
    const gone = view(4, (v) => {
      v.buildings = v.buildings.filter((b) => b.id !== 3);
    });
    expect(rtsEvents(before, gone, 'red')).toEqual([
      { type: 'building-down', side: 'own', entity: 'building-3', kind: 'hall', x: 16, y: 16 },
    ]);
  });

  it('gives events a frame carries (presentFrameSchema)', () => {
    const after = view(2, (v) => {
      v.units = v.units.filter((u) => u.id !== 9);
    });
    const frame = presentWorld(after, {
      faction: 'red',
      size: { width: 320, height: 240 },
      events: rtsEvents(view(1), after, 'red'),
    });
    expect(frame.events).toHaveLength(1);
    expect(validate('frame.json', frame, presentFrameSchema).errors).toEqual([]);
  });
});

describe('RtsEventTracker', () => {
  it('gives nothing for the first view or another of the same tick, then the change', () => {
    const t = new RtsEventTracker('red');
    expect(t.next(view(1))).toEqual([]);
    const fallen = view(1, (v) => (v.units = v.units.filter((u) => u.id !== 10)));
    expect(t.next(fallen)).toEqual([]);
    const later = view(2, (v) => (v.units = v.units.filter((u) => u.id !== 10)));
    expect(t.next(later).map((e) => e.type)).toEqual(['unit-down']);
    expect(t.next(view(3, (v) => (v.units = v.units.filter((u) => u.id !== 10))))).toEqual([]);
    t.reset();
    expect(t.next(view(4))).toEqual([]);
  });
});

describe('barkEvent', () => {
  const v = view(3);

  it("names the order, the first unit's type, its entity and box centre, for the player's side", () => {
    expect(barkEvent(v, { faction: 'red', type: 'attack', units: [7, 6], target: 9 }, 'red')).toEqual({
      type: 'bark',
      side: 'own',
      order: 'attack',
      unitType: 'soldier',
      entity: 'unit-7',
      x: 40,
      y: 56,
    });
    expect(barkEvent(v, { faction: 'red', type: 'gather', units: [5], target: 4 }, 'red', 8)).toMatchObject({
      order: 'gather',
      unitType: 'worker',
      x: 20,
      y: 12,
    });
    expect(barkEvent(v, { faction: 'blue', type: 'stop', units: [9] }, 'red')).toMatchObject({
      side: 'enemy',
    });
  });

  it('barks a train order from the building, with the type trained; null without a unit in the view', () => {
    expect(
      barkEvent(v, { faction: 'red', type: 'train', units: [3], target: 'worker' }, 'red'),
    ).toMatchObject({
      order: 'train',
      unitType: 'worker',
      kind: 'hall',
      entity: 'building-3',
    });
    expect(
      barkEvent(v, { faction: 'red', type: 'move', units: [99], target: { x: 1, y: 1 } }, 'red'),
    ).toBeNull();
  });

  it('passes presentFrameSchema as a frame event', () => {
    const bark = barkEvent(v, { faction: 'red', type: 'move', units: [6], target: { x: 3, y: 3 } }, 'red')!;
    const frame = presentWorld(v, { faction: 'red', size: { width: 64, height: 64 }, events: [bark] });
    expect(validate('frame.json', frame, presentFrameSchema).errors).toEqual([]);
  });
});
