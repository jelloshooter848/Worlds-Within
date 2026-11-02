import { describe, expect, it } from 'vitest';
import {
  ButtonLabeler,
  DPAD_DEAD,
  DPAD_DOWN_MIN_R,
  DPAD_FOLLOW_R,
  DPAD_HORIZONTAL_MAX_DEG,
  DPAD_RUN_R,
  DPAD_UP_MIN_DEG,
  EIGHT_WAY_DPAD_ZONES,
  FACE_BUTTON,
  LABEL_LONG_WORD_MIN_PX,
  LABEL_MIN_PX,
  LABEL_WRAP_SCALE,
  SMALL_BUTTON,
  buttonShape,
  BUTTON_PLACES,
  dpadDirs,
  fitLabel,
  followCentre,
  clampCentre,
  FLOAT_EDGE_R,
  nextTouchMode,
  hitButton,
  readTouchFacts,
  touchPadVisible,
  type LabelSlot,
  type LabelTarget,
} from './touch-logic';
import type { Action } from './actions';
import type { TouchMode } from '../save/settings';

const R = 75;
/** Thumb at `deg` (0 = right, 90 = up, counter-clockwise like a maths diagram) and `r` × radius. */
function at(deg: number, r: number) {
  const t = (deg * Math.PI) / 180;
  return dpadDirs(Math.cos(t) * r * R, -Math.sin(t) * r * R, R);
}
const held = (d: ReturnType<typeof dpadDirs>) =>
  (['left', 'right', 'up', 'down', 'run'] as const).filter((k) => d[k]).join('+') || 'none';

describe('dpadDirs: angle zones', () => {
  it('holds nothing inside the dead zone', () => {
    expect(held(at(0, DPAD_DEAD * 0.9))).toBe('none');
    expect(held(at(270, DPAD_DEAD * 0.9))).toBe('none');
    expect(held(dpadDirs(0, 0, R))).toBe('none');
    expect(held(dpadDirs(10, 0, 0))).toBe('none'); // degenerate radius
  });

  it('left and right are wide: about ±60° around horizontal', () => {
    for (const deg of [0, 20, 30, -30]) expect(held(at(deg, 0.5))).toBe('right');
    for (const deg of [180, 160, 200]) expect(held(at(deg, 0.5))).toBe('left');
    expect(at(DPAD_HORIZONTAL_MAX_DEG - 1, 0.5).right).toBe(true);
    expect(at(DPAD_HORIZONTAL_MAX_DEG + 1, 0.5).right).toBe(false);
  });

  it('up is narrower, with diagonals only in the band between', () => {
    expect(held(at(90, 0.5))).toBe('up');
    expect(held(at(70, 0.5))).toBe('up');
    expect(held(at(45, 0.5))).toBe('right+up');
    expect(held(at(135, 0.5))).toBe('left+up');
    expect(at(DPAD_UP_MIN_DEG - 1, 0.5).up).toBe(false);
  });

  it('straight down engages as easily as up', () => {
    expect(held(at(270, DPAD_DEAD + 0.05))).toBe('down');
    // Anywhere in the straight-down band (just inside ±30° of vertical; exactly 240°/300° is
    // the left/right band's edge and rounds into it).
    expect(held(at(241, 0.3))).toBe('down');
    expect(held(at(299, 0.3))).toBe('down');
    // Up and down engage at the same radius: the dead zone.
    for (const deg of [90, 270]) {
      expect(held(at(deg, DPAD_DEAD * 0.99))).toBe('none');
      expect(held(at(deg, DPAD_DEAD))).not.toBe('none');
    }
  });

  it('only the down-diagonals need a firmer push, so running never crouches by accident', () => {
    expect(DPAD_DOWN_MIN_R).toBeGreaterThan(DPAD_DEAD);
    // A thumb sagging down-right while running stays plain right until pushed hard.
    expect(held(at(-50, 0.5))).toBe('right');
    expect(held(at(-50, 0.7))).toBe('right+down');
    expect(held(at(-30, 1))).toBe('right+run');
  });

  it('a far push left or right also holds run (the drawn ring)', () => {
    expect(at(0, DPAD_RUN_R - 0.02).run).toBe(false);
    expect(held(at(0, DPAD_RUN_R + 0.02))).toBe('right+run');
    expect(held(at(180, 1.3))).toBe('left+run');
    expect(held(at(45, 1))).toBe('right+up+run');
    // Straight up or down never runs.
    expect(at(90, 1).run).toBe(false);
    expect(at(270, 1).run).toBe(false);
  });

  it('covers all eight directions', () => {
    const seen = new Set<string>();
    for (let deg = 0; deg < 360; deg += 5) seen.add(held(at(deg, 0.7)));
    expect([...seen].sort()).toEqual(
      ['down', 'left', 'left+down', 'left+up', 'right', 'right+down', 'right+up', 'up'].sort(),
    );
  });
});

