import { describe, expect, it } from 'vitest';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { buildDungeon } from './room';
import { TOPDOWN_RULES } from './rules';
import { TopDownWorld } from './world';

/** One walled 16x11 room with the hero at (7,5). */
function oneRoom(disabledRules: readonly string[] = []): TopDownWorld {
  const map = Array.from({ length: 11 }, (_, r) =>
    r === 0 || r === 10 ? '#'.repeat(16) : `#${'.'.repeat(6)}${r === 5 ? '@' : '.'}${'.'.repeat(7)}#`,
  );
  return new TopDownWorld(buildDungeon([{ id: 'hall', at: [0, 0], map }]), { seed: 3, disabledRules });
}

function walkLeft(world: TopDownWorld, frames: number): void {
  const input = new ScriptedInput({ steps: [{ frame: 0, hold: ['left'] }] });
  for (let i = 0; i < frames; i++) {
    input.next();
    world.update(input);
  }
}

describe('TOPDOWN_RULES', () => {
  it('names the rules the kit guards, each with a description', () => {
    expect(TOPDOWN_RULES.map((r) => r.id)).toEqual([
      'walls-block-movement',
      'doors-change-room',
      'damage-reduces-hp',
      'keys-open-locked-doors',
      'dash-crosses-pits',
    ]);
    for (const r of TOPDOWN_RULES) expect(r.description.length).toBeGreaterThan(0);
  });

  it('has every rule on in a world by default', () => {
    const world = oneRoom();
    for (const r of TOPDOWN_RULES) expect(world.rules.isOn(r.id)).toBe(true);
  });

  it('throws on an unknown rule id', () => {
    expect(() => oneRoom(['walls-block-moves'])).toThrow('unknown rule(s)');
  });
});

describe('switching a rule off', () => {
  it('walls-block-movement: the hero stops at the wall, or walks into it with the rule off', () => {
    const on = oneRoom();
    walkLeft(on, 120);
    expect(on.hero.x).toBeGreaterThan(8);
    const off = oneRoom(['walls-block-movement']);
    walkLeft(off, 120);
    expect(off.hero.x).toBeLessThan(on.hero.x - 8);
  });

  it('damage-reduces-hp: a hit takes half hearts, or none with the rule off', () => {
    const on = oneRoom();
    on.hero.hurt(on, 2, 'up');
    expect(on.hero.hp).toBe(on.hero.maxHp - 2);
    const off = oneRoom(['damage-reduces-hp']);
    off.hero.hurt(off, 2, 'up');
    expect(off.hero.hp).toBe(off.hero.maxHp);
    expect(off.events).toContainEqual({ type: 'hurt', hp: off.hero.maxHp });
  });
});
