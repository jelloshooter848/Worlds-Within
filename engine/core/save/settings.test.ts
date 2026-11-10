import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, readSettings, settingsKey } from './settings';

describe('stored settings (Engine 0.16 T9)', () => {
  it('reads every field, taking the default for anything missing or malformed', () => {
    expect(settingsKey('hop')).toBe('ww:hop:settings');
    expect(readSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(readSettings({ shake: 0.3, reduceFlashing: true, colour: 2, touch: 'off' })).toEqual({
      shake: 0.3,
      reduceFlashing: true,
      colour: 2,
      touch: 'off',
    });
    expect(readSettings({ shake: 7, reduceFlashing: 'yes', colour: -1, touch: 'sideways' })).toEqual({
      ...DEFAULT_SETTINGS,
      shake: 1,
    });
  });
});
