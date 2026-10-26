import type { Action } from './actions';
import type { Code } from './bindings';
import type { InputSource } from './input-manager';
import type { DpadStyle, TouchMode } from '../save/settings';
import {
  BUTTON_BORDER,
  BUTTON_FONT,
  ButtonLabeler,
  DPAD_HIT_SCALE,
  FACE_BUTTON,
  DPAD_RUN_R,
  FLOAT_ZONE_FRACTION,
  NO_DIRS,
  DPAD_ZONES,
  dpadDirs,
  clampCentre,
  followCentre,
  hitButton,
  releaseHidden,
  slideHeld,
  readTouchFacts,
  SMALL_BUTTON,
  buttonShape,
  BUTTON_PLACES,
  GAME_FRAME,
  touchPadVisible,
  type ButtonTarget,
  type DpadDirs,
  type DpadZoneId,
  type LabelSlot,
  type LastInput,
  type MeasureEm,
} from './touch-logic';
import type { ControlId, Place, ScreenLayout } from './touch-layout';

/**
 * What each touch button says, from the current scene (Scene.touchLabels). A string is the label,
 * `null` hides that button, and an absent key keeps the default (A, B, C, START, SELECT).
 */
export type TouchLabels = Partial<Record<Action, string | null>>;

type PointerState =
  | { kind: 'dpad'; cx: number; cy: number; radius: number }
  /** `slide`: a face button pointer is hit-tested on every move, so a thumb can roll B → A. */
  | { kind: 'btn'; action: Action | null; slide: boolean };

/** Face buttons a thumb can slide between. */
const FACE: readonly Action[] = ['jump', 'attack', 'special'];
const DIRS = ['left', 'right', 'up', 'down'] as const;

/** An annular wedge of the drawn pad (SVG units, pad radius 100), centred on `deg` (0 = right, 90 = down). */
function wedge(deg: number): string {
  const half = 41;
  const r0 = 26;
  const r1 = 70;
  const p = (r: number, a: number) => {
    const t = (a * Math.PI) / 180;
    return `${(r * Math.cos(t)).toFixed(1)} ${(r * Math.sin(t)).toFixed(1)}`;
  };
  const a0 = deg - half;
  const a1 = deg + half;
  return `M${p(r0, a0)} L${p(r1, a0)} A${r1} ${r1} 0 0 1 ${p(r1, a1)} L${p(r0, a1)} A${r0} ${r0} 0 0 0 ${p(r0, a0)}Z`;
}

/**
 * On-screen controls for phones and tablets: a d-pad (fixed, or a floating stick) on the left,
 * face buttons on the right, and small start/select buttons. Multi-touch aware: every pointer is
 * tracked on its own and hit-tested as it moves, so a thumb can slide across the d-pad or roll
 * from one face button to another. Pushing the d-pad past the drawn ring also holds `run`.
 * Emits codes `touch:<action>` that the InputManager maps for player 1.
 */
export class TouchSource implements InputSource {
  /** Codes held by the pointers right now. */
  private down = new Set<Code>();
  /** Codes that went down since the last poll (a tap shorter than one frame still counts). */
  private readonly latched = new Set<Code>();
  private polled = new Set<Code>();
  private readonly root: HTMLElement;
  private readonly pointers = new Map<number, PointerState>();
  private readonly hit: HTMLElement;
  private readonly pad: HTMLElement;
  private readonly thumb: HTMLElement;
  private readonly buttons = new Map<Action, HTMLElement>();
  private keySig = '';
  private readonly labeler: ButtonLabeler;
  private dirs: DpadDirs = { ...NO_DIRS };
  /** The d-pad's zone set, from the scene on top (setDpadZones). */
  private zones: DpadZoneId = 'default';
  /** Where the d-pad's thumb was (client px), so a zone change re-reads a still thumb. */
  private thumbAt: { x: number; y: number } | null = null;
  private visible = false;
  private mode: TouchMode = 'auto';
  private style: DpadStyle = 'fixed';
  private last: LastInput = null;

