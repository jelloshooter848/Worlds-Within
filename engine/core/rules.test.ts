import { describe, expect, it } from 'vitest';
import { defineRules, RuleSwitch, unknownRules } from './rules';

const RULES = defineRules([
  { id: 'walls-block', description: 'walls stop things' },
  { id: 'doors-open', description: 'doors let things through' },
]);

describe('defineRules', () => {
  it('returns a good list as it is', () => {
    expect(RULES.map((r) => r.id)).toEqual(['walls-block', 'doors-open']);
  });

  it('throws on an id that is not kebab-case, an id twice or no description', () => {
    expect(() => defineRules([{ id: 'Walls', description: 'x' }])).toThrow('kebab-case');
    expect(() =>
      defineRules([
        { id: 'a', description: 'x' },
        { id: 'a', description: 'y' },
      ]),
    ).toThrow('listed twice');
    expect(() => defineRules([{ id: 'a', description: ' ' }])).toThrow('no description');
  });
});

describe('RuleSwitch', () => {
  it('has every rule on by default', () => {
    const rules = new RuleSwitch(RULES);
    expect(rules.isOn('walls-block')).toBe(true);
    expect(rules.isOn('doors-open')).toBe(true);
    expect(rules.disabled()).toEqual([]);
  });

  it('switches off the rules it is given, and lists them in the kit order', () => {
    const rules = new RuleSwitch(RULES, ['doors-open', 'walls-block']);
    expect(rules.isOn('walls-block')).toBe(false);
    expect(rules.isOn('doors-open')).toBe(false);
    expect(rules.disabled()).toEqual(['walls-block', 'doors-open']);
  });

  it('throws on an unknown id, switched off or asked about', () => {
    expect(() => new RuleSwitch(RULES, ['walls-blok'])).toThrow('unknown rule(s) "walls-blok"');
    expect(() => new RuleSwitch(RULES).isOn('nope')).toThrow('no rule "nope"');
    expect(unknownRules(RULES, ['doors-open', 'x'])).toEqual(['x']);
  });
});
