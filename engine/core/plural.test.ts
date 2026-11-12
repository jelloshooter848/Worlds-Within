import { describe, expect, it } from 'vitest';
import { countText, plural } from './plural';

describe('plural', () => {
  it.each([
    ['raider', 'raiders'],
    ['soldier', 'soldiers'],
    ['catapult', 'catapults'],
    ['siege-engine', 'siege-engines'],
    ['army', 'armies'],
    ['day', 'days'],
    ['boss', 'bosses'],
    ['fox', 'foxes'],
    ['torch', 'torches'],
    ['brush', 'brushes'],
  ])('%s -> %s', (word, want) => {
    expect(plural(word)).toBe(want);
  });
});

describe('countText', () => {
  it('writes one as the bare word and more with a count and the plural', () => {
    expect(countText(1, 'ram')).toBe('ram');
    expect(countText(2, 'soldier')).toBe('2 soldiers');
    expect(countText(4, 'raider')).toBe('4 raiders');
    expect(countText(0, 'army')).toBe('0 armies');
  });

  it('takes a named plural', () => {
    expect(countText(3, 'ox', 'oxen')).toBe('3 oxen');
    expect(countText(1, 'ox', 'oxen')).toBe('ox');
  });
});
