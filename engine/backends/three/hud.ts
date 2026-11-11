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
  type PresentMap,
  type SkinFile,
} from '@engine/core/present';
import {
  paintUi,
  SkinHud,
  type FontLookup,
  type UiDraw,
  type UiFill,
  type UiGlyph,
  type UiImage,
  type UiPainter,
} from '@engine/core/ui';

/** One quad the HUD pass shows: what it draws and where, in picture pixels (top-left, y down). */
export interface HudQuad {
  /**
   * `box` is a flat box standing in for a missing frame; from Engine 0.16 T6 `fill` is a UI kit
   * box (a bar, a minimap tile) and `glyph` one glyph of a font file in one colour.
   */
  kind: 'sprite' | 'box' | 'fill' | 'glyph';
  x: number;
  y: number;
  w: number;
  h: number;
  /** A sprite's sheet, palette (when recoloured) and frame. */
  sheet?: string;
  palette?: string;
  frame?: string;
  /** A box's or glyph's colour. */
  color?: string;
  /** A box's alpha when below 1 (UI kit fills). */
  alpha?: number;
  /** The part of a sprite frame shown when it is not the whole frame (a nine-slice piece). */
  part?: { x: number; y: number; w: number; h: number };
  /** A glyph's font and character. */
  font?: string;
  ch?: string;
}

