import { describe, expect, it } from 'vitest';
import {
  CONTROL_IDS,
  DPAD_PLACE,
  LANDSCAPE_SELECT,
  MIN_CONTROL_SCALE,
  PORTRAIT_MAX_GAP,
  PORTRAIT_MIN_GAP,
  portraitBalance,
  inside,
  layoutScreen,
  overlaps,
  type Insets,
  type Rect,
  type ScreenInput,
} from './touch-layout';
import { BUTTON_PLACES, FACE_BUTTON } from './touch-logic';
import { fitGame } from '../viewport';

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

interface Screen {
  name: string;
  width: number;
  height: number;
  dpr: number;
  insets: Insets;
}

/** Phones and tablets, upright and sideways (insets as their browsers report them). */
const SCREENS: Screen[] = [
  {
    name: 'iPhone 15 Pro portrait',
    width: 393,
    height: 852,
    dpr: 3,
    insets: { ...NO_INSETS, top: 59, bottom: 34 },
  },
  {
    name: 'iPhone 15 Pro landscape',
    width: 852,
    height: 393,
    dpr: 3,
    insets: { top: 0, left: 59, right: 59, bottom: 21 },
  },
  {
    name: 'iPhone 15 Pro portrait, short window',
    width: 393,
    height: 793,
    dpr: 3,
    insets: { ...NO_INSETS, top: 59, bottom: 34 },
  },
  { name: 'iPhone SE portrait', width: 375, height: 667, dpr: 2, insets: NO_INSETS },
  { name: 'iPhone SE landscape', width: 667, height: 375, dpr: 2, insets: NO_INSETS },
  { name: '19.5:9 Android portrait', width: 360, height: 780, dpr: 3, insets: { ...NO_INSETS, top: 24 } },
  { name: '19.5:9 Android landscape', width: 780, height: 360, dpr: 3, insets: { ...NO_INSETS, left: 24 } },
  { name: 'iPad portrait', width: 820, height: 1180, dpr: 2, insets: { ...NO_INSETS, top: 24, bottom: 20 } },
  { name: 'iPad landscape', width: 1180, height: 820, dpr: 2, insets: { ...NO_INSETS, top: 24, bottom: 20 } },
];

const TOUCH_SCALES = [1, 1.3, 1.6];

function input(s: Screen, over: Partial<ScreenInput> = {}): ScreenInput {
  return {
    width: s.width,
    height: s.height,
    insets: s.insets,
    dpr: s.dpr,
    integerScale: true,
    touch: true,
    touchScale: 1,
    ...over,
  };
}

/** Every combination the tests sweep: each screen, integer scale on and off, each touch size. */
function* cases(): Generator<[string, ScreenInput]> {
  for (const s of SCREENS)
    for (const integerScale of [true, false])
      for (const touchScale of TOUCH_SCALES)
        yield [`${s.name} int=${integerScale} ts=${touchScale}`, input(s, { integerScale, touchScale })];
}

const right = (r: Rect) => r.x + r.w;
const bottom = (r: Rect) => r.y + r.h;