  constructor(container: HTMLElement, scale = 1) {
    this.root = document.createElement('div');
    this.root.className = 'touch-controls';
    this.root.setAttribute('aria-hidden', 'true');
    // The overlay gives its children pointer events; this layer only wants them on its controls.
    this.root.style.pointerEvents = 'none';
    this.root.style.setProperty('--ts', String(scale));
    const hitPad = ((DPAD_HIT_SCALE - 1) / 2) * 150;
    this.root.innerHTML = `
      <style>
        .touch-controls { position: fixed; ${GAME_FRAME} display: none; }
        .touch-controls.visible { display: block; }
        .touch-controls .tc { position: absolute; pointer-events: auto; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
        .touch-controls .zone { left: 0; top: 0; width: ${FLOAT_ZONE_FRACTION * 100}%; height: 100%; display: none; }
        .touch-controls.floating .zone { display: block; }
        .touch-controls .dpad-hit { left: calc(${16 - hitPad}px * var(--ts)); bottom: calc(${24 - hitPad}px * var(--ts)); width: calc(${150 + 2 * hitPad}px * var(--ts)); height: calc(${150 + 2 * hitPad}px * var(--ts)); }
        .touch-controls.floating .dpad-hit { pointer-events: none; }
        .touch-controls .dpad { position: absolute; left: calc(${hitPad}px * var(--ts)); top: calc(${hitPad}px * var(--ts)); width: calc(150px * var(--ts)); height: calc(150px * var(--ts)); pointer-events: none; }
        .touch-controls.floating .dpad { opacity: 0.35; }
        .touch-controls.floating.active .dpad { opacity: 1; }
        .touch-controls .dpad svg { width: 100%; height: 100%; overflow: visible; }
        .touch-controls .dpad .base { fill: rgba(255,255,255,0.10); stroke: rgba(255,255,255,0.35); stroke-width: 2.5; }
        .touch-controls .dpad .ring { fill: none; stroke: rgba(255,255,255,0.22); stroke-width: 2; stroke-dasharray: 5 6; }
        .touch-controls.running .dpad .ring { stroke: rgba(255,214,90,0.9); stroke-width: 4; stroke-dasharray: none; }
        .touch-controls .dpad .wedge { fill: rgba(255,255,255,0.16); }
        .touch-controls .dpad .wedge.on { fill: rgba(255,255,255,0.6); }
        .touch-controls .thumb { position: absolute; left: 50%; top: 50%; width: 34%; height: 34%; margin: -17% 0 0 -17%; border-radius: 50%; background: rgba(255,255,255,0.45); border: 2px solid rgba(255,255,255,0.7); display: none; }
        .touch-controls.active .thumb { display: block; }
        .touch-controls .btn { width: calc(${FACE_BUTTON.w}px * var(--ts)); height: calc(${FACE_BUTTON.h}px * var(--ts)); border-radius: 50%; background: rgba(255,255,255,0.14); border: ${BUTTON_BORDER}px solid rgba(255,255,255,0.4); color: #fff; font: bold calc(${FACE_BUTTON.font}px * var(--ts) * var(--fs, 1)) ${BUTTON_FONT}; line-height: 1; text-align: center; white-space: nowrap; overflow: hidden; text-transform: uppercase; display: flex; align-items: center; justify-content: center; box-sizing: border-box; padding: 0; }
        .touch-controls .btn.wrap { white-space: pre-line; }
        .touch-controls.key-hints .btn::after { content: attr(data-key); position: absolute; left: 0; right: 0; bottom: 9%; font-size: calc(9px * var(--ts)); font-weight: normal; opacity: 0.7; }
        .touch-controls .btn.hidden { display: none; }
        .touch-controls .btn.active { background: rgba(255,255,255,0.45); }
        .touch-controls .btn.a { border-color: rgba(255,150,150,0.6); }
        .touch-controls .btn.b { border-color: rgba(150,190,255,0.6); }
        .touch-controls .btn.c { border-color: rgba(170,255,170,0.6); }
        ${Object.entries(BUTTON_PLACES)
          .map(
            ([a, p]) =>
              `.touch-controls .${a} { ${Object.entries(p)
                .map(([k, v]) => `${k}: calc(${v}px * var(--ts));`)
                .join(' ')} }`,
          )
          .join('\n        ')}
        .touch-controls .start, .touch-controls .select { width: calc(${SMALL_BUTTON.w}px * var(--ts)); height: calc(${SMALL_BUTTON.h}px * var(--ts)); border-radius: calc(${SMALL_BUTTON.h / 2}px * var(--ts)); font-size: calc(${SMALL_BUTTON.font}px * var(--ts) * var(--fs, 1)); }
      </style>
      <div class="tc zone" data-zone></div>
      <div class="tc dpad-hit" data-dpad>
        <div class="dpad">
          <svg viewBox="-100 -100 200 200" aria-hidden="true">
            <circle class="base" r="97"></circle>
            ${DIRS.map((d) => `<path class="wedge" data-dir="${d}" d="${wedge({ right: 0, down: 90, left: 180, up: 270 }[d])}"></path>`).join('')}
            <circle class="ring" r="${DPAD_RUN_R * 100}"></circle>
          </svg>
          <div class="thumb"></div>
        </div>
      </div>
      <div class="tc btn a jump" data-action="jump" data-id="A">JUMP</div>
      <div class="tc btn b attack" data-action="attack" data-id="B">ATTACK</div>
      <div class="tc btn c special" data-action="special" data-id="C">SPECIAL</div>
      <div class="tc btn start" data-action="start">MENU</div>
      <div class="tc btn select" data-action="select">TOOLS</div>`;
    container.appendChild(this.root);
    this.hit = this.root.querySelector('[data-dpad]') as HTMLElement;
    this.pad = this.root.querySelector('.dpad') as HTMLElement;
    this.thumb = this.root.querySelector('.thumb') as HTMLElement;
    const slots = new Map<Action, LabelSlot>();
    this.root.querySelectorAll<HTMLElement>('[data-action]').forEach((el) => {
      const a = el.dataset.action as Action;
      this.buttons.set(a, el);
      slots.set(a, { el, def: el.textContent ?? '', shape: buttonShape(a) });
    });
    this.labeler = new ButtonLabeler(slots, canvasMeasure());
    this.bind();
  }

