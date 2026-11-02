import { describe, expect, it } from 'vitest';
import { RuleSwitch } from '@engine/core/rules';
import { battleSnapshot } from './__fixtures__/world';
import { RTS_RULES } from './rules';
import { Selection } from './selection';
import { readWorld } from './snapshot';

const TS = 16;
const at = (x: number, y: number) => ({ x: x * TS + 8, y: y * TS + 8 });

describe('Selection', () => {
  const view = readWorld(battleSnapshot());

  it('a click selects one thing: a unit, a building, an enemy to look at; empty ground clears', () => {
    const s = new Selection('red');
    expect(s.click(view, at(2, 1), TS)).toEqual([5]);
    expect(s.click(view, at(1, 0), TS)).toEqual([3]);
    expect(s.click(view, at(6, 4), TS)).toEqual([9]);
    expect(s.click(view, at(5, 5), TS)).toEqual([]);
  });

  it('a click on the hero selects the hero alone; heroes() selects only heroes', () => {
    const s = new Selection('red');
    s.box(view, { x: 0, y: 0, w: 8 * TS, h: 6 * TS }, TS);
    expect(s.ids()).toEqual([5, 6, 7]);
    expect(s.click(view, at(2, 3), TS)).toEqual([7]);
    s.clear();
    expect(s.heroes(view)).toEqual([7]);
  });

  it('a box selects every own unit inside it, never buildings or enemies; shift adds', () => {
    const s = new Selection('red');
    expect(s.box(view, { x: 0, y: 3 * TS, w: 8 * TS, h: 2 * TS }, TS)).toEqual([6, 7]);
    // any corner order
    expect(s.box(view, { x: 3 * TS, y: 2 * TS, w: -3 * TS, h: -2 * TS }, TS)).toEqual([5]);
    expect(s.box(view, { x: 0, y: 3 * TS, w: 2 * TS, h: TS }, TS, true)).toEqual([5, 6]);
    expect(s.box(view, { x: 5 * TS, y: 5 * TS, w: 4, h: 4 }, TS)).toEqual([]);
  });

  it('with box-selects-own-units off, a box takes enemy units too (the mutant)', () => {
    const s = new Selection('red', new RuleSwitch(RTS_RULES, ['box-selects-own-units']));
    expect(s.box(view, { x: 0, y: 3 * TS, w: 8 * TS, h: 2 * TS }, TS)).toEqual([6, 7, 9, 10]);
  });

  it('prune drops what is gone', () => {
    const s = new Selection('red');
    s.set([5, 6, 99, 4]);
    expect(s.prune(view)).toEqual([5, 6]);
  });
});
