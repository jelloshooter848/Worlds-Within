import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { validate } from '@engine/core/content/validate';
import { profileSchema, type ProfileDef } from './profile';

const PROFILE = JSON.parse(
  readFileSync(new URL('./__fixtures__/runner.profile.json', import.meta.url), 'utf8'),
) as ProfileDef;

/** The fixture profile with each dotted path set to its value (undefined removes the field). */
function broken(edits: Record<string, unknown>): unknown {
  const out = structuredClone(PROFILE) as unknown as Record<string, unknown>;
  for (const [path, value] of Object.entries(edits)) {
    const keys = path.split('.');
    const last = keys.pop()!;
    const parent = keys.reduce((o, k) => o[k] as Record<string, unknown>, out);
    if (value === undefined) delete parent[last];
    else parent[last] = value;
  }
  return out;
}

const errorsOf = (data: unknown) =>
  validate('r.profile.json', data, profileSchema).errors.map((e) => [e.path, e.code]);

describe('profileSchema', () => {
  it('accepts the fixture profile', () => {
    expect(validate('runner.profile.json', PROFILE, profileSchema).errors).toEqual([]);
  });

  it('matches the default runner: whole numbers in 1/4096 px per tick', () => {
    const p = PROFILE.player;
    expect([p.maxWalk, p.maxRun, p.walkAccel, p.runAccel]).toEqual([0x1900, 0x2900, 0x98, 0xe4]);
    expect([p.friction, p.skid, p.skidTurn, p.minWalk]).toEqual([0xd0, 0x1a0, 0x900, 0x130]);
    expect(p.jumps.map((t) => [t.below, t.speed, t.holdGravity, t.gravity])).toEqual([
      [0x1000, 0x4000, 0x200, 0x700],
      [0x2500, 0x4000, 0x1e0, 0x600],
      [undefined, 0x5000, 0x280, 0x900],
    ]);
    expect([p.maxFall, p.fallReset, p.stompBounce]).toEqual([0x4800, 0x4000, 0x4000]);
  });

  it('names the field of a number that is not whole, and an unknown field', () => {
    expect(errorsOf(broken({ 'player.maxRun': 2.5, 'actors.walker.wings': true }))).toEqual([
      ['player.maxRun', 'invalid_type'],
      ['actors.walker.wings', 'unrecognized_keys'],
    ]);
  });

  it('checks the jump tiers', () => {
    expect(errorsOf(broken({ 'player.jumps.2.below': 20000, 'player.jumps.1.below': undefined }))).toEqual([
      ['player.jumps.1.below', 'bad_jump_tiers'],
      ['player.jumps.2.below', 'bad_jump_tiers'],
    ]);
    expect(errorsOf(broken({ 'player.jumps.1.below': 4096 }))).toEqual([
      ['player.jumps.1.below', 'bad_jump_tiers'],
    ]);
  });

  it('checks that maxHp is not under the starting hp, and fills in the hit point defaults', () => {
    expect(errorsOf(broken({ 'player.maxHp': 1 }))).toEqual([['player.maxHp', 'bad_hp']]);
    const plain = broken({ 'player.hp': undefined, 'player.maxHp': undefined, 'player.lives': undefined });
    expect(profileSchema.parse(plain).player).toMatchObject({ hp: 1, lives: 1 });
  });

  it('checks the speed caps, what a stomp turns an actor into, and a kick speed', () => {
    const data = broken({
      'player.maxWalk': PROFILE.player.maxRun + 1,
      'actors.shell-walker.stompInto': 'helmet',
      'actors.shell.kickSpeed': undefined,
    });
    expect(errorsOf(data)).toEqual([
      ['player.maxWalk', 'bad_speed_caps'],
      ['actors["shell-walker"].stompInto', 'unknown_actor'],
      ['actors.shell.kickSpeed', 'missing_field'],
    ]);
  });
});
