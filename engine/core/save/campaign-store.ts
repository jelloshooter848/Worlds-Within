import { campaignSaveSchema, type CampaignSave } from '../campaign';
import { loadJson, removeKey, saveJson } from './storage';

/**
 * Campaign saves in browser storage (Engine 0.13, decision 6, item 225), through `storage.ts`, so
 * a blocked, full or private storage never throws: the game stays playable without it (a load
 * gives null, a store false). One save per game and campaign, under `ww:<game>:campaign:<id>`.
 * What is read back is checked with `campaignSaveSchema`; anything else stored there reads as
 * null (never a broken save).
 */

/** The storage key of a game's campaign save. */
export function campaignSaveKey(game: string, campaign: string): string {
  return `ww:${game}:campaign:${campaign}`;
}

/** The campaign save stored for `game` and `campaign`, or null (none, unreadable or not a save). */
export function loadCampaignSave(game: string, campaign: string): CampaignSave | null {
  const parsed = campaignSaveSchema.safeParse(loadJson<unknown>(campaignSaveKey(game, campaign)));
  if (!parsed.success) return null;
  return parsed.data.game === game && parsed.data.campaign === campaign ? parsed.data : null;
}

/** Stores `save` under its game and campaign; false when storage refused it (nothing thrown). */
export function storeCampaignSave(save: CampaignSave): boolean {
  return saveJson(campaignSaveKey(save.game, save.campaign), save);
}

/** Forgets the campaign save of `game` and `campaign` (nothing thrown when storage is blocked). */
export function clearCampaignSave(game: string, campaign: string): void {
  removeKey(campaignSaveKey(game, campaign));
}