  /** Does the device look like a phone or tablet (coarse pointer that cannot hover)? */
  static likelyTouchDevice(): boolean {
    const f = readTouchFacts();
    return f.coarsePointer && f.hoverNone;
  }

  setScale(scale: number): void {
    this.root.style.setProperty('--ts', String(scale));
  }

  /**
   * Place the controls by the screen layout (touch-layout.ts, 0.4.45): its scale, and each
   * control's place in px inside the box (the d-pad's hit area keeps its margin around the pad).
   */
  applyLayout(layout: ScreenLayout): void {
    const s = layout.scale;
    this.setScale(s);
    const hitPad = ((DPAD_HIT_SCALE - 1) / 2) * 150 * s;
    const put = (el: HTMLElement | undefined, p: Place, pad = 0) => {
      if (!el) return;
      for (const k of ['left', 'right', 'top', 'bottom'] as const) {
        const v = p[k];
        el.style[k] = v === undefined ? 'auto' : `${v - pad}px`;
      }
    };
    for (const id of Object.keys(layout.places) as ControlId[]) {
      if (id === 'dpad') put(this.hit, layout.places.dpad, hitPad);
      else put(this.buttons.get(id), layout.places[id]);
    }
  }

  /** 'on'/'off' force the pad; 'auto' follows the device and the last input used. */
  setMode(mode: TouchMode): void {
    this.mode = mode;
    this.refresh();
  }

  setDpadStyle(style: DpadStyle): void {
    if (style === this.style) return;
    this.style = style;
    this.root.classList.toggle('floating', style === 'floating');
    this.releaseAll();
  }

  /** Tell auto mode which kind of input was used last ('keys' also covers gamepad buttons). */
  noteInput(kind: 'touch' | 'keys'): void {
    if (this.last === kind) return;
    this.last = kind;
    this.refresh();
  }

  /** Set the button labels for the current scene; cheap to call every frame. */
  setLabels(labels: TouchLabels): void {
    const hidden = this.labeler.apply(labels);
    if (!hidden.length) return;
    // A held button that hides is let go until the finger lifts (touch-logic releaseHidden).
    for (const p of this.pointers.values()) if (p.kind === 'btn') releaseHidden(p, hidden);
    this.update();
  }

