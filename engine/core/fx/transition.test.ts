import { describe, expect, it } from 'vitest';
import {
  irisCentre,
  REDUCED_MOTION_TICKS,
  reducedMotion,
  transitionAlphaAt,
  transitionAt,
  transitionFor,
  transitionLength,
  TransitionPlayer,
  transitionShape,
  transitionSpecSchema,
  transitionsSchema,
  type TransitionShape,
  type TransitionSpec,
} from './transition';

const SCREEN = { width: 64, height: 40 };

/** The share of the picture's pixels the shape covers (alpha summed over every pixel). */
function covered(shape: TransitionShape | null): number {
  if (shape === null) return 0;
  let sum = 0;
  for (let y = 0; y < SCREEN.height; y++)
    for (let x = 0; x < SCREEN.width; x++) sum += transitionAlphaAt(shape, x, y, SCREEN);
  return sum / (SCREEN.width * SCREEN.height);
}

/** Coverage of the drawn shape on each frame of a whole transition. */
function playthrough(spec: TransitionSpec, focus = null as { x: number; y: number } | null) {
  return Array.from({ length: transitionLength(spec) + 1 }, (_, age) => {
    const view = transitionAt(spec, age);
    return view === null ? 0 : covered(transitionShape(view, SCREEN, focus));
  });
}

describe('transition timing (Engine 0.16 T5)', () => {
  it('closes over the out half, holds, opens over the in half, and is over after', () => {
    const spec: TransitionSpec = { kind: 'fade', ticks: 4, hold: 2 };
    expect(transitionLength(spec)).toBe(10);
    const views = Array.from({ length: 11 }, (_, a) => transitionAt(spec, a));
    expect(views.map((v) => v?.phase ?? null)).toEqual([
      'out',
      'out',
      'out',
      'out',
      'hold',
      'hold',
      'in',
      'in',
      'in',
      'in',
      null,
    ]);
    expect(views.map((v) => v?.coverage ?? 0)).toEqual([0.25, 0.5, 0.75, 1, 1, 1, 0.75, 0.5, 0.25, 0, 0]);
    expect(transitionAt(spec, -1)).toBeNull();
  });

  it('eases the out half and plays the curve backwards in the in half', () => {
    const spec: TransitionSpec = { kind: 'fade', ticks: 2, ease: 'quadIn' };
    expect([0, 1, 2, 3].map((a) => transitionAt(spec, a)!.coverage)).toEqual([0.25, 1, 0.25, 0]);
  });

  it('plays a slot, falling back to scene for a mission and to default', () => {
    const fade: TransitionSpec = { kind: 'fade', ticks: 3 };
    const iris: TransitionSpec = { kind: 'iris', ticks: 5 };
    expect(transitionFor({ level: iris, default: fade }, 'level')).toBe(iris);
    expect(transitionFor({ level: iris, default: fade }, 'scene')).toBe(fade);
    expect(transitionFor({ scene: iris }, 'mission')).toBe(iris);
    expect(transitionFor({ level: iris }, 'scene')).toBeNull();
    expect(transitionFor(undefined, 'level')).toBeNull();
  });

  it('becomes a short fade in the same colour under reduced motion', () => {
    expect(reducedMotion({ kind: 'iris', ticks: 30, color: '#123456', ease: 'cubicIn' })).toEqual({
      kind: 'fade',
      ticks: REDUCED_MOTION_TICKS,
      color: '#123456',
    });
    expect(reducedMotion({ kind: 'wipe', ticks: 3 })).toEqual({ kind: 'fade', ticks: 3 });
  });

  it("a player calls covered once, on the in half's first frame, and stops at the end", () => {
    const player = new TransitionPlayer();
    const calls: number[] = [];
    let frame = 0;
    player.start({ kind: 'fade', ticks: 3, hold: 1 }, () => calls.push(frame));
    const phases: (string | null)[] = [];
    const closing: boolean[] = [];
    for (; frame < 9; frame++) {
      phases.push(player.view?.phase ?? null);
      closing.push(player.closing);
      player.step();
    }
    expect(phases).toEqual(['out', 'out', 'out', 'hold', 'in', 'in', 'in', null, null]);
    expect(closing).toEqual([true, true, true, true, false, false, false, false, false]);
    expect(calls).toEqual([3]);
    expect(player.running).toBe(false);
  });
});

