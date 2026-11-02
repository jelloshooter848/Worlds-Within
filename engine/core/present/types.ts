import type { ScreenSize } from '../gfx/screen';
import type { JsonValue } from '../headless';

/**
 * The presentation contract (docs/DESIGN.md, section 6; docs/ROADMAP.md, Engine 0.4): the read-only
 * snapshot a backend gets each frame. A kit describes what is there; the backend decides how it
 * looks, from this frame and a skin. The backend never sees kit internals and can't change anything.
 *
 * Every value is plain JSON-safe data, so a frame can be checked (`presentFrameSchema`), logged or
 * sent to another process. Fields marked "extension point" are presentation-only effects (camera
 * framing, depth layers, squash and stretch) that a backend may ignore.
 */

/**
 * Which way an entity looks: the four cardinals, or (Engine 0.9, owner answer 128 to item 48) a
 * diagonal for views such as the RTS. A kit that only turns four ways keeps emitting cardinals.
 */
export type Facing = 'up' | 'down' | 'left' | 'right' | 'up-left' | 'up-right' | 'down-left' | 'down-right';

/** Every facing: the four cardinals first, then the four diagonals. */
export const FACINGS: readonly Facing[] = [
  'up',
  'down',
  'left',
  'right',
  'up-left',
  'up-right',
  'down-left',
  'down-right',
];

/**
 * The cardinal a facing falls back to: itself for a cardinal, a diagonal's horizontal part
 * (`up-right` gives `right`, owner answer 128). Pure.
 */
export function cardinalFacing(facing: Facing): 'up' | 'down' | 'left' | 'right' {
  switch (facing) {
    case 'up-left':
    case 'down-left':
      return 'left';
    case 'up-right':
    case 'down-right':
      return 'right';
    default:
      return facing;
  }
}

/** True for `left` and the left-hand diagonals: the facings a flipped right-hand frame stands in for. */
export function facesLeft(facing: Facing): boolean {
  return cardinalFacing(facing) === 'left';
}

/** The facing mirrored left to right (`up-left` gives `up-right`; `up` and `down` stay). Pure. */
export function mirrorFacing(facing: Facing): Facing {
  switch (facing) {
    case 'left':
      return 'right';
    case 'right':
      return 'left';
    case 'up-left':
      return 'up-right';
    case 'up-right':
      return 'up-left';
    case 'down-left':
      return 'down-right';
    case 'down-right':
      return 'down-left';
    default:
      return facing;
  }
}

/** An entity's animation: the state's name (`walk`, `hurt`) and the ticks spent in it. */
export interface PresentAnim {
  state: string;
  /** Ticks since the state began, a whole number from 0. */
  t: number;
}

/**
 * Extension point: squash and stretch. Scale factors around the entity's box (1 is normal size).
 * A backend may ignore any of them.
 */
export interface PresentFx {
  squashX?: number;
  squashY?: number;
  /** Turn in degrees, clockwise. */
  rotate?: number;
  /** 0 (invisible) to 1 (opaque). */
  alpha?: number;
  /** A presentation-only flash or tint name a skin may map to an effect (`hit`). */
  tint?: string;
}

/** One thing on screen, in world pixels. */
export interface PresentEntity {
  /** Stable across frames for the same thing, so a backend can keep per-entity state (tweens). */
  id: string;
  /** What it is; a skin maps each kind to a sprite or a mesh. */
  kind: string;
  /** Top-left corner and size of its box, in world pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  facing: Facing;
  anim: PresentAnim;
  /** Free labels a skin may match on (`boss`, `stunned`). */
  tags: string[];
  /** Extension point: depth layer, drawn low to high (0 when absent); ties keep list order. */
  layer?: number;
  /** Extension point: squash, stretch and other presentation-only effects. */
  fx?: PresentFx;
}

/** A tile map as rows of characters, one per tile (the same text grids content uses). */
export type PresentTilesText = string[];
/** A tile map as rows of tile ids. */
export type PresentTilesGrid = number[][];

/** An extra map layer (decoration over or under the main tiles). */
export interface PresentMapLayer {
  name: string;
  tiles: PresentTilesText | PresentTilesGrid;
}

/** A map is named by its id and version; a new version means its tiles changed. */
export interface PresentMapRef {
  id: string;
  /** Whole number; it changes whenever any tile changes. */
  version: number;
}

/** The whole level map, sent only when it is loaded or changes (see `MapTracker`). */
export interface PresentMap extends PresentMapRef {
  /** One tile's side, in world pixels. */
  tileSize: number;
  cols: number;
  rows: number;
  /** `rows` rows of `cols` tiles each. */
  tiles: PresentTilesText | PresentTilesGrid;
  /** Extension point: extra layers, drawn in order after `tiles`. */
  layers?: PresentMapLayer[];
  /** Free labels a skin may match on (`dark`); part of the map, so a change bumps `version`. */
  tags?: string[];
}

/**
 * Something that happened this frame (`jumped`, `hit`, `coin`), so a skin can attach a sound or an
 * effect. `x`/`y` place it in world pixels; `entity` is the id it concerns. Other fields are any
 * JSON-safe data the kit documents.
 */
export interface PresentEvent {
  type: string;
  x?: number;
  y?: number;
  entity?: string;
  [field: string]: JsonValue | undefined;
}

/** A world-pixel box (top-left and size). */
export interface PresentBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Extension point: where the camera should look. A backend may frame the picture its own way.
 * The optional fields override the skin's `camera` defaults for this frame (the Canvas2D
 * presenter: `follow` beats `x`/`y`, which beat the skin's `follow`; the hint's `deadzone` and
 * `lerp` beat the skin's).
 */
export interface CameraHint {
  /** The world point at the centre of the picture (used when `follow` is absent or not found). */
  x: number;
  y: number;
  /** 1 is one world pixel per picture pixel. */
  zoom?: number;
  /** The entity to follow, by id: its box centre is the target. */
  follow?: string;
  /** Screen shake strength in pixels. */
  shake?: number;
  /** A box round the picture's centre (w x h pixels) the target moves in without scrolling. */
  deadzone?: { w: number; h: number };
  /** The fraction of the gap the camera closes each frame, 0 to 1 (1 snaps). */
  lerp?: number;
  /**
   * The world box the view must stay inside instead of the whole map (a kit-side scroll lock or
   * a room); one smaller than the picture is centred.
   */
  bounds?: PresentBox;
}

/** A HUD value: health, score, a room's name. */
export type PresentStatusValue = number | string | boolean;

/** One frame of the presentation contract. */
export interface PresentFrame {
  /** The tick this frame shows, a whole number from 0. */
  frame: number;
  /** The game picture's size (`game.json`'s `screen`). */
  size: ScreenSize;
  /** Drawn by `layer`, then in list order. */
  entities: PresentEntity[];
  /** The full map when it was loaded or changed, otherwise only its id and version. */
  map?: PresentMap | PresentMapRef;
  events: PresentEvent[];
  status: Record<string, PresentStatusValue>;
  camera?: CameraHint;
}

/** A type with every field and element read-only, all the way down. */
export type DeepReadonly<T> = T extends (infer E)[]
  ? readonly DeepReadonly<E>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/** What a backend implements to show frames. It reads a frame and never changes it. */
export interface Presenter {
  present(frame: DeepReadonly<PresentFrame>): void;
  /** The game picture's size changed. */
  resize?(size: ScreenSize): void;
}

/** True when `map` carries its tiles, not only its id and version. */
export function isFullMap(map: DeepReadonly<PresentMap | PresentMapRef>): map is DeepReadonly<PresentMap> {
  return 'tiles' in map;
}