  /** The scene's d-pad zones (Scene.touchDpad); cheap to call every frame. */
  setDpadZones(id: DpadZoneId): void {
    if (id === this.zones) return;
    this.zones = id;
    // A thumb already on the pad is read again with the new zones.
    if (!this.thumbAt) return;
    this.moveDpad(this.thumbAt.x, this.thumbAt.y);
    this.update();
  }

  /** Key hints: each button's keyboard key as a small second line (null turns them off). */
  setKeyHints(keys: Partial<Record<Action, string>> | null): void {
    const sig = keys ? JSON.stringify(keys) : '';
    if (sig === this.keySig) return;
    this.keySig = sig;
    this.root.classList.toggle('key-hints', !!keys);
    for (const [a, el] of this.buttons) el.dataset.key = keys?.[a] ?? '';
  }

  show(on: boolean): void {
    this.visible = on;
    this.root.classList.toggle('visible', on);
    if (!on) this.releaseAll();
  }

  get shown(): boolean {
    return this.visible;
  }

  /** The kind of input used last (a touch, or a key / gamepad button), null before any. */
  get lastInput(): LastInput {
    return this.last;
  }

  private refresh(): void {
    const on = touchPadVisible(this.mode, readTouchFacts(), this.last);
    if (on !== this.visible) this.show(on);
  }

