import { describe, expect, it } from 'vitest';
import { defaultBindings } from './bindings';
import { keyHintItems, keyHintMap, keyName } from './key-hints';

describe('key hints', () => {
  it('name the bound keyboard key for each ability (arrows as arrows)', () => {
    const keys = keyHintMap(defaultBindings(0).keyboard);
    expect(keys).toMatchObject({
      jump: 'Z',
      attack: 'X',
      special: 'C',
      start: 'ENTER',
      select: 'RIGHT SHIFT',
    });
    expect([keys.left, keys.right, keys.up, keys.down]).toEqual(['←', '→', '↑', '↓']);
    expect(keyName(undefined)).toBe('');
  });

  it('follow a remap at once', () => {
    const b = defaultBindings(0);
    b.keyboard.jump = ['KeyK'];
    b.keyboard.left = ['KeyA'];
    const items = keyHintItems({ jump: 'JUMP' }, keyHintMap(b.keyboard));
    expect(items.find((i) => i.id === 'jump')).toEqual({ id: 'jump', label: 'JUMP', key: 'K' });
    expect(items.find((i) => i.id === 'move')?.key).toBe('A → ↑ ↓');
  });

  it('show the labels the touch pad would show, leaving out hidden and blank buttons', () => {
    const keys = keyHintMap(defaultBindings(0).keyboard);
    const items = keyHintItems(
      { jump: 'JUMP', attack: 'SWORD', special: 'BOOMERANG', start: 'PAUSE', select: null },
      keys,
    );
    expect(items.map((i) => `${i.label} / ${i.key}`)).toEqual([
      'MOVE / ←→↑↓',
      'JUMP / Z',
      'SWORD / X',
      'BOOMERANG / C',
      'PAUSE / ENTER',
    ]);
    // The title's secret B is blank: no hint gives it away.
    expect(keyHintItems({ jump: 'OK', attack: '' }, keys).map((i) => i.id)).toEqual(['move', 'jump']);
  });
});
