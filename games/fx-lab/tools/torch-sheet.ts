import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodePng } from '@engine/core/content/png';

/**
 * Makes the fx lab's PNG sprite sheet (Engine 0.16 T10): `assets/fx-lab-png/torch.png`, an
 * original torch (own work, CC0; `assets/CREDITS.md`) drawn here from code, so the lab shows a
 * skin's PNG sheet without downloading anything. Run it with
 *
 *     pnpm exec tsx games/fx-lab/tools/torch-sheet.ts
 *
 * The sheet is 72 x 52: a grid of four 16 x 24 flame frames (`torch-0..3`, margin 1, spacing 2)
 * on the top row, and the unlit torch (`torch-unlit`, a named frame at 1, 27) below. The brazier
 * is the text sprite `torch`'s, from row 15 of a frame down; the flame above it sways and flickers
 * by integer tables (no floating maths), and `encodePng` writes stored deflate blocks, so the bytes
 * are the same on every machine: `fx-lab.test.ts` checks the committed file against this script.
 */

/** Where the sheet goes, relative to the game folder (what the skin's `images` entry names). */
export const TORCH_SHEET = 'assets/fx-lab-png/torch.png';

/** The colours used, from the lab's palette (`content/palettes/fx.json`). */
const COLOURS: Readonly<Record<string, string>> = {
  k: '#000000',
  L: '#7c7c7c',
  l: '#bcbcbc',
  b: '#503000',
  o: '#ac7c00',
  R: '#d82800',
  r: '#f87858',
  y: '#f8b800',
  Y: '#fce0a8',
};

/** The brazier and pole, the bottom nine rows of every frame (the text sprite `torch`'s). */
const BRAZIER = [
  '....kkkkkkkk....',
  '....kLllllLk....',
  '.....kLLLLk.....',
  '......kbbk......',
  '......kobk......',
  '......kbbk......',
  '......kobk......',
  '.....kbbbbk.....',
  '....kkkkkkkk....',
];

/** The flame's half-width per row, from its tip down to the brazier's rim (15 rows). */
const FLAME_WIDTH = [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3, 3, 3, 2];
/** Per frame: rows of the tip cut off (a shorter flame), and the sideways sway of the top rows. */
const FLICKER = [
  { cut: 0, sway: [1, 1, 1, 0, 0, 0] },
  { cut: 2, sway: [0, 0, 0, 0, 0, 0] },
  { cut: 1, sway: [-1, -1, -1, 0, 0, 0] },
  { cut: 3, sway: [0, 1, 0, 0, 0, 0] },
];

const FRAME = { w: 16, h: 24 };
const MARGIN = 1;
const SPACING = 2;
export const SHEET_SIZE = { width: 72, height: 52 };

/** One frame as rows of colour keys ('.' clear); `lit` false draws no flame. */
export function torchFrameRows(index: number, lit = true): string[] {
  const rows = Array.from({ length: FRAME.h }, () => [...'.'.repeat(FRAME.w)]);
  BRAZIER.forEach((row, i) => (rows[FRAME.h - BRAZIER.length + i] = [...row]));
  if (!lit) return rows.map((r) => r.join(''));
  const { cut, sway } = FLICKER[index % FLICKER.length]!;
  FLAME_WIDTH.forEach((half, r) => {
    if (r < cut) return;
    const y = r;
    const centre = 7 + (sway[r] ?? 0);
    for (let x = centre - half; x <= centre + 1 + half; x++) {
      const edge = Math.min(x - (centre - half), centre + 1 + half - x);
      // Outside in: a red rim, orange, gold and a pale core in the widest rows.
      const key = edge === 0 ? 'R' : edge === 1 ? 'r' : edge === 2 || r < 9 ? 'y' : 'Y';
      rows[y]![x] = key;
    }
  });
  return rows.map((r) => r.join(''));
}

/** The whole sheet as RGBA pixels. */
export function torchSheetPixels(): Uint8Array {
  const { width, height } = SHEET_SIZE;
  const rgba = new Uint8Array(width * height * 4);
  const paint = (rows: string[], left: number, top: number) => {
    rows.forEach((row, y) =>
      [...row].forEach((key, x) => {
        const hex = COLOURS[key];
        if (hex === undefined) return;
        const at = ((top + y) * width + left + x) * 4;
        rgba[at] = parseInt(hex.slice(1, 3), 16);
        rgba[at + 1] = parseInt(hex.slice(3, 5), 16);
        rgba[at + 2] = parseInt(hex.slice(5, 7), 16);
        rgba[at + 3] = 255;
      }),
    );
  };
  for (let i = 0; i < FLICKER.length; i++) paint(torchFrameRows(i), MARGIN + i * (FRAME.w + SPACING), MARGIN);
  paint(torchFrameRows(0, false), MARGIN, MARGIN + FRAME.h + SPACING);
  return rgba;
}

/** The sheet's PNG bytes. */
export function torchSheetPng(): Uint8Array {
  return encodePng(SHEET_SIZE.width, SHEET_SIZE.height, torchSheetPixels());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = fileURLToPath(new URL(`../${TORCH_SHEET}`, import.meta.url));
  writeFileSync(out, torchSheetPng());
  console.log(`wrote ${out}`);
}
