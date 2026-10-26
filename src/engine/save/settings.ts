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
