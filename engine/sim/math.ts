/**
 * Deterministic maths for the world simulation: integer and fixed-point helpers that give the same
 * answer on every machine and JavaScript engine.
 *
 * `Math.sin`, `Math.cos`, `Math.atan2`, `Math.pow`, `Math.exp`, `Math.log` and the like are not
 * required to be correctly rounded, so their last bits can differ between engines and CPUs, and one
 * different bit is enough to make two runs of the same seed drift apart. ESLint forbids them (and
 * the `**` operator) in `engine/sim/` (`SIM_FORBIDDEN_MATH` in `config/layers.js`); use these
 * instead. Only exact operations are used here: integer `+ - *`, comparisons, `Math.floor`,
 * `Math.trunc` and `Math.sqrt` (which IEEE 754 requires to be correctly rounded).
 *
 * Angles are binary angles: a full turn is {@link ANGLE_STEPS} steps (256), counted from +x toward
 * +y. Sines and cosines are fixed-point numbers where {@link FIXED_ONE} (65536) stands for 1.
 */

/** Steps in a full turn. Every angle in this module is an integer step, wrapped into 0..255. */
export const ANGLE_STEPS = 256;

/** A quarter turn (90 degrees) in angle steps. */
export const QUARTER_TURN = ANGLE_STEPS / 4;

/** The fixed-point scale of {@link sinFixed} and {@link cosFixed}: this value stands for 1.0. */
export const FIXED_ONE = 65536;

/**
 * `round(sin(i * 2π / 256) * 65536)` for i = 0..64, the first quarter of a turn. Written out as
 * literals (generated once) so the sim never calls `Math.sin`; the other quarters are mirrored.
 */
const QUARTER_SINE: readonly number[] = [
  0, 1608, 3216, 4821, 6424, 8022, 9616, 11204, 12785, 14359, 15924, 17479, 19024, 20557, 22078, 23586, 25080,
  26558, 28020, 29466, 30893, 32303, 33692, 35062, 36410, 37736, 39040, 40320, 41576, 42806, 44011, 45190,
  46341, 47464, 48559, 49624, 50660, 51665, 52639, 53581, 54491, 55368, 56212, 57022, 57798, 58538, 59244,
  59914, 60547, 61145, 61705, 62228, 62714, 63162, 63572, 63944, 64277, 64571, 64827, 65043, 65220, 65358,
  65457, 65516, 65536,
];

/** Largest magnitude {@link iatan2} accepts, so `value * FIXED_ONE` stays an exact integer. */
const ATAN_LIMIT = 2147483648;