describe('transition shapes: coverage over time (Engine 0.16 T5)', () => {
  it('fade covers the whole picture at the coverage', () => {
    const shares = playthrough({ kind: 'fade', ticks: 4 });
    expect(shares).toEqual([0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25, 0, 0]);
  });

  it('wipe sweeps in from its side, covers all, then leaves off the far side', () => {
    const spec: TransitionSpec = { kind: 'wipe', ticks: 8, direction: 'right', edge: 8 };
    const shares = playthrough(spec);
    // Grows through the out half to all covered, shrinks through the in half to none.
    for (let i = 1; i < 8; i++) expect(shares[i]!).toBeGreaterThan(shares[i - 1]!);
    expect(shares[7]).toBe(1);
    for (let i = 9; i < 16; i++) expect(shares[i]!).toBeLessThan(shares[i - 1]!);
    expect(shares[15]).toBe(0);
    // Out: the left is covered first. In: the left is uncovered first (the cover moves on right).
    const out = transitionShape(transitionAt(spec, 3)!, SCREEN)!;
    expect(transitionAlphaAt(out, 0, 5, SCREEN)).toBe(1);
    expect(transitionAlphaAt(out, 63, 5, SCREEN)).toBe(0);
    const back = transitionShape(transitionAt(spec, 11)!, SCREEN)!;
    expect(transitionAlphaAt(back, 0, 5, SCREEN)).toBe(0);
    expect(transitionAlphaAt(back, 63, 5, SCREEN)).toBe(1);
    // The soft edge: alpha falls off across `edge` px at the lead.
    const lead = out.kind === 'wipe' ? out.lead : 0;
    const x = Math.floor(lead - 4);
    const soft = transitionAlphaAt(out, x, 5, SCREEN);
    expect(soft).toBeGreaterThan(0);
    expect(soft).toBeLessThan(1);
  });

  it('wipe goes each way: up starts at the bottom, left at the right', () => {
    const at = (direction: 'up' | 'left') =>
      transitionShape(transitionAt({ kind: 'wipe', ticks: 4, direction, edge: 0 }, 1)!, SCREEN)!;
    expect(transitionAlphaAt(at('up'), 10, 39, SCREEN)).toBe(1);
    expect(transitionAlphaAt(at('up'), 10, 0, SCREEN)).toBe(0);
    expect(transitionAlphaAt(at('left'), 63, 10, SCREEN)).toBe(1);
    expect(transitionAlphaAt(at('left'), 0, 10, SCREEN)).toBe(0);
  });

  it('iris closes to a point and opens from it; its circle is the uncovered part', () => {
    const spec: TransitionSpec = { kind: 'iris', ticks: 6, at: 'center' };
    const shares = playthrough(spec);
    for (let i = 1; i < 6; i++) expect(shares[i]!).toBeGreaterThan(shares[i - 1]!);
    expect(shares[5]).toBe(1);
    expect(shares[11]).toBe(0);
    const mid = transitionShape(transitionAt(spec, 2)!, SCREEN)!;
    expect(mid).toMatchObject({ kind: 'iris', x: 32, y: 20 });
    expect(transitionAlphaAt(mid, 32, 20, SCREEN)).toBe(0);
    expect(transitionAlphaAt(mid, 0, 0, SCREEN)).toBe(1);
    // At no coverage the circle reaches the farthest corner: nothing is covered.
    expect(covered(transitionShape({ spec, phase: 'in', coverage: 0.001 }, SCREEN))).toBe(0);
  });

  it('nothing to draw at no coverage', () => {
    expect(
      transitionShape({ spec: { kind: 'fade', ticks: 2 }, phase: 'in', coverage: 0 }, SCREEN),
    ).toBeNull();
  });
});

describe('the iris centre in screen space (Engine 0.16 T5)', () => {
  it('follows the focus, else the picture centre; a point is itself; kept on the picture', () => {
    expect(irisCentre(undefined, { x: 10, y: 30 }, SCREEN)).toEqual({ x: 10, y: 30 });
    expect(irisCentre('follow', null, SCREEN)).toEqual({ x: 32, y: 20 });
    expect(irisCentre('center', { x: 10, y: 30 }, SCREEN)).toEqual({ x: 32, y: 20 });
    expect(irisCentre({ x: 5, y: 6 }, null, SCREEN)).toEqual({ x: 5, y: 6 });
    expect(irisCentre('follow', { x: -20, y: 90 }, SCREEN)).toEqual({ x: 0, y: 40 });
  });

  it('closes on the followed entity: the last pixel left open is round its point', () => {
    const spec: TransitionSpec = { kind: 'iris', ticks: 10 };
    const view = transitionAt(spec, 8)!;
    const shape = transitionShape(view, SCREEN, { x: 50, y: 10 })!;
    expect(shape).toMatchObject({ kind: 'iris', x: 50, y: 10 });
    expect(transitionAlphaAt(shape, 50, 10, SCREEN)).toBe(0);
    expect(transitionAlphaAt(shape, 10, 30, SCREEN)).toBe(1);
  });
});

describe('the transition schemas (Engine 0.16 T5)', () => {
  it('reads each kind with its own fields', () => {
    expect(
      transitionsSchema.parse({
        level: { kind: 'iris', ticks: 24, at: 'follow', ease: 'cubicIn' },
        scene: { kind: 'wipe', ticks: 20, direction: 'up', edge: 0, color: '#fff' },
        default: { kind: 'fade', ticks: 12, hold: 4 },
      }),
    ).toBeTruthy();
  });

  it('names the field of an unknown kind, a bad colour and a field of another kind', () => {
    const issues = (json: unknown) =>
      transitionsSchema.safeParse(json).error?.issues.map((i) => i.path.join('.')) ?? [];
    expect(issues({ level: { kind: 'spin', ticks: 10 } })).toEqual(['level.kind']);
    expect(issues({ scene: { kind: 'fade', ticks: 10, color: 'red' } })).toEqual(['scene.color']);
    expect(issues({ default: { kind: 'fade', ticks: 10, direction: 'up' } })).toEqual(['default']);
    expect(issues({ level: { kind: 'fade', ticks: 0 } })).toEqual(['level.ticks']);
    expect(issues({ menu: { kind: 'fade', ticks: 3 } })).toEqual(['']);
    expect(transitionSpecSchema.safeParse({ kind: 'iris', ticks: 3, at: { x: 1 } }).success).toBe(false);
  });
});
