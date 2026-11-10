import {
  DataTexture,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  SRGBColorSpace,
  Scene,
  UnsignedByteType,
} from 'three';
import type { PixelSheetLookup } from '@engine/core/assets/content-sheets';
import type { ScreenSize } from '@engine/core/gfx/screen';
import {
  hudGlyphs,
  layoutHud,
  type DeepReadonly,
  type HudDraw,
  type PresentFrame,
  type SkinFile,
} from '@engine/core/present';

/** One quad the HUD pass shows: what it draws and where, in picture pixels (top-left, y down). */
export interface HudQuad {
  kind: 'sprite' | 'box';
  x: number;
  y: number;
  w: number;
  h: number;
  /** A sprite's sheet, palette (when recoloured) and frame. */
  sheet?: string;
  palette?: string;
  frame?: string;
  /** A box's colour. */
  color?: string;
}

/**
 * The 3D backend's HUD (Engine 0.15, gap G33, decision 4): the core `layoutHud` items for a frame's
 * `status` through the skin's `hud`, drawn as a second, orthographic pass over the 3D picture. Each
 * item is one quad: a sprite frame (font glyphs too, through `hudGlyphs`) is a `DataTexture` cut
 * from the sheet's decoded pixels (`PixelSheetLookup`), nearest-neighbour filtered so the pixels
 * stay crisp; a missing frame's box is a flat colour. The camera spans the picture in picture
 * pixels, so the HUD sits where the 2D one does. No canvas: it runs in Node like `ThreeScene`.
 * Quads are pooled by draw order and textures and materials cached by frame and colour.
 */
export class HudLayer {
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(0, 1, 0, -1, -10, 10);

  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly pool: Mesh<PlaneGeometry, MeshBasicMaterial>[] = [];
  /** Sprite materials by `sheet@palette#frame` (null: the sheet or frame is missing). */
  private readonly sprites = new Map<string, MeshBasicMaterial | null>();
  private readonly boxes = new Map<string, MeshBasicMaterial>();
  private shown: HudQuad[] = [];

  constructor(
    private readonly skin: DeepReadonly<SkinFile>,
    private readonly pixels: PixelSheetLookup | undefined,
  ) {}

  /** Lays the HUD out for `frame` and places the quads; hides the pass when nothing shows. */
  sync(frame: DeepReadonly<PresentFrame>, size: ScreenSize): void {
    const cam = this.camera;
    if (cam.right !== size.width || cam.bottom !== -size.height) {
      cam.right = size.width;
      cam.bottom = -size.height;
      cam.updateProjectionMatrix();
    }
    const draws = layoutHud(this.skin, frame.status, (sheet, palette, name) =>
      this.frameRect(sheet, palette, name),
    );
    const quads: { quad: HudQuad; material: MeshBasicMaterial }[] = [];
    for (const d of draws.flatMap((d) => (d.kind === 'text' ? hudGlyphs(d) : [d]))) {
      const placed = this.quadOf(d);
      if (placed) quads.push(placed);
    }
    while (this.pool.length < quads.length) {
      const mesh = new Mesh(this.geometry, quads[this.pool.length]!.material);
      mesh.frustumCulled = false;
      this.pool.push(mesh);
      this.scene.add(mesh);
    }
    this.pool.forEach((mesh, i) => {
      const item = quads[i];
      mesh.visible = item !== undefined;
      if (!item) return;
      const { quad, material } = item;
      mesh.material = material;
      mesh.renderOrder = i;
      mesh.scale.set(quad.w, quad.h, 1);
      mesh.position.set(quad.x + quad.w / 2, -(quad.y + quad.h / 2), 0);
      mesh.updateMatrixWorld();
    });
    this.shown = quads.map((q) => q.quad);
  }

  /** The quads shown after the last `sync`, in draw order. */
  quads(): HudQuad[] {
    return this.shown.map((q) => ({ ...q }));
  }

  /** Frees the quad geometry, every texture and material. */
  dispose(): void {
    this.geometry.dispose();
    for (const m of this.sprites.values()) {
      m?.map?.dispose();
      m?.dispose();
    }
    for (const m of this.boxes.values()) m.dispose();
    this.sprites.clear();
    this.boxes.clear();
  }

  private frameRect(
    sheet: string,
    palette: string | undefined,
    name: string,
  ): { w: number; h: number } | null {
    const rect = this.pixels?.(sheet, palette)?.frames.get(name);
    return rect ? { w: rect.w, h: rect.h } : null;
  }

  private quadOf(
    d: Exclude<HudDraw, { kind: 'text' }>,
  ): { quad: HudQuad; material: MeshBasicMaterial } | null {
    if (d.kind === 'box') {
      let material = this.boxes.get(d.color);
      if (!material) {
        material = hudMaterial({ color: d.color });
        this.boxes.set(d.color, material);
      }
      return { quad: { kind: 'box', x: d.x, y: d.y, w: d.w, h: d.h, color: d.color }, material };
    }
    const rect = this.frameRect(d.sheet, d.palette, d.frame);
    const material = this.spriteMaterial(d.sheet, d.palette, d.frame);
    if (!rect || !material) return null;
    const quad: HudQuad = {
      kind: 'sprite',
      x: d.x,
      y: d.y,
      w: rect.w,
      h: rect.h,
      sheet: d.sheet,
      ...(d.palette !== undefined && { palette: d.palette }),
      frame: d.frame,
    };
    return { quad, material };
  }

  /** The material for one frame: its pixels cut from the sheet, rows flipped for GL (v = 0 is the bottom). */
  private spriteMaterial(sheet: string, palette: string | undefined, name: string): MeshBasicMaterial | null {
    const key = `${sheet}@${palette ?? ''}#${name}`;
    if (this.sprites.has(key)) return this.sprites.get(key)!;
    const pixels = this.pixels?.(sheet, palette) ?? null;
    const rect = pixels?.frames.get(name);
    let material: MeshBasicMaterial | null = null;
    if (pixels && rect && rect.w > 0 && rect.h > 0)
      material = hudMaterial({ map: frameTexture(pixels, rect) });
    this.sprites.set(key, material);
    return material;
  }
}

/**
 * One sprite frame's pixels cut from a decoded sheet as a `DataTexture`, rows flipped for GL (v = 0
 * is the bottom), nearest-neighbour so pixels stay crisp, sRGB. The HUD and parallax planes use it.
 */
export function frameTexture(
  pixels: { width: number; data: Uint8Array | Uint8ClampedArray },
  rect: { x: number; y: number; w: number; h: number },
): DataTexture {
  const data = new Uint8Array(rect.w * rect.h * 4);
  for (let row = 0; row < rect.h; row++) {
    const from = ((rect.y + row) * pixels.width + rect.x) * 4;
    data.set(pixels.data.subarray(from, from + rect.w * 4), (rect.h - 1 - row) * rect.w * 4);
  }
  const texture = new DataTexture(data, rect.w, rect.h, RGBAFormat, UnsignedByteType);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** An unlit HUD material: drawn over the picture in order, no depth, fully transparent pixels skipped. */
function hudMaterial(opts: { color?: string; map?: DataTexture }): MeshBasicMaterial {
  return new MeshBasicMaterial({
    ...(opts.color !== undefined && { color: opts.color }),
    ...(opts.map !== undefined && { map: opts.map, transparent: true, alphaTest: 0.5 }),
    depthTest: false,
    depthWrite: false,
  });
}
