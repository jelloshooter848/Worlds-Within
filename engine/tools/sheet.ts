import { UsageError } from './exit-codes';
import { launchChromium, pngBytes } from './screenshot';
import type { ShotBackend, SheetOverlay } from './screenshot/job';
import { overlayLabel, parseOverlay } from './sheet-overlay';

/**
 * `pnpm cli sheet` (Engine 0.16 T14): the tile list a sheet is made from, and the sheet itself,
 * tiled in headless Chromium. See `commands/sheet.ts` for the command.
 */

/** The backend names `sheet` takes: the screenshot backends and their short names. */
export const SHEET_BACKENDS = ['canvas2d', 'three', '2d', '3d'] as const;
export type SheetBackendName = (typeof SHEET_BACKENDS)[number];

/** A short backend name as the screenshot page's backend. */
export function sheetBackend(name: SheetBackendName): ShotBackend {
  return name === '2d' || name === 'canvas2d' ? 'canvas2d' : 'three';
}

/** One tile as written: `[<run>/]<tick>[+<overlay>][@<backend>]`. */
export interface SheetTileSpec {
  /** Another run file of the same folder (its name, `level-3` or `level-3.run.json`), or null. */
  run: string | null;
  tick: number;
  overlay: SheetOverlay | null;
  /** The tile's own backend, or null for the command's `--backend`. */
  backend: ShotBackend | null;
  /** As written. */
  text: string;
}

const TILE = /^(?:([A-Za-z0-9_.-]+)\/)?(\d+)(?:\+([^@]+))?(?:@([a-z0-9]+))?$/;

/**
 * Reads `--ticks`: comma-separated tiles, each `[<run>/]<tick>[+<overlay>][@<backend>]`
 * (`216`, `level-3/120`, `300+pause`, `40+ui=lab.talk*90`, `352+level*22`, `200@3d`). Throws a
 * `UsageError` naming the tile that is wrong.
 */
export function parseTiles(text: string): SheetTileSpec[] {
  const parts = text
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '');
  if (parts.length === 0) throw new UsageError('--ticks lists no tiles');
  return parts.map((part) => {
    const m = TILE.exec(part);
    if (m === null)
      throw new UsageError(
        `--ticks: "${part}" is not a tile; write [<run>/]<tick>[+<overlay>][@<backend>], such as 216, level-3/120, 300+pause or 200@3d`,
      );
    const [, run, tick, overlay, backend] = m;
    if (backend !== undefined && !(SHEET_BACKENDS as readonly string[]).includes(backend))
      throw new UsageError(`--ticks: "${part}": the backend is one of ${SHEET_BACKENDS.join(', ')}`);
    let parsed: SheetOverlay | null = null;
    if (overlay !== undefined) {
      try {
        parsed = parseOverlay(overlay);
      } catch (error) {
        throw new UsageError(`--ticks: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return {
      run: run ?? null,
      tick: Number(tick),
      overlay: parsed,
      backend: backend === undefined ? null : sheetBackend(backend as SheetBackendName),
      text: part,
    };
  });
}

/** A tile's second label line: the run, tick, overlay and backend. */
export function tileMeta(
  run: string,
  tile: { tick: number; overlay: SheetOverlay | null },
  backend: ShotBackend,
) {
  const name = run.replace(/^.*\//, '').replace(/\.run\.json$/, '');
  const over = tile.overlay === null ? '' : ` + ${overlayLabel(tile.overlay)}`;
  return `${name} t${tile.tick}${over} [${backend === 'three' ? '3D' : '2D'}]`;
}

/** One picture of the sheet: its PNG and its label lines. */
export interface SheetPicture {
  png: Buffer;
  lines: string[];
}

export interface ComposeOptions {
  columns: number;
  /** Whole-number scale of every picture (nearest neighbour). */
  scale: number;
  /** A heading over the sheet, or none. */
  title?: string;
}

/** Layout constants of a sheet, in sheet px. */
export const SHEET_GAP = 8;
export const SHEET_LINE = 14;

/**
 * Tiles the pictures into one PNG in headless Chromium (Canvas2D, GPU off): rows of `columns`,
 * each picture scaled by `scale` with nearest-neighbour sampling under its label lines (monospace
 * text, white on the sheet's dark grey), an optional heading. Same pictures and labels, same
 * machine: the same bytes.
 */
export async function composeSheet(pictures: readonly SheetPicture[], opts: ComposeOptions): Promise<Buffer> {
  const browser = await launchChromium({ backend: 'canvas2d' });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    await page.setContent('<!doctype html><html><body></body></html>');
    const url = await page.evaluate(
      async ({ pictures, columns, scale, title, gap, line: baseLine }) => {
        let line = baseLine;
        const images = await Promise.all(
          pictures.map(async (p) => {
            const img = new Image();
            img.src = p.src;
            await img.decode();
            return img;
          }),
        );
        const lines = Math.max(1, ...pictures.map((p) => p.lines.length));
        // Labels grow with the pictures (1.5 times from scale 2), so they stay readable beside them.
        const k = scale > 1 ? 1.5 : 1;
        line = Math.round(line * k);
        const cellW = Math.max(...images.map((i) => i.width)) * scale;
        const cellH = Math.max(...images.map((i) => i.height)) * scale + lines * line + 4;
        const rows = Math.ceil(images.length / columns);
        const head = title === undefined ? 0 : line + 2 * gap;
        const canvas = document.createElement('canvas');
        canvas.width = gap + Math.min(columns, images.length) * (cellW + gap);
        canvas.height = head + gap + rows * (cellH + gap);
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = '#1c1c24';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.textBaseline = 'top';
        if (title !== undefined) {
          ctx.fillStyle = '#f8b800';
          ctx.font = `bold ${Math.round(13 * k)}px monospace`;
          ctx.fillText(title, gap, gap);
        }
        images.forEach((img, i) => {
          const x = gap + (i % columns) * (cellW + gap);
          const y = head + gap + Math.floor(i / columns) * (cellH + gap);
          pictures[i]!.lines.forEach((text, n) => {
            ctx.fillStyle = n === 0 ? '#fcfcfc' : '#a4a4a4';
            ctx.font =
              n === 0 ? `bold ${Math.round(12 * k)}px monospace` : `${Math.round(11 * k)}px monospace`;
            ctx.fillText(text, x, y + n * line, cellW);
          });
          ctx.drawImage(img, x, y + lines * line + 4, img.width * scale, img.height * scale);
        });
        return canvas.toDataURL('image/png');
      },
      {
        pictures: pictures.map((p) => ({
          src: `data:image/png;base64,${p.png.toString('base64')}`,
          lines: p.lines,
        })),
        columns: opts.columns,
        scale: opts.scale,
        title: opts.title,
        gap: SHEET_GAP,
        line: SHEET_LINE,
      },
    );
    return pngBytes(url);
  } finally {
    await browser.close();
  }
}
