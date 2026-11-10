import type { ContentBundle, LoadedImageSheet } from '../content/bundle';
import { imageSheetFrames, type ImageSheetSpec } from '../gfx/image-sheet';
import type { Rasterized } from '../gfx/pixelart';

/**
 * Loading a game's PNG sprite sheets (Engine 0.16 T10). Skins name image sheets in `images`
 * (`engine/core/gfx/image-sheet.ts`); their PNGs travel with the game's files as `data:` URLs
 * (`bundle.assets`). `withContentImages(content)` decodes every one before the first frame and
 * returns the bundle with `images` filled, so `contentSheets` (the 2D backend) and
 * `contentPixelSheets` (the 3D HUD) give them by id like text sprites. A game's page awaits it
 * before it boots, and the screenshot page before it creates the view, so no frame is drawn
 * before the images are there.
 */

/** A decoded image: something a 2D canvas can draw, and its RGBA pixels when they can be read. */
export interface DecodedImage {
  image: CanvasImageSource | null;
  width: number;
  height: number;
  /** Row-major RGBA, `width * height * 4` bytes, or null. */
  data: Uint8ClampedArray | null;
}

/** Decodes one PNG `data:` URL. */
export type ImageDecoder = (dataUrl: string) => Promise<DecodedImage>;

/** The browser's decoder: an `<img>` decoded, its pixels read back through a 2D canvas. */
export const browserImageDecoder: ImageDecoder = async (dataUrl) => {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  let data: Uint8ClampedArray | null = null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(img, 0, 0);
    data = ctx.getImageData(0, 0, width, height).data;
  }
  return { image: img, width, height, data };
};

/** Every skin's image sheet specs, by image id, in entry order (the first of an id wins). */
export function contentImageSpecs(content: ContentBundle): Map<string, ImageSheetSpec> {
  const out = new Map<string, ImageSheetSpec>();
  for (const e of content.entries) {
    if (e.kind !== 'skin') continue;
    const images = (e.value as { images?: Record<string, ImageSheetSpec> }).images ?? {};
    for (const [id, spec] of Object.entries(images)) if (!out.has(id)) out.set(id, spec);
  }
  return out;
}

/**
 * The bundle with every skin's PNG sheets decoded into `images` (a new bundle; the given one is
 * untouched). A bundle without image sheets comes back as it is. An image whose file is missing
 * or will not decode is left out (validate reports the file), so its entries draw their fallback
 * boxes. Each file is decoded once, however many ids name it.
 */
export async function withContentImages(
  content: ContentBundle,
  decode: ImageDecoder = browserImageDecoder,
): Promise<ContentBundle> {
  const specs = contentImageSpecs(content);
  if (specs.size === 0) return content;
  const files = new Map<string, Promise<DecodedImage | null>>();
  const images = new Map<string, LoadedImageSheet>();
  for (const [id, spec] of specs) {
    const url = content.assets?.[spec.image];
    if (url === undefined) continue;
    if (!files.has(spec.image))
      files.set(
        spec.image,
        decode(url).catch(() => null),
      );
    const decoded = await files.get(spec.image)!;
    if (decoded === null) continue;
    const frames = imageSheetFrames(spec);
    const pixels: Rasterized | null =
      decoded.data === null
        ? null
        : { width: decoded.width, height: decoded.height, frames, data: decoded.data };
    images.set(id, { sheet: { id, image: decoded.image, frames }, pixels });
  }
  return { ...content, images };
}