function assertInt(name: string, value: number): void {
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer, got ${value}`);
}

/** Integer division rounded toward minus infinity: `idiv(-7, 2)` is -4. Throws on a zero divisor. */
export function idiv(a: number, b: number): number {
  assertInt('a', a);
  assertInt('b', b);
  if (b === 0) throw new Error('idiv: division by zero');
  return Math.floor(a / b);
}

/** The modulo that matches {@link idiv}: the result has the sign of `b`, so `imod(-1, 4)` is 3. */
export function imod(a: number, b: number): number {
  return a - idiv(a, b) * b;
}

/** `value` held within `lo..hi` (inclusive). Throws when `lo > hi`. */
export function clamp(value: number, lo: number, hi: number): number {
  if (lo > hi) throw new Error(`clamp: lo ${lo} is above hi ${hi}`);
  return value < lo ? lo : value > hi ? hi : value;
}

/** `base` to a non-negative integer power, by repeated multiplication. Throws past safe integers. */
export function ipow(base: number, exponent: number): number {
  assertInt('base', base);
  assertInt('exponent', exponent);
  if (exponent < 0) throw new Error('ipow: the exponent must not be negative');
  let result = 1;
  for (let i = 0; i < exponent; i++) {
    result *= base;
    if (!Number.isSafeInteger(result)) throw new Error(`ipow: ${base}^${exponent} is past safe integers`);
  }
  return result;
}

/** The integer square root: the largest `r` with `r * r <= n`. Throws on a negative `n`. */
export function isqrt(n: number): number {
  assertInt('n', n);
  if (n < 0) throw new Error('isqrt: n must not be negative');
  // Math.sqrt is correctly rounded (IEEE 754), so this guess is the same everywhere; the loops fix
  // the rare off-by-one when n is too large for a double to hold exactly.
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

/** The squared straight-line distance between two integer points: compare it, don't root it. */
export function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

/** The straight-line distance rounded down to an integer (`isqrt` of {@link distSq}). */
export function distFloor(ax: number, ay: number, bx: number, by: number): number {
  return isqrt(distSq(ax, ay, bx, by));
}

/** The distance in four-way grid steps: `|dx| + |dy|`. */
export function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(bx - ax) + Math.abs(by - ay);
}

/** The distance in eight-way grid steps (diagonals cost one): `max(|dx|, |dy|)`. */
export function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(bx - ax), Math.abs(by - ay));
}

/** Any integer angle wrapped into `0..ANGLE_STEPS - 1`. */
export function wrapAngle(angle: number): number {
  return imod(angle, ANGLE_STEPS);
}

/** `sin(angle)` as fixed point (`FIXED_ONE` = 1.0), read from the table. */
export function sinFixed(angle: number): number {
  const a = wrapAngle(angle);
  const quarter = Math.floor(a / QUARTER_TURN);
  const step = a - quarter * QUARTER_TURN;
  switch (quarter) {
    case 0:
      return QUARTER_SINE[step] as number;
    case 1:
      return QUARTER_SINE[QUARTER_TURN - step] as number;
    case 2:
      return -(QUARTER_SINE[step] as number) || 0;
    default:
      return -(QUARTER_SINE[QUARTER_TURN - step] as number) || 0;
  }
}

/** `cos(angle)` as fixed point (`FIXED_ONE` = 1.0): the sine a quarter turn on. */
export function cosFixed(angle: number): number {
  return sinFixed(angle + QUARTER_TURN);
}

/**
 * The angle of direction `index` out of `count` evenly spaced directions (4, 8 or 16 and so on;
 * `count` must divide {@link ANGLE_STEPS}). Direction 0 points along +x.
 */
export function directionAngle(index: number, count: number): number {
  assertInt('index', index);
  if (!Number.isInteger(count) || count <= 0 || ANGLE_STEPS % count !== 0) {
    throw new Error(`directionAngle: ${count} directions do not divide ${ANGLE_STEPS} steps`);
  }
  return wrapAngle(imod(index, count) * (ANGLE_STEPS / count));
}

/**
 * The unit vector of direction `index` out of `count`, scaled to `length` and rounded to integers
 * (halves away from zero). `directionVector(1, 8, 10)` is `[7, 7]`.
 */
export function directionVector(index: number, count: number, length = FIXED_ONE): [number, number] {
  assertInt('length', length);
  const angle = directionAngle(index, count);
  return [scaleFixed(cosFixed(angle), length), scaleFixed(sinFixed(angle), length)];
}

/** `fixed * value / FIXED_ONE`, rounded to the nearest integer (halves away from zero). */
export function scaleFixed(fixed: number, value: number): number {
  const product = fixed * value;
  const magnitude = Math.floor((Math.abs(product) + FIXED_ONE / 2) / FIXED_ONE);
  return product < 0 ? -magnitude : magnitude;
}

/**
 * The angle step nearest the direction of `(x, y)`, like `Math.atan2(y, x)` but in binary angle
 * steps and exact (ties go to the lower step). `(0, 0)` gives 0. Coordinates must be integers within
 * ±2^31.
 */
export function iatan2(y: number, x: number): number {
  assertInt('x', x);
  assertInt('y', y);
  if (Math.abs(x) > ATAN_LIMIT || Math.abs(y) > ATAN_LIMIT) {
    throw new Error('iatan2: coordinates must be within ±2^31');
  }
  if (x === 0 && y === 0) return 0;
  // Turn the vector back a quarter at a time until it lies in the first quarter (x > 0, y >= 0).
  let quarters = 0;
  while (!(x > 0 && y >= 0)) {
    [x, y] = [y, -x];
    quarters++;
  }
  // side(a) > 0 when the vector is past step a, < 0 when before it; it is proportional to
  // sin(theta - a), so its size also says how far away step a is.
  const side = (a: number): number =>
    y * (QUARTER_SINE[QUARTER_TURN - a] as number) - x * (QUARTER_SINE[a] as number);
  let lo = 0; // side(lo) >= 0 always holds: theta >= 0
  let hi = QUARTER_TURN; // side(hi) < 0 always holds: theta < 90 degrees
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (side(mid) >= 0) lo = mid;
    else hi = mid;
  }
  const step = side(lo) <= -side(hi) ? lo : hi;
  return wrapAngle(step + quarters * QUARTER_TURN);
}
