/** Colours as `#rgb` or `#rrggbb` text, the form skins use. Pure. */

/** A colour's red, green and blue (0-255 each), or null when `text` is not `#rgb` or `#rrggbb`. */
export function parseHexColor(text: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(text);
  if (!m) return null;
  let hex = m[1]!;
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * The colour `t` of the way from `a` to `b` (0 gives `a`, 1 gives `b`), as `#rrggbb` in lower
 * case: each channel rounded and clamped to 0-255, so an overshooting ease (`backOut`) stays a
 * colour. Throws on text that is not a colour (skins are checked before they get here).
 */
export function lerpColor(a: string, b: string, t: number): string {
  const from = rgbOf(a);
  const to = rgbOf(b);
  if (!from || !to) throw new Error(`lerpColor: not a colour: ${from ? b : a}`);
  return `#${channel(from[0], to[0], t)}${channel(from[1], to[1], t)}${channel(from[2], to[2], t)}`;
}

/** Two lower-case hex digits per byte. */
const HEX: readonly string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

function channel(a: number, b: number, t: number): string {
  return HEX[Math.min(255, Math.max(0, Math.round(a + (b - a) * t)))]!;
}

/** Parsed colours by their text: `lerpColor` runs per particle per frame on a skin's few colours. */
const parsed = new Map<string, readonly [number, number, number] | null>();
const PARSED_MAX = 1024;

function rgbOf(text: string): readonly [number, number, number] | null {
  let rgb = parsed.get(text);
  if (rgb === undefined) {
    rgb = parseHexColor(text);
    if (parsed.size < PARSED_MAX) parsed.set(text, rgb);
  }
  return rgb;
}