describe('dpadDirs: eight-way zones (a hero who never crouches: Sophia III)', () => {
  const at8 = (deg: number, r: number) => {
    const t = (deg * Math.PI) / 180;
    return dpadDirs(Math.cos(t) * r * R, -Math.sin(t) * r * R, R, EIGHT_WAY_DPAD_ZONES);
  };

  it('even 45° sectors: straight within ±22.5°, diagonals between', () => {
    expect(held(at8(0, 0.5))).toBe('right');
    expect(held(at8(20, 0.5))).toBe('right');
    expect(held(at8(25, 0.5))).toBe('right+up');
    expect(held(at8(65, 0.5))).toBe('right+up');
    expect(held(at8(70, 0.5))).toBe('up');
    expect(held(at8(270, 0.5))).toBe('down');
    expect(held(at8(180 + 45, 0.5))).toBe('left+down');
  });

  it('the down-diagonals need no firmer push than the dead zone', () => {
    // Where the default pad reads plain right (a light push down-right), this one holds both.
    expect(held(at(-50, 0.3))).toBe('right');
    expect(held(at8(-50, 0.3))).toBe('right+down');
    expect(held(at8(-45, DPAD_DEAD + 0.01))).toBe('right+down');
    expect(held(at8(-45, DPAD_DEAD * 0.9))).toBe('none');
  });

  it('a far push still runs, and all eight directions are there', () => {
    expect(held(at8(0, 1))).toBe('right+run');
    expect(held(at8(-45, 1))).toBe('right+down+run');
    const seen = new Set<string>();
    for (let deg = 0; deg < 360; deg += 5) seen.add(held(at8(deg, 0.5)));
    expect([...seen].sort()).toEqual(
      ['down', 'left', 'left+down', 'left+up', 'right', 'right+down', 'right+up', 'up'].sort(),
    );
  });
});

describe('floating stick', () => {
  it('stays put inside the follow radius and trails a thumb dragged far out', () => {
    expect(followCentre(100, 100, 150, 100, 50)).toEqual({ cx: 100, cy: 100 });
    const c = followCentre(100, 100, 300, 100, 50);
    expect(c.cy).toBe(100);
    expect(300 - c.cx).toBeCloseTo(DPAD_FOLLOW_R * 50);
    // After following, the thumb is still past the run ring.
    expect(dpadDirs(300 - c.cx, 0, 50).run).toBe(true);
  });

  it('keeps its centre 0.8 × radius from every screen edge', () => {
    const [w, h] = [844, 390];
    expect(clampCentre(300, 200, R, w, h)).toEqual({ cx: 300, cy: 200 });
    expect(clampCentre(6, 378, R, w, h)).toEqual({ cx: FLOAT_EDGE_R * R, cy: h - FLOAT_EDGE_R * R });
    expect(clampCentre(840, 2, R, w, h)).toEqual({ cx: w - FLOAT_EDGE_R * R, cy: FLOAT_EDGE_R * R });
  });

  it('a touch 12 px from the bottom can still press down; 6 px from the left can go and run left', () => {
    const [w, h] = [844, 390];
    const low = clampCentre(200, h - 12, R, w, h);
    expect(held(dpadDirs(0, h - 12 - low.cy, R))).toBe('down'); // no slide needed
    expect(held(dpadDirs(0, h - 1 - low.cy, R))).toBe('down');
    const side = clampCentre(6, 200, R, w, h);
    expect(held(dpadDirs(6 - side.cx, 0, R))).toBe('left');
    expect(held(dpadDirs(0 - side.cx, 0, R))).toBe('left+run'); // thumb at the very edge
    // Without the clamp the centre would sit under the thumb and neither could happen.
    expect(held(dpadDirs(0, 11, R))).toBe('none');
  });
});

