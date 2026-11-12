import { describe, expect, it } from 'vitest';
import { validate } from '@engine/core/content/validate';
import {
  freezeFrame,
  isFullMap,
  presentFrameSchema,
  RtsCamera,
  type PresentFrame,
} from '@engine/core/present';
import { battleSnapshot, siegeSnapshot } from './__fixtures__/world';
import {
  keyStatus,
  presentWorld,
  RTS_DEPTH,
  RtsPresentState,
  rtsMissionInfo,
  threatStatus,
  unitAnim,
} from './present';
import { buildingName, unitName, type RtsNames } from './names';
import { readWorld } from './snapshot';

const SIZE = { width: 320, height: 240 };

function valid(frame: PresentFrame): void {
  expect(validate('frame.json', frame, presentFrameSchema).errors).toEqual([]);
  expect(JSON.parse(JSON.stringify(frame))).toEqual(frame);
  freezeFrame(frame);
}

describe('presentWorld', () => {
  const view = readWorld(battleSnapshot({ tick: 5 }));

  it('gives a frame that passes presentFrameSchema, with every part in use', () => {
    const camera = new RtsCamera({ view: SIZE, area: { x: 0, y: 0, w: 128, h: 96 } });
    const frame = presentWorld(view, {
      faction: 'red',
      size: SIZE,
      selection: [3, 6, 7],
      box: { x: 40, y: 40, w: -20, h: 10 },
      placing: { building: 'barracks', cell: { x: 4, y: 3 }, w: 2, h: 2 },
      camera: camera.hint(),
      events: [{ type: 'hit', x: 1, y: 2 }],
      state: new RtsPresentState(),
    });
    valid(frame);
    expect(frame.frame).toBe(5);
    expect(frame.camera).toEqual(camera.hint());
    expect(frame.events).toEqual([{ type: 'hit', x: 1, y: 2 }]);
  });

  it('presents the terrain as a map of type ids, with tags naming the types', () => {
    const frame = presentWorld(view, { faction: 'red', size: SIZE });
    const map = frame.map!;
    expect(isFullMap(map)).toBe(true);
    if (!isFullMap(map)) return;
    expect([map.cols, map.rows, map.tileSize]).toEqual([8, 6, 16]);
    expect(map.tiles[2]).toEqual([1, 1, 1, 0, 1, 1, 1, 1]);
    expect(map.tags).toEqual(['type:0:rock:blocked', 'type:1:ground']);
    // with a state, the full map goes once
    const state = new RtsPresentState();
    expect(isFullMap(presentWorld(view, { faction: 'red', size: SIZE, state }).map!)).toBe(true);
    expect(presentWorld(view, { faction: 'red', size: SIZE, state }).map).toEqual({
      id: 'rts',
      version: map.version,
    });
  });

  it('presents units with 8-way facing, anim state, sides and roles', () => {
    const frame = presentWorld(view, { faction: 'red', size: SIZE });
    const e = (id: string) => frame.entities.find((x) => x.id === id)!;
    expect(e('unit-6')).toMatchObject({
      kind: 'unit:soldier',
      x: 16,
      y: 48,
      w: 16,
      h: 16,
      facing: 'up-right',
    });
    expect(e('unit-6').anim.state).toBe('attack');
    expect(e('unit-6').tags).toEqual(['own', 'faction:red']);
    expect(e('unit-9')).toMatchObject({
      facing: 'left',
      anim: { state: 'walk', t: 5 },
      layer: RTS_DEPTH.unit,
    });
    expect(e('unit-9').tags).toEqual(['enemy', 'faction:blue']);
    expect(e('unit-7').tags).toContain('hero');
    expect(e('unit-5').tags).toContain('carrying');
    expect(e('unit-5').facing).toBe('down');
    // a hurt unit shows its health bar
    expect(e('unit-7/hp')).toMatchObject({ kind: 'health-bar', anim: { state: 'hp-4' } });
    expect(frame.entities.find((x) => x.id === 'unit-6/hp')).toBeUndefined();
    // and the tag `damaged`, for a skin's look by tag; a unit at full hp has none
    expect(e('unit-7').tags).toContain('damaged');
    expect(e('unit-6').tags).not.toContain('damaged');
  });

  it('presents buildings, construction progress and resource nodes', () => {
    const frame = presentWorld(view, { faction: 'red', size: SIZE });
    const e = (id: string) => frame.entities.find((x) => x.id === id)!;
    expect(e('building-8')).toMatchObject({ kind: 'building:barracks', x: 96, y: 0, w: 32, h: 32 });
    expect(e('building-8').anim.state).toBe('site');
    expect(e('building-8').tags).toEqual(['enemy', 'faction:blue', 'site', 'progress:50']);
    expect(e('building-8/progress')).toMatchObject({ kind: 'progress-bar', anim: { state: 'p-4' } });
    expect(e('building-3').anim.state).toBe('train');
    expect(e('building-3').tags).toContain('training:worker');
    expect(e('resource-4')).toMatchObject({ kind: 'resource:gold', tags: ['amount:30'] });
  });

  it('tags what shows a health bar with its numbers, and names the map by mapId (Engine 0.16 F6)', () => {
    const frame = presentWorld(view, { faction: 'red', size: SIZE, selection: [6] });
    const e = (id: string) => frame.entities.find((x) => x.id === id)!;
    // a hurt unit, and a selected one at full health: `hp:<hp>/<max>`, as their bars show
    const hurt = e('unit-7').tags.find((t) => t.startsWith('hp:'));
    expect(hurt).toMatch(/^hp:\d+\/\d+$/);
    expect(e('unit-7/hp')).toBeDefined();
    expect(e('unit-6').tags.filter((t) => t.startsWith('hp:'))).toEqual([
      expect.stringMatching(/^hp:(\d+)\/\1$/),
    ]);
    // no bar, no tag
    expect(e('unit-9').tags.some((t) => t.startsWith('hp:'))).toBe(false);
    expect(frame.map).toMatchObject({ id: 'rts' });
    expect(presentWorld(view, { faction: 'red', size: SIZE, mapId: 'village' }).map).toMatchObject({
      id: 'village',
    });
  });

  it('presents selection rings, the box and the placing ghost as entities', () => {
    const frame = presentWorld(view, {
      faction: 'red',
      size: SIZE,
      selection: [7, 9],
      box: { x: 40, y: 40, w: -20, h: 10 },
      placing: { building: 'barracks', cell: { x: 4, y: 3 }, w: 2, h: 2 },
    });
    const e = (id: string) => frame.entities.find((x) => x.id === id);
    expect(e('unit-7/ring')).toMatchObject({ kind: 'selection-ring', tags: ['own', 'hero'], x: 32, y: 48 });
    expect(e('unit-9/ring')?.tags).toEqual(['enemy']);
    expect(e('unit-6/ring')).toBeUndefined();
    expect(e('select-box')).toMatchObject({ x: 20, y: 40, w: 20, h: 10, layer: RTS_DEPTH.box });
    expect(e('placing')).toMatchObject({ kind: 'ghost:barracks', x: 64, y: 48, w: 32, h: 32 });
  });

  it('gives HUD values: stock, counts, the selection and the training queue', () => {
    const s = presentWorld(view, { faction: 'red', size: SIZE, selection: [3] }).status;
    expect(s).toMatchObject({
      faction: 'red',
      tick: 5,
      'stock.gold': 120,
      units: 3,
      enemyUnits: 2,
      heroes: 1,
      selected: 1,
      selection: 'hall',
      selectedHp: 400,
      queue: 1,
      training: 'worker',
      trainingProgress: 25,
      trainButtons: 'worker',
      placing: '',
    });
    expect(presentWorld(view, { faction: 'red', size: SIZE, selection: [5, 6] }).status['selection']).toBe(
      'mixed',
    );
  });

  it('names the one selected unit: a named person by name and role, else its type (Engine 0.16 F7)', () => {
    const one = (id: number) => presentWorld(view, { faction: 'red', size: SIZE, selection: [id] }).status;
    expect(one(7)).toMatchObject({ selectedName: 'Ada', selectedType: 'soldier', selectedRole: 'hero' });
    expect(one(6)).toMatchObject({ selectedName: 'soldier', selectedType: 'soldier', selectedRole: '' });
    expect(one(3)).toMatchObject({ selectedName: 'hall', selectedType: 'hall', selectedRole: '' });
    expect(presentWorld(view, { faction: 'red', size: SIZE, selection: [5, 6] }).status).not.toHaveProperty(
      'selectedName',
    );
  });

  it('names the selection and the training unit from the display names, else by id (polish Q, D2)', () => {
    const names = { units: { soldier: 'Footman', worker: 'Peasant' }, buildings: { hall: 'Great Hall' } };
    const one = (id: number, n?: RtsNames) =>
      presentWorld(view, { faction: 'red', size: SIZE, selection: [id], ...(n && { names: n }) }).status;
    expect(one(6, names)).toMatchObject({ selectedName: 'Footman', selectedType: 'soldier' });
    expect(one(7, names)).toMatchObject({ selectedName: 'Ada', selectedType: 'soldier' });
    expect(one(3, names)).toMatchObject({
      selectedName: 'Great Hall',
      selectedType: 'hall',
      selection: 'hall',
      training: 'worker',
      trainingName: 'Peasant',
    });
    // An id the table lacks shows as itself; an empty table is no table's names.
    expect(one(3, { units: {}, buildings: {} })).toMatchObject({
      selectedName: 'hall',
      trainingName: 'worker',
    });
    expect(one(5, names)['trainingName']).toBe('');
    // Without the option the status is as before: no trainingName.
    expect(one(3)).toMatchObject({ selectedName: 'hall', training: 'worker' });
    expect(one(3)).not.toHaveProperty('trainingName');
    expect(unitName(undefined, 'archer')).toBe('archer');
    expect(unitName(names, 'toString')).toBe('toString');
    expect(buildingName(names, 'hall')).toBe('Great Hall');
  });

  it("gives each scenario key's health, progress, fate and whether it lives (Engine 0.16 F7)", () => {
    const keys = { hall: 3, ada: 7, works: 8, gone: 99 };
    expect(keyStatus(view, keys)).toEqual({
      'key.ada.hp': 15,
      'key.ada.maxHp': 30,
      'key.ada.fate': 'active',
      'key.ada.name': 'Ada',
      'key.ada.alive': 1,
      'key.gone.alive': 0,
      'key.hall.hp': 400,
      'key.hall.maxHp': 400,
      'key.hall.alive': 1,
      'key.works.hp': 1,
      'key.works.maxHp': 200,
      'key.works.progress': 50,
      'key.works.alive': 1,
    });
    // On the frame, beside the other HUD values; none without a key table.
    expect(presentWorld(view, { faction: 'red', size: SIZE, keys }).status).toMatchObject({
      'key.hall.hp': 400,
    });
    const bare = presentWorld(view, { faction: 'red', size: SIZE }).status;
    expect(Object.keys(bare).some((k) => k.startsWith('key.'))).toBe(false);
  });

  it("says how near the enemy is to the side's buildings, in cells (Engine 0.16 F7)", () => {
    // Blue's soldiers at (6, 4) and (7, 4); red's hall covers (0, 0)-(1, 1).
    expect(threatStatus(view, 'red')).toEqual({ enemyNear: 5 });
    // Red's units at (2, 1), (1, 3) and (2, 3); blue's barracks covers (6, 0)-(7, 1).
    expect(threatStatus(view, 'blue')).toEqual({ enemyNear: 4 });
    expect(threatStatus(view, 'green')).toEqual({});
    expect(presentWorld(view, { faction: 'red', size: SIZE }).status['enemyNear']).toBe(5);
  });

  it('counts anim t from when a state began, with a state', () => {
    const state = new RtsPresentState();
    const at = (tick: number) =>
      presentWorld(readWorld(battleSnapshot({ tick })), { faction: 'red', size: SIZE, state }).entities.find(
        (x) => x.id === 'unit-9',
      )!.anim;
    expect(at(10)).toEqual({ state: 'walk', t: 0 });
    expect(at(13)).toEqual({ state: 'walk', t: 3 });
    expect(unitAnim({ ...readWorld(battleSnapshot()).units[0]!, task: null })).toBe('idle');
    const stopped = { ...readWorld(battleSnapshot()).units[0]!, task: null, target: null, moveWait: 2 };
    expect(unitAnim(stopped)).toBe('idle');
    expect(unitAnim({ ...stopped, target: 4 })).toBe('attack');
  });

  it('only reads the view: presenting does not change it', () => {
    const v = readWorld(battleSnapshot());
    const before = JSON.stringify(v);
    presentWorld(v, { faction: 'red', size: SIZE, selection: [3, 5], state: new RtsPresentState() });
    expect(JSON.stringify(v)).toBe(before);
  });
});

