import type { Volumes } from '../audio/audio-manager';
import { loadVolumes, storeVolumes, type StoredVolumes } from '../save/settings';

/**
 * The shell's mute button and volume slider (Engine 0.15, gap M1; docs/BUILD-LOG.md, Engine 0.15,
 * decision 5, item 282): the shell's own DOM, never a kit's, like its touch pad. It reads the
 * player's stored volumes for the game (`save/settings.ts`, one key per game), applies them to the
 * page's audio, and stores every change at once, so a reload keeps them. `bootBrowserGame` mounts
 * it on every page with `audio` (turn it off with `volumeControl: false`); a page with its own loop
 * (the dungeon) calls `mountVolumeControl` itself. Browser only (DOM): not on `PURE_CORE`.
 *
 * The DOM: `#ww-volume` (a small group fixed at the top-right corner) with `#ww-mute` (a button,
 * `aria-pressed` true while muted) and `#ww-master` (a range 0-100 in steps of 10: the master
 * volume in percent). Neither takes the keyboard's focus from the game: a click on the button
 * blurs it, and keys pressed on the slider do not reach the game's keyboard.
 */

/** What the control drives: the page's audio (`AudioManager.setVolumes`). */
export interface VolumeTarget {
  setVolumes(v: Partial<Volumes>): void;
}

export interface VolumeControlOptions {
  /** The game's id (`content.manifest.id`): the storage key's game. Left out, nothing is stored. */
  game?: string | undefined;
  /** The volumes a player who stored none starts at (the defaults when left out). */
  start?: Partial<StoredVolumes> | undefined;
  /** The audio the volumes go to. */
  audio: VolumeTarget;
  /** Where the control goes (default `document.body`). */
  parent?: HTMLElement;
}

/** The mounted control: its element, and the volumes now. */
export interface VolumeControl {
  readonly element: HTMLElement;
  volumes(): StoredVolumes;
  /** Changes the volumes as the control would (applied, shown and stored). */
  set(v: Partial<StoredVolumes>): void;
}

/** The control's element id. */
export const VOLUME_CONTROL_ID = 'ww-volume';

const STYLE = `
#ww-volume { position: fixed; top: 4px; right: 4px; z-index: 20; display: flex; align-items: center;
  gap: 4px; padding: 2px 4px; border-radius: 4px; background: rgba(0, 0, 0, 0.55); color: #eee;
  font: 12px/1.2 system-ui, sans-serif; touch-action: manipulation; }
#ww-volume button { min-width: 44px; min-height: 28px; padding: 0 6px; border: 1px solid #666;
  border-radius: 4px; background: #333; color: #fff; font: inherit; }
#ww-volume button[aria-pressed='true'] { background: #722; }
#ww-volume input { width: 72px; }
`;

/** Puts the control on the page with the stored volumes applied; returns it. */
export function mountVolumeControl(opts: VolumeControlOptions): VolumeControl {
  let current: StoredVolumes = loadVolumes(opts.game, opts.start);
  opts.audio.setVolumes(current);

  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);
  const box = document.createElement('div');
  box.id = VOLUME_CONTROL_ID;
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'Sound');
  const mute = document.createElement('button');
  mute.type = 'button';
  mute.id = 'ww-mute';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.id = 'ww-master';
  slider.min = '0';
  slider.max = '100';
  slider.step = '10';
  slider.setAttribute('aria-label', 'Volume');
  box.append(mute, slider);
  (opts.parent ?? document.body).append(box);

  const show = () => {
    mute.textContent = current.muted ? 'Muted' : 'Sound';
    mute.title = current.muted ? 'Turn the sound on' : 'Mute';
    mute.setAttribute('aria-pressed', String(current.muted));
    slider.value = String(Math.round(current.master * 100));
  };
  const set = (v: Partial<StoredVolumes>) => {
    current = { ...current, ...v };
    opts.audio.setVolumes(current);
    if (opts.game !== undefined) storeVolumes(opts.game, current);
    show();
  };
  show();

  // Keep the game's keys the game's: never keep focus on the button, never let slider keys through.
  mute.addEventListener('pointerdown', (e) => e.preventDefault());
  mute.addEventListener('click', () => {
    set({ muted: !current.muted });
    mute.blur();
  });
  slider.addEventListener('input', () => set({ master: Number(slider.value) / 100, muted: false }));
  for (const type of ['keydown', 'keyup'] as const) slider.addEventListener(type, (e) => e.stopPropagation());
  slider.addEventListener('change', () => slider.blur());

  return { element: box, volumes: () => ({ ...current }), set };
}
