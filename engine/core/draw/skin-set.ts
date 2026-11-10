import type { SheetLookup } from '../assets/sheet-lookup';
import type { CameraFxSettings } from '../fx';
import type { ScreenSize } from '../gfx/screen';
import {
  presenterBySkinSet,
  type DeepReadonly,
  type Presenter,
  type SkinFile,
  type SoundCue,
} from '../present';
import type { FontLookup } from '../ui';
import type { SkinnedPresenterOptions } from './skinned-presenter';

/** A game's 2D skins (a `SkinSet` from `../present`), its sheets and picture size. */
export interface SkinSetPresenterOptions {
  /** The game's own skin (`content/skins/canvas2d.json`). */
  skin: DeepReadonly<SkinFile>;
  /** A skin per mini game, by its id (`canvas2d-<id>.json`); none when left out. */
  rounds?: Readonly<Record<string, DeepReadonly<SkinFile>>>;
  sheet: SheetLookup;
  /** The game's `font` content files (`contentFonts`, Engine 0.16 T6), for every skin's HUD. */
  fonts?: FontLookup;
  screen: ScreenSize;
  /**
   * The colour behind the game's own frames when it is not its skin's (default the skin's
   * `background`, else `#000`); each round clears to its own skin's `background` (black by default).
   */
  background?: string;
  /** Called for each event whose skin entry names a sound. */
  onSound?: (id: string, cue?: SoundCue) => void;
  /**
   * Called with the ticks of each event whose skin entry asks for a `hitPause` (Engine 0.16 T4):
   * pass the boot's `shell.hitPause`, which holds the game's ticks.
   */
  onHitPause?: (ticks: number) => void;
  /** The game's own presenter when one is made already (else one made with `skin`). */
  main?: Presenter;
}

/** Makes one skin's presenter (a backend's `SkinnedPresenter` on its renderer and surfaces). */
export type SkinPresenterFactory = (
  skin: DeepReadonly<SkinFile>,
  sheet: SheetLookup,
  opts: SkinnedPresenterOptions,
) => Presenter;

/** A presenter for a skin set, which hands the player's effect settings to every skin's presenter. */
export type SkinSetPresenter = Presenter & { effectSettings(settings: CameraFxSettings): void };

/**
 * One presenter for a game that stacks kits (Engine 0.7 T9, gaps G29 and G34 in
 * docs/reports/stacking-test.md; shared by the 2D backends from Engine 0.16 T13b): the game's skin
 * draws its own frames and each mini game's skin the frames whose `status.miniGame` names it
 * (`presenterBySkinSet`), every presenter made by `make` (on one renderer). How each skin frames
 * its map (`camera.clamp`) is the skin's, so pages, views and tests need no per-round options.
 */
export function skinSetPresenter(
  opts: SkinSetPresenterOptions,
  make: SkinPresenterFactory,
): SkinSetPresenter {
  const sound = {
    ...(opts.onSound !== undefined && { onSound: opts.onSound }),
    ...(opts.onHitPause !== undefined && { onHitPause: opts.onHitPause }),
    ...(opts.fonts !== undefined && { fonts: opts.fonts }),
  };
  const main =
    opts.main ??
    make(opts.skin, opts.sheet, {
      size: opts.screen,
      ...(opts.background !== undefined && { background: opts.background }),
      ...sound,
    });
  const rounds: Record<string, Presenter> = {};
  for (const [id, skin] of Object.entries(opts.rounds ?? {}))
    rounds[id] = make(skin, opts.sheet, { size: opts.screen, ...sound });
  const shown = Object.keys(rounds).length > 0 ? presenterBySkinSet(main, rounds) : main;
  const all = [main, ...Object.values(rounds)];
  return {
    present: (frame) => shown.present(frame),
    ...(shown.resize !== undefined && { resize: (size: ScreenSize) => shown.resize!(size) }),
    // The player's shake and flashing settings (Engine 0.16 T9) reach every skin's presenter.
    effectSettings(settings) {
      for (const p of all)
        (p as { effectSettings?: (s: CameraFxSettings) => void }).effectSettings?.(settings);
    },
  };
}