describe('nextTouchMode (pause and Options rows)', () => {
  it('cycles Auto → On → Off with a keyboard or gamepad', () => {
    for (const last of ['keys', null] as const) {
      expect(nextTouchMode('auto', 1, last)).toBe('on');
      expect(nextTouchMode('on', 1, last)).toBe('off');
      expect(nextTouchMode('off', 1, last)).toBe('auto');
      expect(nextTouchMode('auto', -1, last)).toBe('off');
    }
  });

  it('on touch only Auto ↔ On: pressing OK repeatedly never reaches Off', () => {
    let m: TouchMode = 'auto';
    for (let i = 0; i < 6; i++) {
      m = nextTouchMode(m, i % 2 ? -1 : 1, 'touch');
      expect(m).not.toBe('off');
    }
    expect(nextTouchMode('auto', 1, 'touch')).toBe('on');
    expect(nextTouchMode('on', 1, 'touch')).toBe('auto');
    expect(nextTouchMode('auto', -1, 'touch')).toBe('on');
    expect(nextTouchMode('off', 1, 'touch')).toBe('auto');
  });
});

describe('touchPadVisible', () => {
  const phone = { coarsePointer: true, hoverNone: true };
  const desktop = { coarsePointer: false, hoverNone: false };
  const touchLaptop = { coarsePointer: false, hoverNone: false }; // touchscreen, but a mouse/trackpad is primary
  const stylusTablet = { coarsePointer: true, hoverNone: false };

  it('auto shows the pad on phones and tablets only', () => {
    expect(touchPadVisible('auto', phone, null)).toBe(true);
    expect(touchPadVisible('auto', desktop, null)).toBe(false);
    expect(touchPadVisible('auto', touchLaptop, null)).toBe(false);
    expect(touchPadVisible('auto', stylusTablet, null)).toBe(false);
  });

  it('auto follows the last input: a touch shows it, a key or pad button hides it', () => {
    expect(touchPadVisible('auto', desktop, 'touch')).toBe(true);
    expect(touchPadVisible('auto', phone, 'keys')).toBe(false);
  });

  it('on and off are hard overrides', () => {
    for (const facts of [phone, desktop])
      for (const last of ['touch', 'keys', null] as const) {
        expect(touchPadVisible('on', facts, last)).toBe(true);
        expect(touchPadVisible('off', facts, last)).toBe(false);
      }
  });

  it('reads the media facts from matchMedia', () => {
    const mm = (q: string) => ({ matches: q === '(pointer: coarse)' });
    expect(readTouchFacts(mm)).toEqual({ coarsePointer: true, hoverNone: false });
    expect(readTouchFacts(undefined)).toEqual({ coarsePointer: false, hoverNone: false });
  });
});

describe('hitButton', () => {
  const targets = [
    { action: 'jump' as const, cx: 300, cy: 200, r: 34 },
    { action: 'attack' as const, cx: 220, cy: 216, r: 34 },
  ];
  it('picks the button under the thumb, the nearest when the slack overlaps', () => {
    expect(hitButton(300, 200, targets)).toBe('jump');
    expect(hitButton(225, 210, targets)).toBe('attack');
    expect(hitButton(262, 208, targets)).toBe('jump'); // between, slightly nearer A
    expect(hitButton(100, 100, targets)).toBeNull();
  });
});

