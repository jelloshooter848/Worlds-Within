import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOPDOWN_RULES } from '@kits/topdown';
import { KIT_LIST, kitListText, kitNamesOnDisk } from './kit-list-gen';
import { allKits, findKit, kitKinds, kitNames, kitRules, loadKit } from './kits';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

describe('kits by name', () => {
  it('finds the topdown kit by its hook: the room kind and its named rules', () => {
    const kit = loadKit('topdown');
    expect(kit.name).toBe('topdown');
    expect(kitKinds('topdown').map((k) => k.name)).toEqual(['room']);
    expect(kitRules('topdown')).toBe(TOPDOWN_RULES);
    expect(findKit('topdown')).toBe(kit);
    expect(allKits()).toContain(kit);
  });

  it('finds the platformer kit by its hook: level and profile kinds, strict mutants', () => {
    const kit = loadKit('platformer');
    expect(kitKinds('platformer').map((k) => k.name)).toEqual(['level', 'profile']);
    expect(kit.strictMutants).toBe(true);
    expect(allKits()).toContain(kit);
  });

  it('finds the rts kit by its hook: map, types, enemy plan and end rule kinds, its named rules', () => {
    const kit = loadKit('rts');
    expect(kitKinds('rts').map((k) => k.name)).toEqual([
      'rts-map',
      'rts-types',
      'rts-enemy',
      'rts-end',
      'rts-names',
    ]);
    expect(kitRules('rts').map((r) => r.id)).toContain('enemy-follows-plan');
    expect(allKits()).toContain(kit);
  });

  it('names the kit and the field for a kit name no kit has', () => {
    expect(findKit('nokit')).toBeUndefined();
    expect(() => loadKit('nokit')).toThrow('unknown kit "nokit" in "kit": there is no kits/nokit/kit.ts');
    expect(() => kitRules('nokit')).toThrow('known: platformer, rts, topdown');
  });

  it('has one hook per kits/<name>/kit.ts, each named after its folder', () => {
    expect(kitNames()).toEqual(kitNamesOnDisk(ROOT));
    expect(new Set(kitNames()).size).toBe(kitNames().length);
  });

  it('kit-list.ts is what the generator makes (run "pnpm docs:gen" after adding a kit)', async () => {
    expect(readFileSync(join(ROOT, KIT_LIST), 'utf8')).toBe(await kitListText(ROOT));
  });
});
