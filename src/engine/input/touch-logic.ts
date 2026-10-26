import type { Action } from './actions';
import { TOUCH_MODES, type TouchMode } from '../save/settings';
import type { TouchLabels } from './touch';

/*
 * The pure parts of the touch controls (no DOM): d-pad zones, when to show the pad, hit-testing
 * the face buttons, and fitting button labels. TouchSource in touch.ts wires them to the page.
 */

// ---- D-pad zones ---------------------------------------------------------------------------

/** Inside this fraction of the pad radius nothing is held (a resting thumb). */
export const DPAD_DEAD = 0.2;
/** Left/right are held within this many degrees of horizontal (a wide ±60° band each side). */
export const DPAD_HORIZONTAL_MAX_DEG = 60;
/** Up is held at this elevation or steeper: up-diagonals 35°–60°, pure up within ±30° of vertical. */
export const DPAD_UP_MIN_DEG = 35;
/** Down is held at this elevation or steeper: down-diagonals 45°–60°, pure down within ±30° of vertical. */
export const DPAD_DOWN_MIN_DEG = 45;
/**
 * Only the down-diagonals need a push past this fraction of the radius, so a thumb sagging down
 * while running sideways never crouches; a straight-down push engages at the dead zone like up.
 */
export const DPAD_DOWN_MIN_R = 0.55;
/** Past this fraction of the radius a left/right push also holds `run` (the drawn ring). */
export const DPAD_RUN_R = 0.75;
/** Floating stick: when the thumb drags further than this (× radius) the centre follows it. */
export const DPAD_FOLLOW_R = 1.25;
/** The fixed pad's invisible hit area, as a multiple of the drawn pad's size. */
export const DPAD_HIT_SCALE = 1.4;
/** Floating stick: touches in this fraction of the screen width (from the left) grab the stick. */
export const FLOAT_ZONE_FRACTION = 0.45;

export interface DpadDirs {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  run: boolean;
}

export const NO_DIRS: Readonly<DpadDirs> = { left: false, right: false, up: false, down: false, run: false };

/**
 * The d-pad's angle zones. The default guards against crouching by accident: left and right are
 * wide (±60°), and the down-diagonals need a firmer push. A hero who never crouches can ask for
 * EIGHT_WAY_DPAD_ZONES instead (Scene.touchDpad): even 45° sectors, every diagonal as easy as up.
 */
export interface DpadZones {
  /** Left/right are held within this many degrees of horizontal. */
  horizontalMaxDeg: number;
  /** Up is held at this elevation or steeper. */
  upMinDeg: number;
  /** Down is held at this elevation or steeper. */
  downMinDeg: number;
  /** The down-diagonals (down while left/right is held) need this fraction of the radius. */
  downMinR: number;
}

/** Which zone set the pad reads (a scene asks for one; absent: 'default'). */
export type DpadZoneId = 'default' | 'eight-way';

export const DEFAULT_DPAD_ZONES: Readonly<DpadZones> = {
  horizontalMaxDeg: DPAD_HORIZONTAL_MAX_DEG,
  upMinDeg: DPAD_UP_MIN_DEG,
  downMinDeg: DPAD_DOWN_MIN_DEG,
  downMinR: DPAD_DOWN_MIN_R,
};

/** Even eight-way sectors: straight within ±22.5°, diagonals 22.5°-67.5°, no firmer push for down. */
export const EIGHT_WAY_DPAD_ZONES: Readonly<DpadZones> = {
  horizontalMaxDeg: 67.5,
  upMinDeg: 22.5,
  downMinDeg: 22.5,
  downMinR: DPAD_DEAD,
};

export const DPAD_ZONES: Readonly<Record<DpadZoneId, Readonly<DpadZones>>> = {
  default: DEFAULT_DPAD_ZONES,
  'eight-way': EIGHT_WAY_DPAD_ZONES,
};