describe('screen layout', () => {
  it('no touch control ever overlaps the game, on any phone or tablet, either way up', () => {
    for (const [name, inp] of cases()) {
      const l = layoutScreen(inp);
      for (const id of CONTROL_IDS)
        expect(overlaps(l.rects[id], l.game), `${id} over the game: ${name}`).toBe(false);
    }
  });

  it('every control and the game stay inside the safe area (clear of the notch and home bar)', () => {
    for (const [name, inp] of cases()) {
      const l = layoutScreen(inp);
      expect(inside(l.game, l.frame), `game: ${name}`).toBe(true);
      for (const id of CONTROL_IDS) expect(inside(l.rects[id], l.frame), `${id}: ${name}`).toBe(true);
    }
  });

  it('SELECT and MENU never sit on another control, and the buttons stay thumb-sized', () => {
    for (const [name, inp] of cases()) {
      const l = layoutScreen(inp);
      for (const pill of ['select', 'start'] as const)
        for (const id of CONTROL_IDS)
          if (id !== pill) expect(overlaps(l.rects[pill], l.rects[id]), `${pill}/${id}: ${name}`).toBe(false);
      expect(l.scale, name).toBeGreaterThanOrEqual(MIN_CONTROL_SCALE);
      expect(l.scale, name).toBeLessThanOrEqual(inp.touchScale);
      expect(l.rects.jump.w, name).toBeGreaterThanOrEqual(44);
    }
  });

  it('the game rect is exactly where the Viewport draws it', () => {
    for (const [name, inp] of cases()) {
      const l = layoutScreen(inp);
      const b = fitGame(l.frame.w, l.frame.h, inp.dpr, inp.integerScale, l.fit);
      expect(l.game.x, name).toBeCloseTo(l.frame.x + b.ox / inp.dpr, 6);
      expect(l.game.y, name).toBeCloseTo(l.frame.y + b.oy / inp.dpr, 6);
      expect(l.game.w, name).toBeCloseTo(b.dw / inp.dpr, 6);
    }
  });

  it('a phone held upright: the game balanced above the controls, the controls low for the thumbs', () => {
    for (const [name, inp] of cases()) {
      if (inp.height < inp.width || Math.min(inp.width, inp.height) >= 600) continue;
      const l = layoutScreen(inp);
      expect(l.mode, name).toBe('portrait');
      const highest = Math.min(...CONTROL_IDS.map((id) => l.rects[id].y));
      const above = l.game.y - l.frame.y;
      const gap = highest - bottom(l.game);
      const lift = bottom(l.frame) - bottom(l.rects.dpad) - DPAD_PLACE.bottom * l.scale;
      // Neither glued to the status bar nor floating far above the controls.
      expect(gap, name).toBeGreaterThanOrEqual(PORTRAIT_MIN_GAP - 1);
      expect(gap, name).toBeLessThanOrEqual(PORTRAIT_MAX_GAP + 1);
      expect(above, name).toBeGreaterThan(0);
      if (lift < 0.5) {
        // About 45% of the spare height over the game, 55% under it.
        expect(above / gap, name).toBeGreaterThan(0.7);
        expect(above / gap, name).toBeLessThan(0.95);
      } else {
        // A tall phone: the gap is capped, the rest shared between the top and the controls' lift.
        expect(gap, name).toBeGreaterThan(PORTRAIT_MAX_GAP - 1);
        const shared = above - portraitBalance(PORTRAIT_MAX_GAP / 0.55).above;
        expect(Math.abs(shared - lift), name).toBeLessThanOrEqual(1);
      }
      // MENU at the top right of the cluster (above C), SELECT beside it, the pad low.
      expect(right(l.rects.start), name).toBeCloseTo(right(l.frame) - 16 * l.scale, 6);
      expect(l.rects.start.y, name).toBeLessThan(l.rects.special.y);
      for (const id of CONTROL_IDS) expect(l.rects[id].y, `${id}: ${name}`).toBeGreaterThan(bottom(l.game));
    }
  });

  it('portraitBalance: 45/55 under the cap, then the gap capped and the rest shared evenly', () => {
    expect(portraitBalance(40)).toEqual({ above: 18, gap: 22, lift: 0 });
    const cap = PORTRAIT_MAX_GAP / 0.55;
    const at = portraitBalance(cap);
    expect(at.gap).toBeCloseTo(PORTRAIT_MAX_GAP, 6);
    expect(at.lift).toBe(0);
    const tall = portraitBalance(cap + 100);
    expect(tall.gap).toBe(PORTRAIT_MAX_GAP);
    expect(tall.lift).toBeCloseTo(50, 6);
    expect(tall.above).toBeCloseTo(at.above + 50, 6);
    // Continuous: no jump at the cap.
    expect(portraitBalance(cap + 0.001).above).toBeCloseTo(at.above, 2);
  });

  it('sideways: the game centred, SELECT and MENU inside the right gutter, the pad in the left', () => {
    for (const [name, inp] of cases()) {
      if (inp.height > inp.width) continue;
      const l = layoutScreen(inp);
      const leftGutter = l.game.x - l.frame.x;
      const rightGutter = right(l.frame) - right(l.game);
      expect(Math.abs(leftGutter - rightGutter), name).toBeLessThanOrEqual(1);
      for (const id of ['select', 'start', 'jump', 'attack', 'special'] as const)
        expect(l.rects[id].x, `${id}: ${name}`).toBeGreaterThanOrEqual(right(l.game));
      expect(right(l.rects.dpad), name).toBeLessThanOrEqual(l.game.x);
    }
  });

  it('iPhone 15 Pro at the default size: the game keeps its size, the controls theirs', () => {
    for (const s of SCREENS.filter((x) => x.name.startsWith('iPhone 15 Pro'))) {
      const l = layoutScreen(input(s));
      expect(l.game.w, s.name).toBeCloseTo(1024 / 3, 6);
      expect(l.game.h, s.name).toBeCloseTo(960 / 3, 6);
      expect(l.scale, s.name).toBe(1);
    }
    const up = layoutScreen(input(SCREENS[0] as Screen));
    expect(up.game.y).toBeGreaterThan(59 + 60); // well off the status bar
    expect(Math.min(...CONTROL_IDS.map((id) => up.rects[id].y)) - bottom(up.game)).toBeCloseTo(
      PORTRAIT_MAX_GAP,
      0,
    );
    const side = layoutScreen(input(SCREENS[1] as Screen));
    expect(side.mode).toBe('landscape');
    // SELECT (SOUND on the title) was 6 px over the game in 0.4.44; now well clear of it.
    expect(side.rects.select.x - right(side.game)).toBeGreaterThan(20);
  });

  it('desktop, and tablets where nothing overlapped, keep the 0.4.44 layout exactly', () => {
    const desktop = layoutScreen({
      width: 1280,
      height: 800,
      insets: NO_INSETS,
      dpr: 1,
      integerScale: true,
      touch: false,
      touchScale: 1,
    });
    const desktopTouch = layoutScreen({
      ...input(SCREENS[0] as Screen),
      width: 1280,
      height: 800,
      insets: NO_INSETS,
      dpr: 1,
    });
    for (const l of [desktop, desktopTouch]) {
      expect(l.mode).toBe('centred');
      expect(l.fit).toEqual({});
      expect(l.game).toEqual({ x: (1280 - 768) / 2, y: (800 - 720) / 2, w: 768, h: 720 });
      expect(l.places).toEqual({ dpad: DPAD_PLACE, ...BUTTON_PLACES });
    }
    for (const s of SCREENS.filter((x) => x.name.startsWith('iPad'))) {
      const l = layoutScreen(input(s));
      expect(l.mode, s.name).toBe('centred');
      expect(l.places, s.name).toEqual({ dpad: DPAD_PLACE, ...BUTTON_PLACES });
    }
  });

  it('the pad hidden: always the centred layout (a phone with a keyboard)', () => {
    for (const s of SCREENS) {
      const l = layoutScreen(input(s, { touch: false }));
      expect(l.mode, s.name).toBe('centred');
      expect(l.fit, s.name).toEqual({});
    }
  });

  it('a narrow gutter shrinks the controls before the game (iPhone SE sideways)', () => {
    const se = SCREENS.find((s) => s.name === 'iPhone SE landscape') as Screen;
    const l = layoutScreen(input(se));
    expect(l.game.w).toBe(384); // the same 3x picture as before
    expect(l.scale).toBeLessThan(1);
    expect(l.rects.jump.w).toBeGreaterThanOrEqual(FACE_BUTTON.w * MIN_CONTROL_SCALE);
  });

  it('sideways SELECT sits up and to the left of C, near it but clear', () => {
    const sp = BUTTON_PLACES.special as { right: number; bottom: number };
    const c = { cx: -(sp.right + 34), cy: -(sp.bottom + 34), r: 34 };
    // The pill as a capsule: a segment between its two end centres, radius 15.
    const y = -(LANDSCAPE_SELECT.bottom + 15);
    const x0 = -(LANDSCAPE_SELECT.right + 68 - 15);
    const x1 = -(LANDSCAPE_SELECT.right + 15);
    const dx = Math.max(0, x0 - c.cx, c.cx - x1);
    const gap = Math.hypot(dx, y - c.cy) - 15 - c.r;
    expect(gap).toBeGreaterThan(8);
    expect(gap).toBeLessThan(24);
    expect(y).toBeLessThan(c.cy);
    expect(x1).toBeLessThan(c.cx + 34);
    // No wider out than B, so it fits wherever A/B/C fit.
    expect(LANDSCAPE_SELECT.right + 68).toBeLessThanOrEqual(BUTTON_PLACES.attack.right + FACE_BUTTON.w);
  });
});

describe('fitGame', () => {
  it('with no fit: the 0.4.44 Viewport maths (largest integer scale, centred)', () => {
    expect(fitGame(393, 759, 3, true)).toEqual({
      scale: 4,
      dw: 1024,
      dh: 960,
      ox: 77,
      oy: Math.floor((2277 - 960) / 2),
    });
    expect(fitGame(1280, 800, 1, true)).toEqual({ scale: 3, dw: 768, dh: 720, ox: 256, oy: 40 });
  });

  it('anchors to the top and honours maxW / maxH', () => {
    expect(fitGame(393, 759, 3, true, { top: 8 }).oy).toBe(24);
    expect(fitGame(393, 759, 3, true, { maxH: 300 }).scale).toBe(3);
    expect(fitGame(852, 372, 3, true, { maxW: 400 }).scale).toBe(4);
    expect(fitGame(852, 372, 3, true, { maxW: 300 }).scale).toBe(3);
  });
});
