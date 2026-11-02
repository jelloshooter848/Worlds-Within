import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@engine/core/headless';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { buildDungeon } from './room';
import { snapshotWorld, topdownGame } from './snapshot';
import { TopDownWorld } from './world';

/** One 16x11 room: walls round the edge, the hero at (7,5), a bat at (3,3) and a key at (10,7). */
function oneRoom(): TopDownWorld {
  const rows = Array.from({ length: 11 }, (_, r) =>
    r === 0 || r === 10 ? '#'.repeat(16) : `#${'.'.repeat(14)}#`,
  ).map((row) => row.split(''));
  rows[5]![7] = '@';
  rows[3]![3] = 'b';
  rows[7]![10] = 'k';
  const map = rows.map((r) => r.join(''));
  return new TopDownWorld(buildDungeon([{ id: 'hall', at: [0, 0], map }]), { seed: 3 });
}

describe('snapshotWorld', () => {
  it('is JSON-safe and names the hero, the room and the entities', () => {
    const world = oneRoom();
    const snap = snapshotWorld(world);
    expect(() => canonicalJson(snap)).not.toThrow();
    expect(snap).toMatchObject({
      frame: 0,
      room: 'hall',
      keys: 0,
      visited: ['hall'],
      sliding: null,
      hero: { room: 'hall', x: 112, y: 80, hp: 6, maxHp: 6, dead: false },
      inventory: { owned: [], current: null, ammo: {} },
      enemies: 1,
      events: [],
    });
    expect(snap.entities).toEqual([
      expect.objectContaining({ kind: 'bat', key: '3,3', hp: expect.any(Number) }),
      expect.objectContaining({ kind: 'key', key: '10,7' }),
    ]);
  });

  it('does not change the world', () => {
    const world = oneRoom();
    const before = canonicalJson(snapshotWorld(world));
    snapshotWorld(world);
    expect(canonicalJson(snapshotWorld(world))).toBe(before);
  });
});

describe('topdownGame', () => {
  /** The snapshots of 120 steps walking left. */
  function play(): string[] {
    const game = topdownGame(oneRoom());
    const input = new ScriptedInput({ steps: [{ frame: 0, hold: ['left'] }] });
    const out = [canonicalJson(game.snapshot())];
    for (let i = 0; i < 120; i++) {
      input.next();
      game.step(input);
      out.push(canonicalJson(game.snapshot()));
    }
    return out;
  }

  it('gives the same snapshots for the same seed and input', () => {
    expect(play()).toEqual(play());
  });

  it("lists the start's events, then each step's own", () => {
    const game = topdownGame(oneRoom());
    expect(game.snapshot().events).toEqual([{ type: 'room', id: 'hall', first: true }]);
    const input = new ScriptedInput({ steps: [{ frame: 0, hold: ['attack'] }] });
    input.next();
    game.step(input);
    expect(game.snapshot().events).toContainEqual({ type: 'sword' });
    input.next();
    game.step(input);
    expect(game.snapshot().events).not.toContainEqual({ type: 'sword' });
    expect(game.snapshot().frame).toBe(2);
  });
});
