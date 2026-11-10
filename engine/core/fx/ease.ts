/**
 * Easing curves by name (docs/ROADMAP.md, Engine 0.16 part A): each maps progress `t` in [0, 1]
 * to an eased value with `f(0) = 0` and `f(1) = 1` exactly (`back` and `elastic` overshoot in
 * between). `step` holds 0 until the end, then jumps to 1. Pure; presentation only, never in a
 * world rule (the sim's maths rule forbids `Math.sin` and `Math.pow` there).
 */
export const EASE_NAMES = [
  'linear',
  'quadIn',
  'quadOut',
  'quadInOut',
  'cubicIn',
  'cubicOut',
  'cubicInOut',
  'quartIn',
  'quartOut',
  'quartInOut',
  'sineIn',
  'sineOut',
  'sineInOut',
  'backIn',
  'backOut',
  'backInOut',
  'elasticIn',
  'elasticOut',
  'elasticInOut',
  'bounceIn',
  'bounceOut',
  'bounceInOut',
  'step',
] as const;

export type EaseName = (typeof EASE_NAMES)[number];

const BACK = 1.70158;
const BACK_IN_OUT = BACK * 1.525;
const ELASTIC = (2 * Math.PI) / 3;
const ELASTIC_IN_OUT = (2 * Math.PI) / 4.5;

function bounceOut(t: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}

const inOut = (fin: (t: number) => number) => (t: number) =>
  t < 0.5 ? fin(2 * t) / 2 : 1 - fin(2 - 2 * t) / 2;
const out = (fin: (t: number) => number) => (t: number) => 1 - fin(1 - t);
const power = (n: number) => (t: number) => t ** n;

const CURVES: Record<EaseName, (t: number) => number> = {
  linear: (t) => t,
  quadIn: power(2),
  quadOut: out(power(2)),
  quadInOut: inOut(power(2)),
  cubicIn: power(3),
  cubicOut: out(power(3)),
  cubicInOut: inOut(power(3)),
  quartIn: power(4),
  quartOut: out(power(4)),
  quartInOut: inOut(power(4)),
  sineIn: (t) => 1 - Math.cos((t * Math.PI) / 2),
  sineOut: (t) => Math.sin((t * Math.PI) / 2),
  sineInOut: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  backIn: (t) => (BACK + 1) * t * t * t - BACK * t * t,
  backOut: out((t) => (BACK + 1) * t * t * t - BACK * t * t),
  backInOut: inOut((t) => (BACK_IN_OUT + 1) * t * t * t - BACK_IN_OUT * t * t),
  elasticIn: (t) => -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * ELASTIC),
  elasticOut: (t) => 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ELASTIC) + 1,
  elasticInOut: (t) =>
    t < 0.5
      ? -(2 ** (20 * t - 10) * Math.sin((20 * t - 11.125) * ELASTIC_IN_OUT)) / 2
      : (2 ** (-20 * t + 10) * Math.sin((20 * t - 11.125) * ELASTIC_IN_OUT)) / 2 + 1,
  bounceIn: out(bounceOut),
  bounceOut,
  bounceInOut: inOut(out(bounceOut)),
  step: (t) => (t < 1 ? 0 : 1),
};

/** Whether `name` is one of {@link EASE_NAMES}. */
export function isEaseName(name: string): name is EaseName {
  return Object.hasOwn(CURVES, name);
}

/**
 * The eased value of `t` under the curve `name` (default `linear`). `t` is clamped to [0, 1], and
 * the ends are exact: 0 gives 0 and 1 gives 1 for every curve.
 */
export function ease(name: EaseName | undefined, t: number): number {
  if (!(t > 0)) return 0;
  if (t >= 1) return 1;
  return CURVES[name ?? 'linear'](t);
}
