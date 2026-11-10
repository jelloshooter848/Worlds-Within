import { z } from 'zod';
import type { ScreenSize } from '../gfx/screen';
import type { DeepReadonly } from '../present/types';
import { ease, EASE_NAMES } from './ease';

/**
 * Screen transitions (docs/ROADMAP.md, Engine 0.16 part A, T5): `fade`, `wipe` and `iris`, the
 * timing and shape maths only. Pure: a transition is a function of its spec and its age in
 * display frames, so a screenshot at a step is byte-stable. The browser shell
 * (`engine/core/shell/transitions.ts`) runs them between levels and scenes, and the displays draw
 * the shape over the picture. Presentation only: never in a world, a frame or a hash.
 *
 * A transition has three phases: `out` (the cover closes over the old picture, `ticks` frames),
 * `hold` (fully covered, `hold` frames, default 0) and `in` (the cover opens on the new picture,
 * `ticks` frames, the curve played backwards). Its coverage is 0 (nothing covered) to 1 (all).
 *
 * As text (`game.json`'s `transitions`, checked by the manifest schema):
 *
 *   { "kind": "fade", "ticks": 18, "color": "#000000", "ease": "quadInOut" }
 *   { "kind": "wipe", "ticks": 20, "direction": "right", "edge": 24 }
 *   { "kind": "iris", "ticks": 24, "at": "follow" }
 */

export const TRANSITION_KINDS = ['fade', 'wipe', 'iris'] as const;
export type TransitionKind = (typeof TRANSITION_KINDS)[number];

/** Which way a wipe's edge travels across the picture. */
export const WIPE_DIRECTIONS = ['right', 'left', 'down', 'up'] as const;
export type WipeDirection = (typeof WIPE_DIRECTIONS)[number];

/**
 * When the shell plays a transition: `level` on a map id change, `scene` on a scene push or pop,
 * `mission` on a mission round's push or pop (falls back to `scene`), `respawn` on a frame event
 * (Engine 0.16 part B: the kit's `respawn` event, or any event `events` maps to a slot), `default`
 * for anything a slot does not give (and `shell.transition()` with no slot).
 */
export const TRANSITION_SLOTS = ['level', 'scene', 'mission', 'respawn', 'default'] as const;
export type TransitionSlot = (typeof TRANSITION_SLOTS)[number];

/** The cover's colour when a transition gives none. */
export const TRANSITION_DEFAULT_COLOR = '#000000';
/** A wipe's soft edge in picture px when it gives none. */
export const WIPE_DEFAULT_EDGE = 16;
/** Frames each half of the short fade that replaces any transition under reduced motion. */
export const REDUCED_MOTION_TICKS = 8;

const hex = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
  message: 'a colour is #rgb or #rrggbb',
});

const common = {
  ticks: z.number().int().min(1).max(600).describe('display frames each half (out, then in) takes'),
  hold: z
    .number()
    .int()
    .min(0)
    .max(600)
    .exactOptional()
    .describe('display frames fully covered between the halves (default 0)'),
  color: hex.exactOptional().describe(`the cover's colour (default \`${TRANSITION_DEFAULT_COLOR}\`)`),
  ease: z
    .enum(EASE_NAMES)
    .exactOptional()
    .describe('the easing curve of the out half, played backwards for the in half (default `linear`)'),
};

const point = z.strictObject({
  x: z.number().describe('picture px from the left'),
  y: z.number().describe('picture px from the top'),
});

export const transitionSpecSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('fade').describe('the picture fades to the colour and back'), ...common }),
  z.strictObject({
    kind: z.literal('wipe').describe('a cover sweeps across the picture, then on off the far side'),
    ...common,
    direction: z
      .enum(WIPE_DIRECTIONS)
      .exactOptional()
      .describe('which way the edge travels (default `right`: in from the left)'),
    edge: z
      .number()
      .int()
      .min(0)
      .max(256)
      .exactOptional()
      .describe(`the soft edge's width in picture px (default ${WIPE_DEFAULT_EDGE}; 0 is a hard edge)`),
  }),
  z.strictObject({
    kind: z.literal('iris').describe('a circle closes on a point, then opens from it'),
    ...common,
    at: z
      .union([z.enum(['follow', 'center']), point])
      .exactOptional()
      .describe(
        "the circle's centre: `follow` (default) the entity the camera follows, `center` the picture's, or a picture point `{ x, y }`",
      ),
  }),
]);

export type TransitionSpec = z.output<typeof transitionSpecSchema>;
export type IrisAt = NonNullable<Extract<TransitionSpec, { kind: 'iris' }>['at']>;

