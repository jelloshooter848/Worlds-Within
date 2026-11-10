import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  loadProgress,
  progressKey,
  readProgress,
  readSettings,
  settingsKey,
  storeProgress,
} from './settings';

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

describe('stored level progress (Engine 0.16 part B, T3)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the cleared ids that are strings, once each', () => {
    expect(progressKey('hop')).toBe('ww:hop:progress');
    expect(readProgress(null)).toEqual({ cleared: [] });
    expect(readProgress({ cleared: ['a', 3, '', 'b', 'a'] })).toEqual({ cleared: ['a', 'b'] });
    expect(readProgress({ cleared: 'a' })).toEqual({ cleared: [] });
  });

  it('stores and loads it, and plays on when storage is blocked', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    });
    expect(loadProgress('hop')).toEqual({ cleared: [] });
    expect(storeProgress('hop', { cleared: ['fx-1'] })).toBe(true);
    expect(loadProgress('hop')).toEqual({ cleared: ['fx-1'] });
    expect(loadProgress(undefined)).toEqual({ cleared: [] });
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(loadProgress('hop')).toEqual({ cleared: [] });
    expect(storeProgress('hop', { cleared: ['fx-1'] })).toBe(false);
  });
});
