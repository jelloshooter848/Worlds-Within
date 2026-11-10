import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, type PerspectiveCamera } from 'three';
import type { PixelSheetLookup } from '@engine/core/assets/content-sheets';
import { layoutParallax, type ParallaxDraw } from '@engine/core/fx';
import type { ScreenSize } from '@engine/core/gfx/screen';
import type { DeepReadonly, SkinFile } from '@engine/core/present';
import { frameTexture } from './hud';

/** How far apart (px) layers without a `depth` stand: the last layer this far behind the blocks. */
export const PARALLAX_DEPTH_STEP = 200;

/** Draw order of the parallax planes: before everything else (they are the background). */
const PARALLAX_ORDER = -1000;

/**
 * The 3D backend's parallax layers (Engine 0.16 T4): a skin's `parallax` list as distant planes.
 * The draws are the core `layoutParallax` ones (the layout the Canvas2D presenter draws, so the
 * layers sit and scroll exactly as in 2D), each a quad on the layer's plane, `depth` px behind
 * the blocks (default {@link PARALLAX_DEPTH_STEP} per place from the front). The planes hang on
 * the camera (`group` is the camera's child), facing it, sized so one picture px of a draw covers
 * one picture px on screen, and drawn first with no depth test, behind everything. A frame layer
 * is a texture cut from the game's decoded sheets (`PixelSheetLookup`); without sheets only
 * gradients show. Runs in Node (no canvas), like the HUD.
 */
export class ParallaxPlanes {
  /** The planes' group; the scene adds it to its camera. */
  readonly group = new Group();

  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly pool: Mesh<PlaneGeometry, MeshBasicMaterial>[] = [];
  private readonly sprites = new Map<string, MeshBasicMaterial | null>();
  private readonly boxes = new Map<string, MeshBasicMaterial>();
  private shown: ParallaxDraw[] = [];

  constructor(
    private readonly skin: DeepReadonly<SkinFile>,
    private readonly pixels: PixelSheetLookup | undefined,
  ) {
    this.group.name = 'parallax';
  }

  /** How far behind the blocks (px) layer `index` stands. */
  depth(index: number): number {
    const layers = this.skin.parallax ?? [];
    return layers[index]?.depth ?? (layers.length - index) * PARALLAX_DEPTH_STEP;
  }

  /**
   * Places the planes for a camera top-left `cam` in picture px (zoom and shake included, as the
   * Canvas2D presenter scrolls them) on a picture of `size`; `distance` is the camera's distance
   * to the blocks' plane (z = 0).
   */
  sync(cam: { x: number; y: number }, size: ScreenSize, camera: PerspectiveCamera, distance: number): void {
    if (this.skin.parallax === undefined) return;
    const frameSize = (sheet: string, palette: string | undefined, frame: string) => {
      const rect = this.pixels?.(sheet, palette)?.frames.get(frame);
      return rect ? { w: rect.w, h: rect.h } : null;
    };
    const draws = layoutParallax(this.skin, cam, size, frameSize);
    const placed: { draw: ParallaxDraw; material: MeshBasicMaterial }[] = [];
    for (const d of draws) {
      const material =
        d.kind === 'box' ? this.boxMaterial(d.color) : this.spriteMaterial(d.sheet, d.palette, d.frame);
      if (material) placed.push({ draw: d, material });
    }
    while (this.pool.length < placed.length) {
      const mesh = new Mesh(this.geometry, placed[this.pool.length]!.material);
      mesh.frustumCulled = false;
      this.pool.push(mesh);
      this.group.add(mesh);
    }
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    this.pool.forEach((mesh, i) => {
      const item = placed[i];
      mesh.visible = item !== undefined;
      if (!item) return;
      const { draw, material } = item;
      const w = draw.kind === 'box' ? draw.w : frameSize(draw.sheet, draw.palette, draw.frame)!.w;
      const h = draw.kind === 'box' ? draw.h : frameSize(draw.sheet, draw.palette, draw.frame)!.h;
      const at = Math.min(distance + this.depth(draw.layer), camera.far * 0.95);
      // World units per picture px on this plane.
      const k = (2 * at * tan) / size.height;
      mesh.material = material;
      mesh.renderOrder = PARALLAX_ORDER + i;
      mesh.scale.set(w * k, h * k, 1);
      mesh.position.set((draw.x + w / 2 - size.width / 2) * k, -(draw.y + h / 2 - size.height / 2) * k, -at);
      mesh.updateMatrix();
    });
    this.shown = placed.map((p) => p.draw);
  }

  /** The draws shown after the last `sync`, back to front. */
  draws(): ParallaxDraw[] {
    return this.shown.map((d) => ({ ...d }));
  }

  /** The planes' meshes in use (visible), back to front. */
  meshes(): Mesh<PlaneGeometry, MeshBasicMaterial>[] {
    return this.pool.filter((m) => m.visible);
  }

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

  private boxMaterial(color: string): MeshBasicMaterial {
    let material = this.boxes.get(color);
    if (!material) {
      material = new MeshBasicMaterial({ color, depthTest: false, depthWrite: false });
      this.boxes.set(color, material);
    }
    return material;
  }

  private spriteMaterial(sheet: string, palette: string | undefined, name: string): MeshBasicMaterial | null {
    const key = `${sheet}@${palette ?? ''}#${name}`;
    if (this.sprites.has(key)) return this.sprites.get(key)!;
    const pixels = this.pixels?.(sheet, palette) ?? null;
    const rect = pixels?.frames.get(name);
    let material: MeshBasicMaterial | null = null;
    if (pixels && rect && rect.w > 0 && rect.h > 0) {
      // Opaque with an alpha test, so it sorts with the opaque meshes and draws first.
      material = new MeshBasicMaterial({
        map: frameTexture(pixels, rect),
        alphaTest: 0.5,
        depthTest: false,
        depthWrite: false,
      });
    }
    this.sprites.set(key, material);
    return material;
  }
}
