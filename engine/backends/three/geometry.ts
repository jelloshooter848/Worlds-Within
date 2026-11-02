import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  PlaneGeometry,
  Shape,
  SphereGeometry,
  type BufferGeometry,
} from 'three';
import { LOW_POLY_SEGMENTS, type MeshPrimitive } from '@engine/core/present';

/** A part's box in world px: width (x), height (y), depth (z). */
export interface PartSize {
  w: number;
  h: number;
  d: number;
}

/**
 * The geometry of one skin primitive (`MESH_PRIMITIVES` in `@engine/core/present`), sized to `size`
 * and centred on the origin, in Three's axes (x right, y up, z toward the camera). Round shapes use
 * `LOW_POLY_SEGMENTS`, so every run builds the same low-poly shape.
 */
export function primitiveGeometry(shape: MeshPrimitive, size: PartSize): BufferGeometry {
  const { w, h, d } = size;
  const { radial, rings } = LOW_POLY_SEGMENTS;
  switch (shape) {
    case 'box':
      return new BoxGeometry(w, h, d);
    case 'wedge': {
      // Side profile (x-y): nothing at the left, full height at the right; extruded through d.
      const profile = new Shape();
      profile.moveTo(-w / 2, -h / 2);
      profile.lineTo(w / 2, -h / 2);
      profile.lineTo(w / 2, h / 2);
      profile.closePath();
      const g = new ExtrudeGeometry(profile, { depth: d, bevelEnabled: false, steps: 1 });
      return g.translate(0, 0, -d / 2);
    }
    case 'cylinder':
      return new CylinderGeometry(0.5, 0.5, 1, radial).scale(w, h, d);
    case 'cone':
      return new ConeGeometry(0.5, 1, radial).scale(w, h, d);
    case 'sphere':
      return new SphereGeometry(0.5, radial, rings).scale(w, h, d);
    case 'plane':
      return new PlaneGeometry(w, h);
  }
}

/**
 * Geometries shared by every mesh of the same shape and size, built once each. Owned by one
 * `ThreeScene`; `dispose()` frees them all.
 */
export class GeometryCache {
  private readonly built = new Map<string, BufferGeometry>();

  get(shape: MeshPrimitive, size: PartSize): BufferGeometry {
    const key = `${shape}:${size.w}x${size.h}x${size.d}`;
    let g = this.built.get(key);
    if (!g) {
      g = primitiveGeometry(shape, size);
      this.built.set(key, g);
    }
    return g;
  }

  /** How many distinct geometries it holds. */
  get size(): number {
    return this.built.size;
  }

  dispose(): void {
    for (const g of this.built.values()) g.dispose();
    this.built.clear();
  }
}