describe('presentWorld: missions (Engine 0.11)', () => {
  const RAID = { id: 'raid', title: 'Burn the siege engines', event: 'siege' };
  const MISSION_KEYS = ['offer', 'offers', 'mission', 'missionCommit', 'missionLeft'];

  it('marks the offered mission on its target and shows the offer in the HUD', () => {
    const frame = presentWorld(readWorld(siegeSnapshot()), {
      faction: 'red',
      size: SIZE,
      missions: [RAID],
      state: new RtsPresentState(),
    });
    valid(frame);
    // the lowest-id enemy member of the event: blue soldier 9 at (6, 4)
    expect(frame.entities.find((e) => e.id === 'offer-raid-window')).toMatchObject({
      kind: 'mission-offer',
      x: 96,
      y: 64,
      w: 16,
      h: 16,
      tags: ['mission:raid', 'opportunity:raid-window', 'target:9'],
      layer: RTS_DEPTH.offer,
    });
    expect(frame.status).toMatchObject({ offers: 1, offer: 'Burn the siege engines' });
    expect(frame.status['mission']).toBeUndefined();
    // nothing is frozen while the mission is only offered
    expect(frame.entities.some((e) => e.tags.includes('frozen'))).toBe(false);
  });

  it('puts the marker on the given entity, a building too; none without the def', () => {
    const view = readWorld(siegeSnapshot());
    const on = (marker: number) =>
      presentWorld(view, { faction: 'red', size: SIZE, missions: [{ ...RAID, marker }] }).entities.find(
        (e) => e.kind === 'mission-offer',
      );
    expect(on(8)).toMatchObject({ x: 96, y: 0, w: 32, h: 32, tags: expect.arrayContaining(['target:8']) });
    expect(on(99)?.tags).toContain('target:9'); // not in the view: the event's enemy member
    const bare = presentWorld(view, { faction: 'red', size: SIZE });
    expect(bare.entities.some((e) => e.kind === 'mission-offer')).toBe(false);
    expect(bare.status['offer']).toBe('raid'); // the id without a title
  });

  it('puts the marker on the entity a scenario key names, through the key table (gap M25)', () => {
    const view = readWorld(siegeSnapshot());
    const on = (marker: string, keys?: Record<string, number>) =>
      presentWorld(view, {
        faction: 'red',
        size: SIZE,
        missions: [rtsMissionInfo({ ...RAID, marker })],
        ...(keys ? { keys } : {}),
      }).entities.find((e) => e.kind === 'mission-offer');
    expect(on('works', { works: 8 })?.tags).toContain('target:8');
    // A key the table lacks, or no table: the marker is where it would be without one.
    expect(on('works', { other: 8 })?.tags).toContain('target:9');
    expect(on('works')?.tags).toContain('target:9');
  });

  it("tags the frozen event's units and buildings and shows the open mission's commit tick", () => {
    const frame = presentWorld(readWorld(siegeSnapshot({ open: true, tick: 10 })), {
      faction: 'red',
      size: SIZE,
      missions: [RAID],
    });
    valid(frame);
    const frozen = frame.entities.filter((e) => e.tags.includes('frozen')).map((e) => e.id);
    expect(frozen).toEqual(['building-8', 'unit-6', 'unit-9', 'unit-10']);
    expect(frame.entities.some((e) => e.kind === 'mission-offer')).toBe(false);
    expect(frame.status).toMatchObject({
      mission: 'Burn the siege engines',
      missionCommit: 33,
      missionLeft: 23,
    });
    expect(frame.status['offers']).toBeUndefined();
    // the site keeps its progress while frozen (the sim builds it; the kit only shows it)
    expect(frame.entities.find((e) => e.id === 'building-8')?.tags).toEqual(
      expect.arrayContaining(['site', 'progress:50', 'frozen']),
    );
  });

  it('a world without missions gives the frame it gave before: no marker, tag or HUD key', () => {
    const frame = presentWorld(readWorld(battleSnapshot({ tick: 5 })), {
      faction: 'red',
      size: SIZE,
      missions: [RAID],
    });
    expect(frame.entities.some((e) => e.kind === 'mission-offer' || e.tags.includes('frozen'))).toBe(false);
    for (const key of MISSION_KEYS) expect(Object.hasOwn(frame.status, key), key).toBe(false);
  });
});

