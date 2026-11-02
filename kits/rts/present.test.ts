import { describe, expect, it } from 'vitest';
import { validate } from '@engine/core/content/validate';
import {
  freezeFrame,
  isFullMap,
  presentFrameSchema,
  RtsCamera,
  type PresentFrame,
} from '@engine/core/present';
import { battleSnapshot } from './__fixtures__/world';
import { presentWorld, RTS_DEPTH, RtsPresentState, unitAnim } from './present';
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

  it('counts anim t from when a state began, with a state', () => {
    const state = new RtsPresentState();
    const at = (tick: number) =>
      presentWorld(readWorld(battleSnapshot({ tick })), { faction: 'red', size: SIZE, state }).entities.find(
        (x) => x.id === 'unit-9',
      )!.anim;
    expect(at(10)).toEqual({ state: 'walk', t: 0 });
    expect(at(13)).toEqual({ state: 'walk', t: 3 });
    expect(unitAnim({ ...readWorld(battleSnapshot()).units[0]!, task: null })).toBe('idle');
  });

  it('only reads the view: presenting does not change it', () => {
    const v = readWorld(battleSnapshot());
    const before = JSON.stringify(v);
    presentWorld(v, { faction: 'red', size: SIZE, selection: [3, 5], state: new RtsPresentState() });
    expect(JSON.stringify(v)).toBe(before);
  });
});
