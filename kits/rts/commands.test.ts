import { describe, expect, it } from 'vitest';
import { parseOrder } from '@engine/core/orders';
import { RuleSwitch } from '@engine/core/rules';
import { battleSnapshot } from './__fixtures__/world';
import { buildCommand, commandAt, stampOrder, stopCommand, trainButtons, trainCommand } from './commands';
import { RTS_RULES } from './rules';
import { Selection } from './selection';
import { readWorld } from './snapshot';

const TS = 16;
const at = (x: number, y: number) => ({ x: x * TS + 3, y: y * TS + 12 });

/** The draft stamped with an id, checked against the engine's order schema. */
function valid(draft: unknown, id = 1) {
  const r = parseOrder({ id, ...(draft as object) });
  if (!r.ok) throw new Error(r.error);
  return r.order;
}

describe('command mapper', () => {
  const view = readWorld(battleSnapshot());
  const sel = (ids: number[]) => {
    const s = new Selection('red');
    s.set(ids);
    return s;
  };

  it('a command on ground moves the selected own units there', () => {
    expect(valid(commandAt(view, sel([6, 7, 9]), at(5, 2), TS))).toEqual({
      id: 1,
      faction: 'red',
      type: 'move',
      units: [6, 7],
      target: { x: 5, y: 2 },
    });
  });

  it('a command on an enemy unit or building attacks it', () => {
    expect(valid(commandAt(view, sel([6, 7]), at(7, 4), TS))).toMatchObject({
      type: 'attack',
      units: [6, 7],
      target: 10,
    });
    expect(valid(commandAt(view, sel([6]), at(7, 1), TS))).toMatchObject({ type: 'attack', target: 8 });
  });

  it('a command on a resource node sends the gatherers to gather, the rest move', () => {
    expect(valid(commandAt(view, sel([5, 6]), at(4, 0), TS))).toMatchObject({
      type: 'gather',
      units: [5],
      target: 4,
    });
    expect(valid(commandAt(view, sel([6]), at(4, 0), TS))).toMatchObject({
      type: 'move',
      target: { x: 4, y: 0 },
    });
  });

  it('a command on an own unit or building moves there', () => {
    expect(valid(commandAt(view, sel([6]), at(0, 0), TS))).toMatchObject({
      type: 'move',
      target: { x: 0, y: 0 },
    });
  });

  it('with the command rules off, enemies and nodes are only walked to (the mutants)', () => {
    const rules = new RuleSwitch(RTS_RULES, ['command-attacks-enemies', 'command-gathers-resources']);
    expect(commandAt(view, sel([6]), at(7, 4), TS, rules)).toMatchObject({ type: 'move' });
    expect(commandAt(view, sel([5]), at(4, 0), TS, rules)).toMatchObject({ type: 'move' });
  });

  it('nothing own selected: no command', () => {
    expect(commandAt(view, sel([]), at(5, 2), TS)).toBeNull();
    expect(commandAt(view, sel([9, 3]), at(5, 2), TS)).toBeNull();
    expect(stopCommand(view, sel([3]))).toBeNull();
  });

  it('build placement sends the selected builders', () => {
    expect(valid(buildCommand(view, sel([5, 6]), 'barracks', { x: 4, y: 3 }))).toEqual({
      id: 1,
      faction: 'red',
      type: 'build',
      units: [5],
      target: { x: 4, y: 3 },
      building: 'barracks',
    });
    expect(buildCommand(view, sel([6]), 'barracks', { x: 4, y: 3 })).toBeNull();
  });

  it('train buttons queue at the selected finished own buildings that train the unit', () => {
    expect(trainButtons(view, sel([3, 8]))).toEqual(['worker']);
    expect(valid(trainCommand(view, sel([3]), 'worker'))).toEqual({
      id: 1,
      faction: 'red',
      type: 'train',
      units: [3],
      target: 'worker',
    });
    expect(trainCommand(view, sel([3]), 'soldier')).toBeNull();
    expect(trainCommand(view, sel([8]), 'soldier')).toBeNull(); // blue's, and not finished
  });

  it('stop stops the selected own units; stampOrder puts the id first', () => {
    expect(valid(stopCommand(view, sel([5, 7])), 9)).toEqual({
      id: 9,
      faction: 'red',
      type: 'stop',
      units: [5, 7],
    });
    expect(Object.keys(stampOrder({ faction: 'red', type: 'stop', units: [5] }, 3))[0]).toBe('id');
  });
});