describe('in-world feedback (Engine 0.16 part D, D5)', () => {
  const ids = (frame: PresentFrame) => frame.entities.map((e) => e.id);

  it("shows an own building's training as a progress bar under it, tagged with the queue", () => {
    const view = readWorld(battleSnapshot({ tick: 5 }));
    // The hall trains a worker: 3 of 12 ticks; two more queued.
    view.buildings
      .find((b) => b.id === 3)!
      .producer!.queue.push({ unit: 'worker', ticks: 12 }, { unit: 'worker', ticks: 12 });
    const frame = presentWorld(view, { faction: 'red', size: SIZE });
    valid(frame);
    const bar = frame.entities.find((e) => e.id === 'building-3/train')!;
    expect(bar).toMatchObject({ kind: 'progress-bar', x: 0, y: 33, w: 32, h: 2, layer: RTS_DEPTH.bar });
    expect(bar.anim.state).toBe('p-2');
    expect(bar.tags).toEqual(['train', 'training:worker', 'queue:3']);
    // The enemy's training is not shown, nor an idle building's.
    expect(ids(presentWorld(view, { faction: 'blue', size: SIZE }))).not.toContain('building-3/train');
    view.buildings.find((b) => b.id === 3)!.producer!.queue.length = 0;
    expect(ids(presentWorld(view, { faction: 'red', size: SIZE }))).not.toContain('building-3/train');
  });

  it("shows a selected own unit's path as dots, the goal last", () => {
    const view = readWorld(battleSnapshot({ tick: 5 }));
    const soldier = view.units.find((u) => u.id === 6)!;
    soldier.goal = { x: 4, y: 3 };
    soldier.path = [
      { x: 2, y: 4 },
      { x: 3, y: 4 },
      { x: 4, y: 3 },
    ];
    expect(ids(presentWorld(view, { faction: 'red', size: SIZE })).some((id) => id.includes('/path-'))).toBe(
      false,
    );
    const frame = presentWorld(view, { faction: 'red', size: SIZE, selection: [6, 9] });
    valid(frame);
    const dots = frame.entities.filter((e) => e.kind === 'path-dot');
    expect(dots.map((d) => [d.id, d.x, d.y, d.anim.state])).toEqual([
      ['unit-6/path-0', 38, 70, 'idle'],
      ['unit-6/path-1', 54, 70, 'idle'],
      ['unit-6/path-2', 70, 54, 'goal'],
    ]);
    expect(dots[2]!.tags).toEqual(['own', 'goal']);
    expect(dots.every((d) => d.w === 4 && d.layer === RTS_DEPTH.path)).toBe(true);
    // Blue's unit 9 has a move goal but is not the player's: no dots. A goal without a path is one dot.
    delete soldier.path;
    const goalOnly = presentWorld(view, { faction: 'red', size: SIZE, selection: [6] });
    expect(goalOnly.entities.filter((e) => e.kind === 'path-dot').map((d) => d.id)).toEqual([
      'unit-6/path-0',
    ]);
  });

  it('shows accepted orders as fading markers and sends their barks once', () => {
    const state = new RtsPresentState();
    const view = (tick: number) => readWorld(battleSnapshot({ tick }));
    const bark = {
      type: 'bark',
      side: 'own',
      order: 'move',
      unitType: 'soldier',
      entity: 'unit-6',
      x: 24,
      y: 56,
    };
    state.accept({ marker: { kind: 'move', x: 4, y: 4, w: 1, h: 1, entity: null }, events: [bark] }, 5);
    state.accept({ marker: { kind: 'attack', x: 0, y: 0, w: 1, h: 1, entity: 9 }, events: [] }, 6);
    const first = presentWorld(view(6), { faction: 'red', size: SIZE, state, events: [{ type: 'hit' }] });
    valid(first);
    expect(first.events).toEqual([{ type: 'hit' }, bark]);
    const markers = first.entities.filter((e) => e.kind === 'order-marker');
    expect(markers.map((m) => [m.id, m.anim.state, m.anim.t, m.x, m.y, m.tags])).toEqual([
      ['marker-1', 'move', 1, 64, 64, ['move', 'fade:7']],
      // The attack marker follows its target, blue's soldier at (6,4).
      ['marker-2', 'attack', 0, 96, 64, ['attack', 'fade:8']],
    ]);
    expect(markers.every((m) => m.layer === RTS_DEPTH.marker)).toBe(true);
    // The barks went with the first frame; the move marker is gone after 8 ticks.
    const later = presentWorld(view(13), { faction: 'red', size: SIZE, state });
    expect(later.events).toEqual([]);
    expect(later.entities.filter((e) => e.kind === 'order-marker').map((m) => m.id)).toEqual(['marker-2']);
    expect(
      presentWorld(view(14), { faction: 'red', size: SIZE, state }).entities.some(
        (e) => e.kind === 'order-marker',
      ),
    ).toBe(false);
  });
});
