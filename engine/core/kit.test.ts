import { describe, expect, it } from 'vitest';
import { defineKit } from './kit';

const rules = [{ id: 'walls-block', description: 'walls stop things' }] as const;

describe('defineKit', () => {
  it('returns a good hook as it is', () => {
    const kit = defineKit({ name: 'side-view', kinds: () => [], rules });
    expect(kit.name).toBe('side-view');
    expect(kit.rules).toBe(rules);
    expect(kit.strictMutants).toBeUndefined();
  });

  it('throws on a name a game.json could not give', () => {
    expect(() => defineKit({ name: 'Top Down', kinds: () => [], rules })).toThrow(
      'kit name "Top Down" must be lower-case',
    );
    expect(() => defineKit({ name: '', kinds: () => [], rules })).toThrow('kit name');
  });

  it('throws on a bad rule list, naming the kit', () => {
    expect(() =>
      defineKit({ name: 'x', kinds: () => [], rules: [{ id: 'Walls', description: 'x' }] }),
    ).toThrow('kit "x": rule id "Walls" is not kebab-case');
    expect(() =>
      defineKit({
        name: 'x',
        kinds: () => [],
        rules: [
          { id: 'a', description: 'x' },
          { id: 'a', description: 'y' },
        ],
      }),
    ).toThrow('listed twice');
    expect(() => defineKit({ name: 'x', kinds: () => [], rules: [{ id: 'a', description: ' ' }] })).toThrow(
      'no description',
    );
  });
});
