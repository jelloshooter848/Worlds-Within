import { campaignRun, type CampaignDef, type CampaignRunState, type CampaignSave } from '../campaign';
import {
  decodeSaveCode,
  encodeSaveCode,
  type SaveCodeContext,
  type SaveCodeRefusalCode,
} from '../campaign-code';
import { loadCampaignSave, storeCampaignSave } from '../save/campaign-store';

/**
 * A campaign as a page plays it (Engine 0.13 T8): the parts every campaign page writes the same
 * way, so a game's glue keeps only what it builds from a save. One session per game and campaign:
 *
 * - **An entry ends** (`end(save)`): the save the game gives at the entry's end is kept in browser
 *   storage (`save/campaign-store.ts`, `ww:<game>:campaign:<id>`) and packed into a save code
 *   (`campaign-code.ts`) for the page to show. A null save (the game cannot give one, such as the
 *   mini siege once its hall has fallen) stores nothing.
 * - **A code typed in** (`resume(text)`): decoded against the game's content; a refusal comes
 *   back with the codec's code and its sentence for the page to show, and so does a code of
 *   another campaign (`code_campaign`) or of a finished campaign (`campaign_done`): there is
 *   nothing left to play from it.
 * - **The stored save** (`stored()`): the save kept by an earlier visit, when it has an entry left
 *   to play past the first (a page offers to carry on from it), else null.
 *
 * No DOM: storage goes through `save/storage.ts`, which never throws (a page without storage
 * still plays; `stored()` is null and `end` reports `stored: false`). Tested in `shell.test.ts`.
 */

/** Why a typed code cannot resume the campaign. */
export type CampaignResumeRefusalCode = SaveCodeRefusalCode | 'campaign_done';

export type CampaignResume =
  | { ok: true; save: CampaignSave; run: CampaignRunState }
  | { ok: false; code: CampaignResumeRefusalCode; error: string };

/** What an entry's end gives the page: the save, its code, and whether storage kept it. */
export interface CampaignEntryEnd {
  save: CampaignSave | null;
  /** The save code, or null when there is no save or it could not be packed (`codeError` says why). */
  code: string | null;
  codeError: string | null;
  /** Whether browser storage kept the save. */
  stored: boolean;
  /** True when the save is past the campaign's last entry. */
  done: boolean;
}

export class CampaignSession {
  constructor(
    readonly context: SaveCodeContext,
    readonly campaign: CampaignDef,
  ) {}

  /** Where `save` is in the campaign (`campaignRun`). */
  run(save?: CampaignSave): CampaignRunState {
    return campaignRun(this.campaign, save);
  }

  /** The save an earlier visit stored, when it has an entry past the first left to play; else null. */
  stored(): CampaignSave | null {
    const save = loadCampaignSave(this.context.game, this.campaign.id);
    if (save === null || save.position === 0 || this.run(save).done) return null;
    return save;
  }

  /** An entry ended with `save` (null: none to give): stores it and packs its code. */
  end(save: CampaignSave | null): CampaignEntryEnd {
    if (save === null) return { save, code: null, codeError: null, stored: false, done: false };
    const packed = encodeSaveCode(save, this.context);
    return {
      save,
      code: packed.ok ? packed.code : null,
      codeError: packed.ok ? null : `${packed.code}: ${packed.error}`,
      stored: storeCampaignSave(save),
      done: this.run(save).done,
    };
  }

  /** A typed code read back into a save of this campaign with an entry left to play, or the reason not. */
  resume(text: string): CampaignResume {
    const decoded = decodeSaveCode(text, this.context);
    if (!decoded.ok) return decoded;
    const save = decoded.save;
    if (save.campaign !== this.campaign.id)
      return {
        ok: false,
        code: 'code_campaign',
        error: `the code is campaign "${save.campaign}"'s, not "${this.campaign.id}"'s`,
      };
    const run = this.run(save);
    if (run.done)
      return {
        ok: false,
        code: 'campaign_done',
        error: `the code is the end of campaign "${this.campaign.id}": there is nothing left to play`,
      };
    return { ok: true, save, run };
  }
}
