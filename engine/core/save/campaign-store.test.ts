import { afterEach, describe, expect, it, vi } from 'vitest';
import { newCampaignSave } from '../campaign';
import { campaignSaveKey, clearCampaignSave, loadCampaignSave, storeCampaignSave } from './campaign-store';

// Engine 0.13 T6 (decision 6): a campaign save in browser storage, under ww:<game>:campaign:<id>,
// and a game that stays playable when storage is missing or throws.

afterEach(() => {
  vi.unstubAllGlobals();
});

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

describe('campaign saves in storage', () => {
  const save = newCampaignSave({ game: 'mini-siege', campaign: 'siege', seed: 11 });

  it('stores, loads and clears a save under its key', () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    expect(campaignSaveKey('mini-siege', 'siege')).toBe('ww:mini-siege:campaign:siege');
    expect(storeCampaignSave(save)).toBe(true);
    expect(loadCampaignSave('mini-siege', 'siege')).toEqual(save);
    expect(loadCampaignSave('mini-siege', 'other')).toBeNull();
    clearCampaignSave('mini-siege', 'siege');
    expect(loadCampaignSave('mini-siege', 'siege')).toBeNull();
  });

  it('reads anything that is not a save as none', () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    storage.setItem('ww:mini-siege:campaign:siege', '{"format":"nope"}');
    expect(loadCampaignSave('mini-siege', 'siege')).toBeNull();
    storage.setItem('ww:mini-siege:campaign:siege', JSON.stringify({ ...save, campaign: 'other' }));
    expect(loadCampaignSave('mini-siege', 'siege')).toBeNull();
    storage.setItem('ww:mini-siege:campaign:siege', 'not json');
    expect(loadCampaignSave('mini-siege', 'siege')).toBeNull();
  });

  it('works without storage, and with storage that throws', () => {
    expect(loadCampaignSave('mini-siege', 'siege')).toBeNull();
    expect(storeCampaignSave(save)).toBe(false);
    expect(() => clearCampaignSave('mini-siege', 'siege')).not.toThrow();
    const blocked = memoryStorage();
    blocked.getItem = () => {
      throw new Error('blocked');
    };
    blocked.setItem = () => {
      throw new Error('quota');
    };
    vi.stubGlobal('localStorage', blocked);
    expect(storeCampaignSave(save)).toBe(false);
    expect(loadCampaignSave('mini-siege', 'siege')).toBeNull();
  });
});
