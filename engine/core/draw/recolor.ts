import type { SpriteSheet } from '../gfx/spritesheet';

/**
 * Recoloured sprite sheets (Engine 0.16 part D, D4): an outline's silhouette and a team colour are
 * the same sheet with its pixels changed. The pixel maths is here, pure, so both 2D backends
 * recolour alike; reading and writing an image's pixels is the backend's (`ImageRecolor`, the
 * canvas one is `canvasRecolor` in `@engine/core/assets/canvas-recolor`).
 */

/** A change to a sheet's pixels. */
export type RecolorSpec =
  /** Every pixel with any alpha becomes `color`, fully opaque (an outline's silhouette). */
  | { readonly kind: 'silhouette'; readonly color: string }
  /** Pixels of exactly the `mask` colour become `color`. */
  | { readonly kind: 'mask'; readonly mask: string; readonly color: string }
  /** Coloured pixels with a hue in `[min, max]` take `color`'s hue and saturation, keeping their lightness. */
  | { readonly kind: 'hue'; readonly min: number; readonly max: number; readonly color: string }
  /** Every pixel's colour multiplied by `color`. */
  | { readonly kind: 'tint'; readonly color: string };

/**
 * Makes a recoloured copy of a sheet image: `edit` changes its row-major RGBA pixels in place.
 * Returns the new image, or null where pixels cannot be read (no canvas, a GPU texture).
 */
export type ImageRecolor = (
  image: NonNullable<SpriteSheet['image']>,
  edit: (data: Uint8ClampedArray, width: number, height: number) => void,
) => SpriteSheet['image'] | null;

/** A pixel is grey (left alone by a `hue` recolour) below this HSL saturation. */
export const HUE_MIN_SATURATION = 0.15;

/** A spec as a cache key. */
export function recolorKey(spec: RecolorSpec): string {
  switch (spec.kind) {
    case 'silhouette':
      return `silhouette ${spec.color}`;
    case 'mask':
      return `mask ${spec.mask} ${spec.color}`;
    case 'hue':
      return `hue ${spec.min}-${spec.max} ${spec.color}`;
    case 'tint':
      return `tint ${spec.color}`;
  }
}

/** `#rgb` or `#rrggbb` as [r, g, b], 0-255. */
export function hexRgb(color: string): [number, number, number] {
  const hex = color.slice(1);
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

/** RGB (0-255) as HSL: hue in degrees [0, 360), saturation and lightness 0-1. */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

/** HSL (hue degrees, saturation and lightness 0-1) as RGB, 0-255, rounded. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = l - c / 2;
  return [r1, g1, b1].map((v) => Math.round(Math.min(1, Math.max(0, v + m)) * 255)) as [
    number,
    number,
    number,
  ];
}

/** Whether `hue` lies in `[min, max]`, wrapping through 360 when `min` is above `max`. */
export function hueInRange(hue: number, min: number, max: number): boolean {
  return min <= max ? hue >= min && hue <= max : hue >= min || hue <= max;
}

/** Applies `spec` to row-major RGBA `data` in place. Fully transparent pixels are left alone. */
export function recolorPixels(data: Uint8ClampedArray, spec: RecolorSpec): void {
  const [cr, cg, cb] = hexRgb(spec.color);
  const mask = spec.kind === 'mask' ? hexRgb(spec.mask) : null;
  const [th, ts] = spec.kind === 'hue' ? rgbToHsl(cr, cg, cb) : [0, 0];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    switch (spec.kind) {
      case 'silhouette':
        data[i] = cr;
        data[i + 1] = cg;
        data[i + 2] = cb;
        data[i + 3] = 255;
        break;
      case 'mask':
        if (r === mask![0] && g === mask![1] && b === mask![2]) {
          data[i] = cr;
          data[i + 1] = cg;
          data[i + 2] = cb;
        }
        break;
      case 'hue': {
        const [h, s, l] = rgbToHsl(r, g, b);
        if (s < HUE_MIN_SATURATION || !hueInRange(h, spec.min, spec.max)) break;
        const [nr, ng, nb] = hslToRgb(th, ts, l);
        data[i] = nr;
        data[i + 1] = ng;
        data[i + 2] = nb;
        break;
      }
      case 'tint':
        data[i] = Math.round((r * cr) / 255);
        data[i + 1] = Math.round((g * cg) / 255);
        data[i + 2] = Math.round((b * cb) / 255);
        break;
    }
  }
}

/**
 * A sheet's recoloured copies, made once per sheet and spec and kept (`SkinnedPresenter`'s cache):
 * `get(sheet, spec)` is a sheet with the same frames over the recoloured image, or null without a
 * `recolor` or where it cannot read the image (a headless sheet; the walk then draws without it).
 */
export class RecolorCache {
  private readonly sheets = new WeakMap<SpriteSheet, Map<string, SpriteSheet | null>>();

  constructor(private readonly recolor: ImageRecolor | undefined) {}

  get(sheet: SpriteSheet, spec: RecolorSpec): SpriteSheet | null {
    if (this.recolor === undefined || sheet.image === null) return null;
    let bySpec = this.sheets.get(sheet);
    if (!bySpec) {
      bySpec = new Map();
      this.sheets.set(sheet, bySpec);
    }
    const key = recolorKey(spec);
    let out = bySpec.get(key);
    if (out === undefined) {
      const image = this.recolor(sheet.image, (data) => recolorPixels(data, spec));
      out = image === null ? null : { id: `${sheet.id}#${key}`, image, frames: sheet.frames };
      bySpec.set(key, out);
    }
    return out;
  }
}