  private bind(): void {
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.root.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e));
    // Auto mode: a real touch brings the pad up, a key or gamepad button puts it away.
    window.addEventListener('touchstart', () => this.noteInput('touch'), { passive: true, capture: true });
    window.addEventListener(
      'keydown',
      (e) => {
        const t = e.target as HTMLElement | null;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        this.noteInput('keys');
      },
      { capture: true },
    );
    for (const q of ['(pointer: coarse)', '(hover: none)']) {
      if (typeof matchMedia === 'function') matchMedia(q).addEventListener?.('change', () => this.refresh());
    }
  }

  /**
   * A button went down or came up, called inside that pointer event (main.ts: a confirm button's
   * release is the user gesture iOS needs for sharing and the clipboard, engine/input/gesture.ts).
   */
  onButton: ((action: Action, down: boolean) => void) | null = null;

  private onDown(e: PointerEvent): void {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLElement>('[data-action]');
    if (btn) {
      e.preventDefault();
      const action = btn.dataset.action as Action;
      this.pointers.set(e.pointerId, { kind: 'btn', action, slide: FACE.includes(action) });
      this.onButton?.(action, true);
    } else if (target.closest('[data-dpad]') || target.closest('[data-zone]')) {
      e.preventDefault();
      // One thumb drives the pad; a new touch on it takes over.
      for (const [id, p] of this.pointers) if (p.kind === 'dpad') this.pointers.delete(id);
      const rest = this.restCentre();
      // The floating stick centres under the thumb, but never so near an edge that a push
      // towards that edge (down at the bottom, left at the left) has no room.
      const c =
        this.style === 'floating'
          ? this.clampToSafeBox(e.clientX, e.clientY, rest.radius)
          : { cx: rest.x, cy: rest.y };
      this.pointers.set(e.pointerId, { kind: 'dpad', cx: c.cx, cy: c.cy, radius: rest.radius });
      this.moveDpad(e.clientX, e.clientY);
    } else return;
    this.update();
  }

  private onMove(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    if (p.kind === 'dpad') this.moveDpad(e.clientX, e.clientY);
    else if (p.slide) {
      if (!slideHeld(p, hitButton(e.clientX, e.clientY, this.faceTargets()))) return;
    } else return;
    this.update();
  }

  private onUp(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (p.kind === 'dpad') {
      this.thumbAt = null;
      this.setDirs({ ...NO_DIRS }, 0, 0);
    }
    this.update();
    if (p.kind === 'btn' && p.action && e.type === 'pointerup') this.onButton?.(p.action, false);
  }

  /** The drawn pad's resting centre and radius in client px. */
  private restCentre(): { x: number; y: number; radius: number } {
    const r = this.hit.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, radius: r.width / DPAD_HIT_SCALE / 2 };
  }

  /** clampCentre inside the pad's box (the screen less the safe-area insets), in client px. */
  private clampToSafeBox(x: number, y: number, radius: number): { cx: number; cy: number } {
    const b = this.root.getBoundingClientRect();
    const w = b.width || innerWidth;
    const h = b.height || innerHeight;
    const c = clampCentre(x - b.left, y - b.top, radius, w, h);
    return { cx: c.cx + b.left, cy: c.cy + b.top };
  }

  private moveDpad(x: number, y: number): void {
    const p = [...this.pointers.values()].find((q) => q.kind === 'dpad');
    if (!p || p.kind !== 'dpad') return;
    if (this.style === 'floating') {
      const f = followCentre(p.cx, p.cy, x, y, p.radius);
      const c = this.clampToSafeBox(f.cx, f.cy, p.radius);
      p.cx = c.cx;
      p.cy = c.cy;
      const rest = this.restCentre();
      this.pad.style.transform = `translate(${p.cx - rest.x}px, ${p.cy - rest.y}px)`;
    }
    this.thumbAt = { x, y };
    const d = dpadDirs(x - p.cx, y - p.cy, p.radius, DPAD_ZONES[this.zones]);
    this.setDirs(d, x - p.cx, y - p.cy, p.radius);
  }

  /** Update held directions and the pad's feedback (wedges, thumb dot, run ring, a buzz). */
  private setDirs(d: DpadDirs, dx: number, dy: number, radius = 1): void {
    const changed = DIRS.some((k) => d[k] !== this.dirs[k]);
    if (changed && DIRS.some((k) => d[k])) buzz();
    this.dirs = d;
    for (const k of DIRS) this.root.querySelector(`[data-dir="${k}"]`)?.classList.toggle('on', d[k]);
    const active = [...this.pointers.values()].some((q) => q.kind === 'dpad');
    this.root.classList.toggle('active', active);
    this.root.classList.toggle('running', d.run);
    const k = Math.min(1, radius / Math.max(1, Math.hypot(dx, dy)));
    this.thumb.style.transform = active ? `translate(${dx * k}px, ${dy * k}px)` : '';
    if (!active) this.pad.style.transform = '';
  }

  private faceTargets(): ButtonTarget[] {
    const out: ButtonTarget[] = [];
    for (const a of FACE) {
      const el = this.buttons.get(a);
      if (!el || el.classList.contains('hidden')) continue;
      const r = el.getBoundingClientRect();
      out.push({ action: a, cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: r.width / 2 });
    }
    return out;
  }

  /** Recompute the held codes from every pointer, and the buttons' pressed look. */
  private update(): void {
    const next = new Set<Code>();
    for (const p of this.pointers.values()) if (p.kind === 'btn' && p.action) next.add(`touch:${p.action}`);
    for (const k of DIRS) if (this.dirs[k]) next.add(`touch:${k}`);
    if (this.dirs.run) next.add('touch:run');
    for (const c of next) if (!this.down.has(c)) this.latched.add(c);
    this.down = next;
    for (const [a, el] of this.buttons) el.classList.toggle('active', next.has(`touch:${a}`));
    this.root.dataset.held = [...next].map((c) => c.slice(6)).join(' ');
  }

  private releaseAll(): void {
    this.pointers.clear();
    this.thumbAt = null;
    this.setDirs({ ...NO_DIRS }, 0, 0);
    this.latched.clear();
    this.update();
  }

  poll(): ReadonlySet<Code> {
    this.polled = new Set(this.down);
    for (const c of this.latched) this.polled.add(c);
    this.latched.clear();
    return this.polled;
  }
}

/**
 * Label widths in the font the page really draws (a phone's Roboto or SF is narrower than the
 * fallback table, so labels there can be bigger); the table when there is no canvas.
 */
function canvasMeasure(): MeasureEm | undefined {
  const ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  if (!ctx) return undefined;
  ctx.font = `bold 100px ${BUTTON_FONT}`;
  const cache = new Map<string, number>();
  return (t) => {
    let w = cache.get(t);
    if (w === undefined) cache.set(t, (w = ctx.measureText(t).width / 100));
    return w;
  };
}

/** A short tick on direction changes where the browser supports it (not iOS Safari). */
function buzz(): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    // Before the first user gesture Chrome refuses (and logs "Blocked call to navigator.vibrate").
    const activation = (navigator as { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (activation && !activation.hasBeenActive) return;
    navigator.vibrate(8);
  } catch {
    // Some browsers throw when vibration is blocked (no user activation yet); it is only a nicety.
  }
}