/**
 * Directions held for a thumb at (dx, dy) px from the pad centre (screen axes, +y down) on a pad
 * of `radius` px. Eight sectors by angle (`zones`; by default left/right wide, up/down narrower,
 * diagonals only in the bands between, the down-diagonals also needing a firmer push), and a far
 * push left/right adds `run`.
 */
export function dpadDirs(
  dx: number,
  dy: number,
  radius: number,
  zones: DpadZones = DEFAULT_DPAD_ZONES,
): DpadDirs {
  const r = Math.hypot(dx, dy) / radius;
  if (!(r >= DPAD_DEAD) || !Number.isFinite(r)) return { ...NO_DIRS };
  const elev = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI; // 0 = horizontal, 90 = vertical
  const horizontal = elev <= zones.horizontalMaxDeg;
  const left = horizontal && dx < 0;
  const right = horizontal && dx > 0;
  const up = dy < 0 && elev >= zones.upMinDeg;
  const down = dy > 0 && elev >= zones.downMinDeg && (!horizontal || r >= zones.downMinR);
  const run = r >= DPAD_RUN_R && (left || right);
  return { left, right, up, down, run };
}

/** Floating stick: the centre after the thumb moved to (x, y); it trails a thumb dragged far out. */
/** Floating stick: its centre stays this far (× radius) from every screen edge. */
export const FLOAT_EDGE_R = 0.8;

/**
 * Floating stick: keep the centre `FLOAT_EDGE_R` × radius inside a `w` × `h` screen, so a touch
 * near an edge can still push towards it (down near the bottom, left and run-left near the left).
 */
export function clampCentre(
  x: number,
  y: number,
  radius: number,
  w: number,
  h: number,
): { cx: number; cy: number } {
  const m = FLOAT_EDGE_R * radius;
  const clamp = (v: number, hi: number) => (hi < m ? hi / 2 : Math.max(m, Math.min(hi - m, v)));
  return { cx: clamp(x, w), cy: clamp(y, h) };
}

export function followCentre(
  cx: number,
  cy: number,
  x: number,
  y: number,
  radius: number,
): { cx: number; cy: number } {
  const dx = x - cx;
  const dy = y - cy;
  const d = Math.hypot(dx, dy);
  const max = DPAD_FOLLOW_R * radius;
  if (d <= max) return { cx, cy };
  const k = (d - max) / d;
  return { cx: cx + dx * k, cy: cy + dy * k };
}

// ---- When to show the pad --------------------------------------------------------------------

/** What the page knows about the device. */
export interface TouchFacts {
  /** matchMedia('(pointer: coarse)'): the primary pointer is a finger. */
  coarsePointer: boolean;
  /** matchMedia('(hover: none)'): the primary pointer cannot hover. */
  hoverNone: boolean;
}

/** The last kind of input used: a real touch, or a key / gamepad button. */
export type LastInput = 'touch' | 'keys' | null;

/**
 * Show the on-screen pad? 'on'/'off' always win. 'auto' follows the last input used (a touch
 * shows it, a key or gamepad button hides it) and otherwise the device: phones and tablets
 * (coarse primary pointer that cannot hover) yes, desktops and touchscreen laptops no.
 */
/**
 * The next touch mode for a menu row (Auto → On → Off). While the player is on touch, Off is
 * skipped (Auto ↔ On): it would hide the pad with no way to bring it back by touch, so Off can
 * only be chosen with a keyboard or gamepad.
 */
export function nextTouchMode(mode: TouchMode, dir: -1 | 1, last: LastInput): TouchMode {
  const modes: readonly TouchMode[] = last === 'touch' ? ['auto', 'on'] : TOUCH_MODES;
  const i = modes.indexOf(mode);
  if (i < 0) return 'auto';
  return modes[(i + dir + modes.length) % modes.length] as TouchMode;
}