export const transitionsSchema = z.strictObject({
  level: transitionSpecSchema.exactOptional().describe('played when the map id changes (the next level)'),
  scene: transitionSpecSchema.exactOptional().describe('played when a scene is pushed or popped (a round)'),
  mission: transitionSpecSchema
    .exactOptional()
    .describe('played when a mission round is pushed or popped (else `scene`)'),
  respawn: transitionSpecSchema
    .exactOptional()
    .describe(
      'played on a frame event (Engine 0.16 part B): the `respawn` event, and any event `events` maps to `respawn`; only when given',
    ),
  default: transitionSpecSchema.exactOptional().describe('played when the slot asked for gives none'),
  events: z
    .record(z.string().min(1), z.enum(TRANSITION_SLOTS))
    .exactOptional()
    .describe(
      'frame event type -> the slot it plays (`{ "died": "respawn" }`); left out, `respawn` plays the `respawn` slot when it is given',
    ),
});

export type TransitionsSpec = z.output<typeof transitionsSchema>;

/** The spec a slot plays: the slot's, else (`mission`) `scene`'s, else `default`, else none. */
export function transitionFor(
  specs: DeepReadonly<TransitionsSpec> | undefined,
  slot: TransitionSlot,
): DeepReadonly<TransitionSpec> | null {
  if (specs === undefined) return null;
  return specs[slot] ?? (slot === 'mission' ? specs.scene : undefined) ?? specs.default ?? null;
}

/**
 * The slot a frame event plays (Engine 0.16 part B), or null: the game's `events` map first (a
 * slot with no spec of its own falls back as `transitionFor` does), else a `respawn` event plays
 * the `respawn` slot when the game gives one. Never on a slot the game left out and no map names.
 */
export function eventTransitionSlot(
  specs: DeepReadonly<TransitionsSpec> | undefined,
  eventType: string,
): TransitionSlot | null {
  if (specs === undefined) return null;
  const mapped = specs.events?.[eventType];
  if (mapped !== undefined) return transitionFor(specs, mapped) === null ? null : mapped;
  if (specs.events === undefined && eventType === 'respawn' && specs.respawn !== undefined) return 'respawn';
  return null;
}

/** The spec to play under the player's reduced-motion setting: a short fade in the same colour. */
export function reducedMotion(spec: DeepReadonly<TransitionSpec>): DeepReadonly<TransitionSpec> {
  return {
    kind: 'fade',
    ticks: Math.min(spec.ticks, REDUCED_MOTION_TICKS),
    ...(spec.color !== undefined && { color: spec.color }),
  };
}

/** Display frames a transition lasts, both halves and the hold. */
export function transitionLength(spec: DeepReadonly<TransitionSpec>): number {
  return 2 * spec.ticks + (spec.hold ?? 0);
}

export type TransitionPhase = 'out' | 'hold' | 'in';

/** A transition on one display frame: its spec, phase and coverage (0 nothing, 1 all covered). */
export interface TransitionView {
  spec: DeepReadonly<TransitionSpec>;
  phase: TransitionPhase;
  coverage: number;
}

/**
 * The transition `age` display frames after it started, or null before it and once it is over.
 * The out half reaches full coverage on its last frame; the in half starts just under it and
 * reaches 0 on its last frame.
 */
export function transitionAt(spec: DeepReadonly<TransitionSpec>, age: number): TransitionView | null {
  const age0 = Math.floor(age);
  if (age0 < 0 || age0 >= transitionLength(spec)) return null;
  const hold = spec.hold ?? 0;
  if (age0 < spec.ticks) return { spec, phase: 'out', coverage: ease(spec.ease, (age0 + 1) / spec.ticks) };
  if (age0 < spec.ticks + hold) return { spec, phase: 'hold', coverage: 1 };
  const k = age0 - spec.ticks - hold;
  return { spec, phase: 'in', coverage: ease(spec.ease, 1 - (k + 1) / spec.ticks) };
}

/** A picture point. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * The iris's centre in picture px: `follow` is the followed entity's point on screen (`focus`,
 * from the presenter's camera; the picture's centre when there is none), `center` the picture's
 * centre, a point itself. Kept inside the picture.
 */
export function irisCentre(
  at: DeepReadonly<IrisAt> | undefined,
  focus: ScreenPoint | null,
  screen: ScreenSize,
): ScreenPoint {
  const middle = { x: screen.width / 2, y: screen.height / 2 };
  const p = at === undefined || at === 'follow' ? (focus ?? middle) : at === 'center' ? middle : at;
  return {
    x: Math.min(screen.width, Math.max(0, p.x)),
    y: Math.min(screen.height, Math.max(0, p.y)),
  };
}

/** What a display draws over the picture for a transition on one frame. */
export type TransitionShape =
  | { kind: 'fade'; color: string; alpha: number }
  | {
      kind: 'wipe';
      color: string;
      direction: WipeDirection;
      /** The picture's length along the travel (px). */
      length: number;
      /** The soft edge's width (px). */
      edge: number;
      /**
       * The cover along the travel coordinate `s` (0 at the side it comes in from): opaque from
       * `trail + edge` to `lead - edge`, fading to nothing at `trail` and at `lead`.
       */
      lead: number;
      trail: number;
    }
  | { kind: 'iris'; color: string; x: number; y: number; radius: number };

