import type { ContentBundle } from '../content/bundle';
import { buildFont, FONT_KIND, type Font, type FontFile, type FontLookup } from './font';

/**
 * A game's `font` content files as a {@link FontLookup}, by file name (`content/fonts/small.txt`
 * is `small`), each built once when first asked for. Pure: the glue hands it to a presenter
 * (`fonts`) next to its sprite sheets.
 */
export function contentFonts(content: ContentBundle): FontLookup {
  const files = new Map(
    content.entries.filter((e) => e.kind === FONT_KIND.name).map((e) => [e.name, e.value as FontFile]),
  );
  const built = new Map<string, Font>();
  return (id) => {
    const cached = built.get(id);
    if (cached !== undefined) return cached;
    const file = files.get(id);
    if (file === undefined) return null;
    const font = buildFont(id, file);
    built.set(id, font);
    return font;
  };
}