export function touchPadVisible(mode: TouchMode, facts: TouchFacts, last: LastInput): boolean {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  if (last === 'touch') return true;
  if (last === 'keys') return false;
  return facts.coarsePointer && facts.hoverNone;
}

/** Read the media facts from the page (false for both outside a browser). */
export function readTouchFacts(
  mm: ((q: string) => { matches: boolean }) | undefined = typeof matchMedia === 'function'
    ? (q) => matchMedia(q)
    : undefined,
): TouchFacts {
  if (!mm) return { coarsePointer: false, hoverNone: false };
  return { coarsePointer: mm('(pointer: coarse)').matches, hoverNone: mm('(hover: none)').matches };
}

// ---- Face buttons ----------------------------------------------------------------------------

/** Fraction past a button's radius that still counts as on it (rolling thumbs land between). */
export const BUTTON_HIT_SLACK = 1.2;

export interface ButtonTarget {
  action: Action;
  cx: number;
  cy: number;
  r: number;
}

/** The button under (x, y): the nearest whose (slightly enlarged) circle contains the point. */
export function hitButton(x: number, y: number, targets: readonly ButtonTarget[]): Action | null {
  let best: Action | null = null;
  let bestD = Infinity;
  for (const t of targets) {
    const d = Math.hypot(x - t.cx, y - t.cy) / t.r;
    if (d <= BUTTON_HIT_SLACK && d < bestD) {
      best = t.action;
      bestD = d;
    }
  }
  return best;
}

// ---- Labels ----------------------------------------------------------------------------------

/** No label is drawn smaller than this font size (px at touch scale 1): readable on a phone. */
export const LABEL_MIN_PX = 11;
/**
 * The exception: one long word with nowhere to wrap (BOOMERANG, SHURIKEN, WINDMILL) may shrink to
 * this instead, so the full word is shown rather than an abbreviation.
 */
export const LABEL_LONG_WORD_MIN_PX = 8;
/** A two-line label is drawn no bigger than this fraction of the button's font. */
export const LABEL_WRAP_SCALE = 0.85;
/** A label that could wrap stays on one line while it fits at this scale or more. */
export const LABEL_ONE_LINE_SCALE = 0.75;
/** Clear space between the letters and the button's rim (px). */
export const LABEL_MARGIN = 2;
/** The buttons' border (px). */
export const BUTTON_BORDER = 2;
/** The buttons' font family (the canvas measures labels in it). */
export const BUTTON_FONT = 'system-ui, sans-serif';

/** A fully rounded button (a circle, or a pill when wider than tall) at touch scale 1, in px. */
export interface ButtonShape {
  w: number;
  h: number;
  /** Font size of a label that fits at full size. */
  font: number;
}

/** A, B and C are the same round size; Start and Select are small pills. */
export const FACE_BUTTON: ButtonShape = { w: 68, h: 68, font: 18 };
export const SMALL_BUTTON: ButtonShape = { w: 68, h: 30, font: 12 };

export function buttonShape(a: Action): ButtonShape {
  return a === 'start' || a === 'select' ? SMALL_BUTTON : FACE_BUTTON;
}

/** Where a button sits, in px at touch scale 1: from the right edge, and the bottom (or top). */
export type ButtonPlace = { right: number; bottom: number } | { right: number; top: number };

/**
 * The pad's box: the screen less the notch, rounded corners and home bar (0.4.44), in portrait
 * and landscape, so every button and MENU stays where a thumb can reach it. All the controls are
 * placed inside this box. It is the game canvas's box too (index.html #screen), sized by the same
 * rules (0.4.45), so the screen layout (touch-layout.ts) places the controls and the game in one
 * frame: `--app-h` is the screen height main.ts measures (100vh until it does).
 */
export const GAME_FRAME =
  'top: env(safe-area-inset-top, 0px); left: env(safe-area-inset-left, 0px); ' +
  'width: calc(100vw - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)); ' +
  'height: calc(var(--app-h, 100vh) - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));';