describe('labels', () => {
  const px = (l: string, shape = FACE_BUTTON) => fitLabel(l, shape).scale * shape.font;

  it('A, B and C are one size; Start and Select are pills', () => {
    for (const a of ['jump', 'attack', 'special'] as const) expect(buttonShape(a)).toBe(FACE_BUTTON);
    for (const a of ['start', 'select'] as const) expect(buttonShape(a)).toBe(SMALL_BUTTON);
  });

  it('short labels are full size; longer single words shrink to fit', () => {
    expect(fitLabel('JUMP', FACE_BUTTON)).toEqual({ scale: 1, lines: ['JUMP'], wrap: false, fits: true });
    expect(px('SWORD')).toBeLessThan(FACE_BUTTON.font);
    expect(px('SWORD')).toBeGreaterThan(px('KNUCKLE'));
    expect(px('PAUSE', SMALL_BUTTON)).toBe(SMALL_BUTTON.font);
  });

  it('wraps after a space or hyphen when one line would be small', () => {
    const hi = fitLabel('HI-JUMP', FACE_BUTTON);
    expect(hi.lines).toEqual(['HI-', 'JUMP']);
    expect(hi.scale).toBe(LABEL_WRAP_SCALE);
    expect(fitLabel('TOOL BELT', FACE_BUTTON).lines).toEqual(['TOOL', 'BELT']);
    // Fits on one line big enough: no wrap.
    expect(fitLabel('M-GUN', FACE_BUTTON).wrap).toBe(false);
  });

  it('a long single word may shrink below the floor, to about 8 px, rather than be abbreviated', () => {
    for (const l of ['BOOMERANG', 'SHURIKEN', 'WINDMILL']) {
      const f = fitLabel(l, FACE_BUTTON);
      expect(f.fits, l).toBe(true);
      expect(px(l)).toBeLessThan(LABEL_MIN_PX);
      expect(px(l)).toBeGreaterThanOrEqual(LABEL_LONG_WORD_MIN_PX);
    }
    expect(px('BOOMERANG')).toBeLessThan(9);
    // Too long even for that: flagged, and drawn at the long-word floor.
    const f = fitLabel('SUPERCALIFRAGILISTIC', FACE_BUTTON);
    expect(f.fits).toBe(false);
    expect(f.scale * FACE_BUTTON.font).toBeCloseTo(LABEL_LONG_WORD_MIN_PX);
  });

  it('labels that can wrap, or are short, keep the 11 px floor', () => {
    // Two-word labels wrap instead of shrinking; a wide pair still never goes below 11 px.
    const f = fitLabel('WWWWWW WWWWWW', FACE_BUTTON);
    expect(f.fits).toBe(false);
    expect(f.scale * FACE_BUTTON.font).toBeCloseTo(LABEL_MIN_PX);
    expect(px('KNUCKLE')).toBeGreaterThanOrEqual(LABEL_MIN_PX);
  });

  it('measures with the font it is given (a narrower font fits bigger)', () => {
    const narrow = (t: string) => t.length * 0.6;
    expect(fitLabel('SWORD', FACE_BUTTON, narrow).scale).toBeGreaterThan(
      fitLabel('SWORD', FACE_BUTTON).scale,
    );
  });

  class StubEl implements LabelTarget {
    textContent: string | null;
    readonly props = new Map<string, string>();
    readonly classes = new Set<string>();
    writes = 0;
    constructor(text: string) {
      this.textContent = text;
    }
    style = { setProperty: (k: string, v: string) => void this.props.set(k, v) };
    classList = {
      toggle: (t: string, force?: boolean) => {
        this.writes++;
        const on = force ?? !this.classes.has(t);
        if (on) this.classes.add(t);
        else this.classes.delete(t);
        return on;
      },
    };
  }
  function setup() {
    const els = { jump: new StubEl('JUMP'), attack: new StubEl('ATTACK'), start: new StubEl('MENU') };
    const slots = new Map<Action, LabelSlot>(
      Object.entries(els).map(([a, el]) => [
        a as Action,
        { el, def: el.textContent ?? '', shape: buttonShape(a as Action) },
      ]),
    );
    return { els, labeler: new ButtonLabeler(slots) };
  }

  it('sets text, hides on null, and restores the default when the key is absent', () => {
    const { els, labeler } = setup();
    labeler.apply({ jump: 'JUMP', attack: 'FIRE', start: 'PAUSE' });
    expect(els.jump.textContent).toBe('JUMP');
    expect(els.attack.textContent).toBe('FIRE');
    expect(els.start.textContent).toBe('PAUSE');
    expect(labeler.apply({ jump: 'JUMP', attack: null })).toEqual(['attack']);
    expect(els.attack.classes.has('hidden')).toBe(true);
    labeler.apply({});
    expect(els.attack.classes.has('hidden')).toBe(false);
    expect(els.attack.textContent).toBe('ATTACK');
    expect(els.jump.textContent).toBe('JUMP');
  });

  it('shrinks long labels to fit, and writes a wrapped one on two lines', () => {
    const { els, labeler } = setup();
    labeler.apply({ attack: 'TOOL BELT' });
    expect(els.attack.classes.has('wrap')).toBe(true);
    expect(els.attack.textContent).toBe('TOOL\nBELT');
    expect(labeler.label('attack')).toBe('TOOL BELT');
    expect(Number(els.attack.props.get('--fs'))).toBeLessThan(1);
    labeler.apply({ attack: 'FIRE' });
    expect(els.attack.classes.has('wrap')).toBe(false);
    expect(els.attack.props.get('--fs')).toBe('1');
  });

  it('is a no-op when nothing changed (cheap every frame)', () => {
    const { els, labeler } = setup();
    labeler.apply({ jump: 'JUMP' });
    const writes = els.jump.writes + els.attack.writes + els.start.writes;
    for (let i = 0; i < 10; i++) labeler.apply({ jump: 'JUMP' });
    expect(els.jump.writes + els.attack.writes + els.start.writes).toBe(writes);
  });
});