type Placed = { quad: HudQuad; material: MeshBasicMaterial };

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
  /** The skin's HUD through the UI kit (Engine 0.16 T6), used when it has a UI item. */
  private readonly ui: SkinHud;
  /** Display frames synced (a counter's roll clock). */
  private clock = -1;

  constructor(
    private readonly skin: DeepReadonly<SkinFile>,
    private readonly pixels: PixelSheetLookup | undefined,
    private readonly fonts?: FontLookup,
  ) {
    this.ui = new SkinHud(skin, fonts !== undefined ? { fonts } : {});
  }

  /**
   * Lays the HUD out for `frame` and places the quads; hides the pass when nothing shows. `map` is
   * the map the scene shows (a minimap's tiles), or null.
   */
  sync(
    frame: DeepReadonly<PresentFrame>,
    size: ScreenSize,
    map: DeepReadonly<PresentMap> | null = null,
  ): void {
    const cam = this.camera;
    if (cam.right !== size.width || cam.bottom !== -size.height) {
      cam.right = size.width;
      cam.bottom = -size.height;
      cam.updateProjectionMatrix();
    }
    this.clock++;
    const frameSize = (sheet: string, palette: string | undefined, name: string) =>
      this.frameRect(sheet, palette, name);
    const quads: Placed[] = [];
    if (this.ui.usesUi) {
      const draws = this.ui.layout({
        status: frame.status,
        frameSize,
        map,
        entities: frame.entities,
        clock: this.clock,
        fog: frame.fog ?? null,
      });
      paintUi(draws, this.painter(quads));
    } else {
      const draws = layoutHud(this.skin, frame.status, frameSize);
      for (const d of draws.flatMap((d) => (d.kind === 'text' ? hudGlyphs(d) : [d]))) {
        const placed = this.quadOf(d);
        if (placed) quads.push(placed);
      }
    }
    this.place(quads);
  }

  /**
   * Places UI kit draw items as quads (Engine 0.16 T9: the shell's menus over the 3D picture), in
   * order, on a camera spanning `size`; an empty list hides the pass.
   */
  syncDraws(draws: readonly UiDraw[], size: ScreenSize): void {
    const cam = this.camera;
    if (cam.right !== size.width || cam.bottom !== -size.height) {
      cam.right = size.width;
      cam.bottom = -size.height;
      cam.updateProjectionMatrix();
    }
    const quads: Placed[] = [];
    paintUi(draws, this.painter(quads));
    this.place(quads);
  }

  /** Puts the quads on pooled meshes in draw order; meshes left over hide. */
  private place(quads: Placed[]): void {
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
    for (const m of this.glyphs.values()) {
      m?.map?.dispose();
      m?.dispose();
    }
    this.sprites.clear();
    this.boxes.clear();
    this.glyphs.clear();
  }

  /** Glyph materials by `font#ch#color` (null: no such font or glyph). */
  private readonly glyphs = new Map<string, MeshBasicMaterial | null>();

  /** A `UiPainter` that places each UI kit item as one quad in `out`. */
  private painter(out: Placed[]): UiPainter {
    return {
      fill: (d: UiFill) => {
        if (d.w <= 0 || d.h <= 0) return;
        const alpha = d.alpha ?? 1;
        const key = alpha < 1 ? `${d.color}@${alpha}` : d.color;
        let material = this.boxes.get(key);
        if (!material) {
          material = hudMaterial({ color: d.color, ...(alpha < 1 && { opacity: alpha }) });
          this.boxes.set(key, material);
        }
        const quad: HudQuad = {
          kind: d.missing ? 'box' : 'fill',
          x: d.x,
          y: d.y,
          w: d.w,
          h: d.h,
          color: d.color,
        };
        if (alpha < 1) quad.alpha = alpha;
        out.push({ quad, material });
      },
      image: (d: UiImage) => {
        if (d.w <= 0 || d.h <= 0 || d.sw <= 0 || d.sh <= 0) return;
        const pixels = this.pixels?.(d.sheet, d.palette) ?? null;
        const rect = pixels?.frames.get(d.frame);
        if (!pixels || !rect) return;
        const whole = d.sx === 0 && d.sy === 0 && d.sw === rect.w && d.sh === rect.h;
        const part = { x: d.sx, y: d.sy, w: d.sw, h: d.sh };
        const key =
          `${d.sheet}@${d.palette ?? ''}#${d.frame}` + (whole ? '' : `:${d.sx},${d.sy},${d.sw},${d.sh}`);
        let material = this.sprites.get(key);
        if (material === undefined) {
          const cut = { x: rect.x + d.sx, y: rect.y + d.sy, w: d.sw, h: d.sh };
          material = hudMaterial({ map: frameTexture(pixels, cut) });
          this.sprites.set(key, material);
        }
        if (material === null) return;
        const quad: HudQuad = {
          kind: 'sprite',
          x: d.x,
          y: d.y,
          w: d.w,
          h: d.h,
          sheet: d.sheet,
          ...(d.palette !== undefined && { palette: d.palette }),
          frame: d.frame,
          ...(!whole && { part }),
        };
        out.push({ quad, material });
      },
      glyph: (d: UiGlyph) => {
        const material = this.glyphMaterial(d.font, d.ch, d.color);
        const glyph = this.fonts?.(d.font)?.glyphs.get(d.ch);
        if (!material || !glyph) return;
        const quad: HudQuad = {
          kind: 'glyph',
          x: d.x,
          y: d.y,
          w: glyph.w,
          h: glyph.h,
          font: d.font,
          ch: d.ch,
          color: d.color,
        };
        out.push({ quad, material });
      },
    };
  }

  /** One glyph's ink in one colour as a texture, rows flipped for GL; cached. */
  private glyphMaterial(fontId: string, ch: string, color: string): MeshBasicMaterial | null {
    const key = `${fontId}#${ch}#${color}`;
    const cached = this.glyphs.get(key);
    if (cached !== undefined) return cached;
    const glyph = this.fonts?.(fontId)?.glyphs.get(ch);
    let material: MeshBasicMaterial | null = null;
    if (glyph && glyph.w > 0 && glyph.h > 0) {
      const rgb = hexBytes(color);
      const data = new Uint8Array(glyph.w * glyph.h * 4);
      for (const run of glyph.runs) {
        const row = glyph.h - 1 - run.y;
        for (let x = run.x; x < run.x + run.w; x++) data.set([...rgb, 255], (row * glyph.w + x) * 4);
      }
      const texture = new DataTexture(data, glyph.w, glyph.h, RGBAFormat, UnsignedByteType);
      texture.magFilter = NearestFilter;
      texture.minFilter = NearestFilter;
      texture.generateMipmaps = false;
      texture.colorSpace = SRGBColorSpace;
      texture.needsUpdate = true;
      material = hudMaterial({ map: texture });
    }
    this.glyphs.set(key, material);
    return material;
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
function hudMaterial(opts: { color?: string; map?: DataTexture; opacity?: number }): MeshBasicMaterial {
  // Every HUD material is in Three's transparent list, so `renderOrder` alone orders the quads
  // (an opaque box would otherwise be drawn before every textured quad, under a panel).
  return new MeshBasicMaterial({
    ...(opts.color !== undefined && { color: opts.color }),
    ...(opts.opacity !== undefined && { opacity: opts.opacity }),
    ...(opts.map !== undefined && { map: opts.map, alphaTest: 0.5 }),
    transparent: true,
    depthTest: false,
    depthWrite: false,
    // HUD colours are drawn as written: no fog and no tone mapping (Engine 0.16 T12).
    fog: false,
    toneMapped: false,
  });
}

/** A `#rgb` or `#rrggbb` colour as its three bytes. */
function hexBytes(color: string): [number, number, number] {
  let hex = color.slice(1);
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
  const n = Number.parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