/** How far along a wipe's travel the picture point (x, y) is (0 on the side the cover enters). */
export function wipeTravel(direction: WipeDirection, x: number, y: number, screen: ScreenSize): number {
  switch (direction) {
    case 'right':
      return x;
    case 'left':
      return screen.width - x;
    case 'down':
      return y;
    case 'up':
      return screen.height - y;
  }
}

/**
 * The shape to draw for `view` on a `screen`-sized picture, or null when nothing is covered.
 * `focus` is the followed entity's point on screen, for an iris that follows it.
 */
export function transitionShape(
  view: TransitionView,
  screen: ScreenSize,
  focus: ScreenPoint | null = null,
): TransitionShape | null {
  const { spec, coverage: c } = view;
  if (!(c > 0)) return null;
  const color = spec.color ?? TRANSITION_DEFAULT_COLOR;
  switch (spec.kind) {
    case 'fade':
      return { kind: 'fade', color, alpha: Math.min(1, c) };
    case 'wipe': {
      const direction = spec.direction ?? 'right';
      const length = direction === 'right' || direction === 'left' ? screen.width : screen.height;
      const edge = spec.edge ?? WIPE_DEFAULT_EDGE;
      const travel = length + edge;
      // Out: the lead comes in from 0 (the trail waits off the near side). In: the trail follows
      // it off the far side, so the cover keeps moving the same way.
      if (view.phase === 'in')
        return { kind: 'wipe', color, direction, length, edge, lead: travel, trail: (1 - c) * travel - edge };
      return { kind: 'wipe', color, direction, length, edge, lead: c * travel, trail: -edge };
    }
    case 'iris': {
      const centre = irisCentre(spec.at, focus, screen);
      const far = Math.max(
        Math.hypot(centre.x, centre.y),
        Math.hypot(screen.width - centre.x, centre.y),
        Math.hypot(centre.x, screen.height - centre.y),
        Math.hypot(screen.width - centre.x, screen.height - centre.y),
      );
      return { kind: 'iris', color, x: centre.x, y: centre.y, radius: Math.max(0, (1 - c) * far) };
    }
  }
}

/** A wipe's opacity at travel `s` (see {@link TransitionShape}). */
export function wipeAlpha(shape: Extract<TransitionShape, { kind: 'wipe' }>, s: number): number {
  const ramp = (d: number) => (shape.edge > 0 ? Math.min(1, Math.max(0, d / shape.edge)) : d >= 0 ? 1 : 0);
  return Math.min(ramp(shape.lead - s), ramp(s - shape.trail));
}

/**
 * The cover's opacity at the picture pixel whose centre is (x + 0.5, y + 0.5): what each display
 * draws, written once for tests and for the 3D shader to mirror.
 */
export function transitionAlphaAt(shape: TransitionShape, x: number, y: number, screen: ScreenSize): number {
  const px = x + 0.5;
  const py = y + 0.5;
  switch (shape.kind) {
    case 'fade':
      return shape.alpha;
    case 'wipe':
      return wipeAlpha(shape, wipeTravel(shape.direction, px, py, screen));
    case 'iris':
      return Math.hypot(px - shape.x, py - shape.y) >= shape.radius ? 1 : 0;
  }
}

/** Where a running transition is: started with a spec, one `step()` per display frame. */
export class TransitionPlayer {
  private spec: DeepReadonly<TransitionSpec> | null = null;
  private age = 0;
  private onCovered: (() => void) | null = null;

  /** Starts `spec` at age 0 (replacing any running one); `covered` runs once the in half begins. */
  start(spec: DeepReadonly<TransitionSpec>, covered?: () => void): void {
    this.spec = spec;
    this.age = 0;
    this.onCovered = covered ?? null;
  }

  /** One display frame on. Calls the `covered` callback on the in half's first frame. */
  step(): void {
    if (this.spec === null) return;
    this.age++;
    const spec = this.spec;
    if (this.onCovered && this.age >= spec.ticks + (spec.hold ?? 0)) {
      const covered = this.onCovered;
      this.onCovered = null;
      covered();
    }
    if (this.age >= transitionLength(spec)) this.spec = null;
  }

  /** The transition on this frame, or null when none runs. */
  get view(): TransitionView | null {
    return this.spec === null ? null : transitionAt(this.spec, this.age);
  }

  /** True while one runs. */
  get running(): boolean {
    return this.spec !== null;
  }

  /** True during the out half and the hold: the picture is covering, the old one held. */
  get closing(): boolean {
    const phase = this.view?.phase;
    return phase === 'out' || phase === 'hold';
  }

  clear(): void {
    this.spec = null;
    this.onCovered = null;
  }
}