/**
 * The right-thumb cluster: A low on the right, B low on the left, C above between them, and
 * Select (the tool-belt swap) just up and to the left of C, so swapping sits next to using
 * and away from A/B. Start alone in the top-right corner. Everything scales with --ts.
 */
export const BUTTON_PLACES: Readonly<
  Record<'jump' | 'attack' | 'special' | 'select' | 'start', ButtonPlace>
> = {
  jump: { right: 24, bottom: 40 },
  attack: { right: 104, bottom: 24 },
  special: { right: 60, bottom: 114 },
  select: { right: 134, bottom: 167 },
  start: { right: 16, top: 10 },
};

/** Text width in em of the bold button font. */
export type MeasureEm = (text: string) => number;

/**
 * Advance widths (em) of bold DejaVu Sans, measured in Chromium: the widest common system-ui
 * fallback, so a label that fits with these fits on a phone's narrower Roboto or SF too.
 */
// prettier-ignore
const WIDE_EM: Readonly<Record<string, number>> = {
  A: 0.774, B: 0.763, C: 0.734, D: 0.831, E: 0.684, F: 0.684, G: 0.821, H: 0.837, I: 0.373,
  J: 0.373, K: 0.775, L: 0.638, M: 0.996, N: 0.837, O: 0.851, P: 0.733, Q: 0.851, R: 0.771,
  S: 0.721, T: 0.683, U: 0.813, V: 0.774, W: 1.104, X: 0.771, Y: 0.725, Z: 0.726, '-': 0.416,
  ' ': 0.349,
};

/** Width in em by the wide table (an unknown character counts as a full em). */
export const wideEm: MeasureEm = (t) =>
  [...t].reduce((s, c) => s + (WIDE_EM[c] ?? (/\d/.test(c) ? 0.696 : 1)), 0);

/** Half the height of a capital (0.73 em), which sits about centred in a line box (line-height 1). */
const CAP_HALF = 0.37;

/**
 * The largest font scale (≤ `cap`) at which a block of `lines` lines (line-height 1) whose widest
 * line is `em` wide stays `LABEL_MARGIN` inside the rounded button: its corners must clear the rim.
 */
function maxScale(shape: ButtonShape, em: number, lines: number, cap: number): number {
  const r = Math.min(shape.w, shape.h) / 2 - BUTTON_BORDER - LABEL_MARGIN;
  const straight = Math.abs(shape.w - shape.h) / 2;
  const fits = (s: number) => {
    const y = (lines / 2 - 0.5 + CAP_HALF) * shape.font * s;
    return y < r && (em * shape.font * s) / 2 <= straight + Math.sqrt(r * r - y * y);
  };
  if (fits(cap)) return cap;
  let lo = 0;
  let hi = cap;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Ways to put `text` on two lines: after a space or a hyphen (HI-JUMP → HI- / JUMP). */
function twoLineSplits(text: string): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 1; i < text.length; i++) {
    if (text[i - 1] === '-' || (text[i] === ' ' && text[i - 1] !== ' ')) {
      const a = text.slice(0, i).trim();
      const b = text.slice(i).trim();
      if (a && b) out.push([a, b]);
    }
  }
  return out;
}

export interface LabelFit {
  /** Font scale for the button (`--fs`), never below LABEL_MIN_PX. */
  scale: number;
  /** One line, or two when that reads bigger (only at a space or hyphen). */
  lines: string[];
  wrap: boolean;
  /**
   * False when the label only fits below LABEL_MIN_PX (LABEL_LONG_WORD_MIN_PX for a single word);
   * it is then drawn at that floor, clipped.
   */
  fits: boolean;
}

/**
 * How to draw `text` on a button: one line as big as fits, or, for a label with a space or a
 * hyphen that would otherwise be small, two lines. `measure` gives text width in em (by default
 * the wide table; the page passes the real font's).
 */
