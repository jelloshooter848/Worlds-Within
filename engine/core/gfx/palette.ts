/** A palette maps a pixel-art index (char '0'-'9', 'a'-'z') to a CSS colour. */
export type Palette = readonly string[];

export type PaletteMode = 'default' | 'deuteranopia' | 'protanopia' | 'tritanopia' | 'highContrast';
export const PALETTE_MODES: PaletteMode[] = [
  'default',
  'deuteranopia',
  'protanopia',
  'tritanopia',
  'highContrast',
];

/** Named palettes for one mode; alternative modes only list the palettes they change. */
export type PaletteTable = Record<string, Palette>;

/** A whole-palette recolour (every colour of a palette mapped at once). */
export type PaletteFx = (palette: Palette) => Palette;

export interface PaletteBook {
  default: PaletteTable;
  /**
   * Recolours asked for by name as `<palette>~<fx>` ('luigi~silhouette'): the named palette
   * (for the active mode) run through the effect, so every palette gets them for free.
   */
  fx?: Record<string, PaletteFx>;
  deuteranopia?: Partial<PaletteTable>;
  protanopia?: Partial<PaletteTable>;
  tritanopia?: Partial<PaletteTable>;
  highContrast?: Partial<PaletteTable>;
}

export function resolvePalette(book: PaletteBook, name: string, mode: PaletteMode): Palette {
  const tilde = name.lastIndexOf('~');
  if (tilde > 0) {
    const fx = book.fx?.[name.slice(tilde + 1)];
    if (!fx) throw new Error(`unknown palette effect in "${name}"`);
    return fx(resolvePalette(book, name.slice(0, tilde), mode));
  }
  const alt = mode === 'default' ? undefined : book[mode]?.[name];
  const p = alt ?? book.default[name];
  if (!p) throw new Error(`unknown palette "${name}"`);
  return p;
}

/** Pixel-art char → palette index, or -1 for transparent. */
export function charIndex(ch: string): number {
  const c = ch.charCodeAt(0);
  if (c >= 48 && c <= 57) return c - 48; // 0-9
  if (c >= 97 && c <= 122) return c - 97 + 10; // a-z
  return -1; // '.' or anything else = transparent
}

/** Parse "#rgb" / "#rrggbb" into [r, g, b]. */
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * A curated subset of the NES master palette (the common "2C02" approximations). Art in
 * src/content uses these names so the whole game stays within an NES-like range.
 */
export const NES = {
  black: '#000000',
  white: '#fcfcfc',
  gray: '#7c7c7c',
  lightGray: '#bcbcbc',
  darkGray: '#404040',
  sky: '#5c94fc',
  skyLight: '#a4e4fc',
  blue: '#0000fc',
  blueDark: '#0000bc',
  blueMid: '#2038ec',
  blueLight: '#3cbcfc',
  blueUnderground: '#4040c0',
  cyan: '#00e8d8',
  green: '#00a800',
  greenLight: '#b8f818',
  greenDark: '#005800',
  greenMid: '#00b800',
  greenPipe: '#80d010',
  red: '#e40058',
  redBright: '#f83800',
  redDark: '#a81000',
  orange: '#e45c10',
  orangeBrown: '#c84c0c',
  brown: '#ac7c00',
  brownDark: '#503000',
  brownLight: '#e4a044',
  tan: '#fcd8a8',
  tanDark: '#f8b878',
  peach: '#fca044',
  yellow: '#f8b800',
  yellowLight: '#f8d878',
  pink: '#f878f8',
  purple: '#9878f8',
  magenta: '#d800cc',
  lavender: '#b8b8f8',
  teal: '#008888',
  olive: '#6c6c00',
  skin: '#fca044',
  mushroomRed: '#e45c10',
  lava: '#f83800',
  lavaLight: '#fca044',
} as const;