describe('button layout', () => {
  /** A button as a capsule in viewport px: a horizontal segment x0..x1 at y, of radius r. */
  function capsule(a: keyof typeof BUTTON_PLACES, ts: number, vw: number, vh: number) {
    const p = BUTTON_PLACES[a];
    const s = buttonShape(a);
    const w = s.w * ts;
    const h = s.h * ts;
    const left = vw - p.right * ts - w;
    const top = 'top' in p ? p.top * ts : vh - p.bottom * ts - h;
    const r = Math.min(w, h) / 2;
    return { x0: left + r, x1: left + w - r, y: top + h / 2, r, left, top, w, h };
  }
  /** Gap between two capsules (negative when they overlap). */
  function gap(a: ReturnType<typeof capsule>, b: ReturnType<typeof capsule>): number {
    const dx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1);
    return Math.hypot(dx, a.y - b.y) - a.r - b.r;
  }
  const sizes = Array.from({ length: 11 }, (_, i) => 0.6 + i / 10);
  const screens = [
    [844, 390],
    [390, 844],
  ] as const;

  it('Select sits beside C, clear of A, B, C and Start, at every size on landscape and portrait', () => {
    for (const ts of sizes)
      for (const [vw, vh] of screens) {
        const at = (a: keyof typeof BUTTON_PLACES) => capsule(a, ts, vw, vh);
        const sel = at('select');
        for (const other of ['jump', 'attack', 'special', 'start'] as const)
          expect(gap(sel, at(other)), `select/${other} at ${ts} on ${vw}x${vh}`).toBeGreaterThan(8 * ts);
        // Nearer C than anything else in the cluster: swap next to use.
        expect(gap(sel, at('special'))).toBeLessThan(gap(sel, at('jump')));
        expect(gap(sel, at('special'))).toBeLessThan(gap(sel, at('attack')));
        expect(gap(sel, at('special'))).toBeLessThan(24 * ts);
        // Up and to the left of C (away from A, which is low on the right).
        expect(sel.y).toBeLessThan(at('special').y);
        expect(sel.x1).toBeLessThan(at('special').x1);
      }
  });

  it('A, B and C never overlap, and every button stays on screen', () => {
    for (const ts of sizes)
      for (const [vw, vh] of screens) {
        const at = (a: keyof typeof BUTTON_PLACES) => capsule(a, ts, vw, vh);
        expect(gap(at('jump'), at('attack'))).toBeGreaterThan(0);
        expect(gap(at('jump'), at('special'))).toBeGreaterThan(0);
        expect(gap(at('attack'), at('special'))).toBeGreaterThan(0);
        for (const a of Object.keys(BUTTON_PLACES) as (keyof typeof BUTTON_PLACES)[]) {
          const c = at(a);
          expect(c.left, a).toBeGreaterThanOrEqual(0);
          expect(c.top, a).toBeGreaterThanOrEqual(0);
          expect(c.left + c.w, a).toBeLessThanOrEqual(vw);
          expect(c.top + c.h, a).toBeLessThanOrEqual(vh);
        }
      }
  });
});
