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
  const from = parseHexColor(a);
  const to = parseHexColor(b);
  if (!from || !to) throw new Error(`lerpColor: not a colour: ${from ? b : a}`);
  return `#${from
    .map((c, i) => {
      const v = Math.min(255, Math.max(0, Math.round(c + (to[i]! - c) * t)));
      return v.toString(16).padStart(2, '0');
    })
    .join('')}`;
}