export function fitLabel(text: string, shape: ButtonShape, measure: MeasureEm = wideEm): LabelFit {
  const t = text.trim();
  let scale = maxScale(shape, measure(t), 1, 1);
  let lines = [t];
  if (scale < LABEL_ONE_LINE_SCALE) {
    for (const split of twoLineSplits(t)) {
      const s = maxScale(shape, Math.max(...split.map(measure)), 2, LABEL_WRAP_SCALE);
      if (s > scale) {
        scale = s;
        lines = split;
      }
    }
  }
  // A single word that cannot wrap may go below the floor, down to LABEL_LONG_WORD_MIN_PX.
  const longWord = !/[\s-]/.test(t) && scale * shape.font < LABEL_MIN_PX;
  const min = (longWord ? LABEL_LONG_WORD_MIN_PX : LABEL_MIN_PX) / shape.font;
  const fits = scale >= min;
  return { scale: Math.max(min, Math.floor(scale * 100) / 100), lines, wrap: lines.length > 1, fits };
}

/** The little of an element that labelling needs (a DOM element, or a stub in tests). */
export interface LabelTarget {
  textContent: string | null;
  style: { setProperty(name: string, value: string): void };
  classList: { toggle(token: string, force?: boolean): boolean };
}

export interface LabelSlot {
  el: LabelTarget;
  /** Label shown when the scene gives none (the A/B/C identity). */
  def: string;
  shape: ButtonShape;
}

/**
 * Applies TouchLabels to the buttons. Only touches the DOM for buttons whose label changed, so
 * it is cheap to call every frame. `null` hides a button; an absent key restores its default.
 * A two-line label is written with a line break (the button keeps line breaks: pre-line).
 */
export class ButtonLabeler {
  private readonly current = new Map<Action, string | null>();

  constructor(
    private readonly slots: ReadonlyMap<Action, LabelSlot>,
    private readonly measure: MeasureEm = wideEm,
  ) {
    for (const [a, s] of slots) this.current.set(a, s.def);
  }

  /** Returns the actions whose buttons were hidden by this call. */
  apply(labels: TouchLabels): Action[] {
    const hidden: Action[] = [];
    for (const [a, slot] of this.slots) {
      const given = labels[a];
      const next = given === undefined ? slot.def : given;
      if (this.current.get(a) === next) continue;
      this.current.set(a, next);
      const el = slot.el;
      el.classList.toggle('hidden', next === null);
      if (next === null) {
        hidden.push(a);
        continue;
      }
      const fit = fitLabel(next, slot.shape, this.measure);
      el.textContent = fit.lines.join('\n');
      el.style.setProperty('--fs', String(fit.scale));
      el.classList.toggle('wrap', fit.wrap);
    }
    return hidden;
  }

  label(a: Action): string | null | undefined {
    return this.current.get(a);
  }
}

// ---- Held buttons ----------------------------------------------------------------------------

/** A pointer holding a face or small button: what it presses now, and whether it may slide. */
export interface HeldButton {
  action: Action | null;
  /** A thumb may roll onto the next face button without lifting. */
  slide: boolean;
}

/**
 * The scene hid buttons (`hidden`): a pointer holding one lets go of it, and stays let go until it
 * lifts (0.5.0). Without that, a thumb held on JUMP when a card opened re-took the card's OK as a
 * fresh press the moment it reappeared after the guard and moved a pixel, skipping the card.
 * True when the pointer changed.
 */
export function releaseHidden(p: HeldButton, hidden: readonly Action[]): boolean {
  if (!p.action || !hidden.includes(p.action)) return false;
  p.action = null;
  p.slide = false;
  return true;
}

/** A held pointer moved over `next` (the face button under it, or none). True when it changed. */
export function slideHeld(p: HeldButton, next: Action | null): boolean {
  if (!p.slide || next === p.action) return false;
  p.action = next;
  return true;
}
