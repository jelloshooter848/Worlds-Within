import { loadJson, saveJson } from './storage';

/**
 * Player settings the engine itself reads (audio and touch controls). A game keeps its own
 * settings on top of these.
 */

export type TouchMode = 'auto' | 'on' | 'off';
/** Touch d-pad: drawn at a fixed spot, or a stick that centres under the thumb. */
export type DpadStyle = 'fixed' | 'floating';
export const DPAD_STYLES: readonly DpadStyle[] = ['fixed', 'floating'];
export const TOUCH_MODES: readonly TouchMode[] = ['auto', 'on', 'off'];
/**
 * Touch size range. The pad is laid out at 1 (68 px face buttons, every label at 11 px or more);
 * smaller made buttons under the 44 px touch-target size and labels unreadable, so 1 is the floor.
 */
export const TOUCH_SCALE_MIN = 1;
export const TOUCH_SCALE_MAX = 1.6;

/**
 * The master volume a new player starts at: about level with a phone's other media. On the
 * slider's 10% steps.
 */
export const DEFAULT_MASTER = 0.4;

/**
 * The player's stored audio settings (Engine 0.15, gap M1; docs/BUILD-LOG.md, Engine 0.15,
 * decision 5, item 282): master, music and sfx volume (0 to 1) and mute, kept in browser storage
 * under one key per game (`volumesKey`), read once at boot by the shell (`bootBrowserGame`) and
 * written at once on every change of its volume control. Never read by a headless run: sound is
 * no part of a game's state, so a seeded run never depends on it.
 */
export interface StoredVolumes {
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
}

/** What a player who never changed anything hears. */
export const DEFAULT_VOLUMES: Readonly<StoredVolumes> = Object.freeze({
  master: DEFAULT_MASTER,
  music: 1,
  sfx: 1,
  muted: false,
});

/** The storage key of a game's audio settings: `ww:<game>:volumes`. */
export function volumesKey(game: string): string {
  return `ww:${game}:volumes`;
}

const unit = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;

/**
 * A stored value read as volumes: every field checked (a number kept in 0..1, `muted` a
 * boolean), anything missing or malformed taken from `DEFAULT_VOLUMES`. Pure.
 */
export function readVolumes(value: unknown): StoredVolumes {
  const v = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return {
    master: unit(v['master'], DEFAULT_VOLUMES.master),
    music: unit(v['music'], DEFAULT_VOLUMES.music),
    sfx: unit(v['sfx'], DEFAULT_VOLUMES.sfx),
    muted: typeof v['muted'] === 'boolean' ? v['muted'] : DEFAULT_VOLUMES.muted,
  };
}

/**
 * A game's stored volumes, or `start` over the defaults when nothing usable is stored (nothing
 * stored, blocked storage, data that is not an object). Never throws.
 */
export function loadVolumes(game: string | undefined, start: Partial<StoredVolumes> = {}): StoredVolumes {
  const stored = game === undefined ? null : loadJson<unknown>(volumesKey(game));
  return readVolumes(typeof stored === 'object' && stored !== null ? stored : start);
}

/** Stores a game's volumes; false when storage refused (the page plays on). Never throws. */
export function storeVolumes(game: string, volumes: StoredVolumes): boolean {
  return saveJson(volumesKey(game), readVolumes(volumes));
}

/**
 * The player's stored presentation and control settings (Engine 0.16 T9; the shell's settings
 * screen): the screen shake scale (0 to 1), reduced flashing, the colour mode (an index into the
 * game's modes) and the touch pad (`TouchMode`), kept under one key per game (`settingsKey`)
 * beside the volumes. Never read by a headless run: none of them is part of a game's state.
 */
export interface StoredSettings {
  shake: number;
  reduceFlashing: boolean;
  colour: number;
  touch: TouchMode;
}

/** What a player who never changed anything sees. */
export const DEFAULT_SETTINGS: Readonly<StoredSettings> = Object.freeze({
  shake: 1,
  reduceFlashing: false,
  colour: 0,
  touch: 'auto',
});

/** The storage key of a game's presentation settings: `ww:<game>:settings`. */
export function settingsKey(game: string): string {
  return `ww:${game}:settings`;
}

/** A stored value read as settings: every field checked, anything else from `DEFAULT_SETTINGS`. Pure. */
export function readSettings(value: unknown): StoredSettings {
  const v = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const colour = v['colour'];
  const touch = v['touch'];
  return {
    shake: unit(v['shake'], DEFAULT_SETTINGS.shake),
    reduceFlashing:
      typeof v['reduceFlashing'] === 'boolean' ? v['reduceFlashing'] : DEFAULT_SETTINGS.reduceFlashing,
    colour:
      typeof colour === 'number' && Number.isInteger(colour) && colour >= 0
        ? colour
        : DEFAULT_SETTINGS.colour,
    touch: TOUCH_MODES.includes(touch as TouchMode) ? (touch as TouchMode) : DEFAULT_SETTINGS.touch,
  };
}

/** A game's stored settings, else the defaults. Never throws. */
export function loadSettings(game: string | undefined): StoredSettings {
  return readSettings(game === undefined ? null : loadJson<unknown>(settingsKey(game)));
}

/** Stores a game's settings; false when storage refused. Never throws. */
export function storeSettings(game: string, settings: StoredSettings): boolean {
  return saveJson(settingsKey(game), readSettings(settings));
}
