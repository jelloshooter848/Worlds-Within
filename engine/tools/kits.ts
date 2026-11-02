import type { ContentKind } from '@engine/core/content/kinds';
import { roomKind } from '@kits/topdown';

/**
 * The content kinds each kit adds to the engine's own, by the kit name a `game.json` gives in
 * `kit`. The tools read a game's content with the engine's kinds plus these. Add a line here when
 * a kit gets content kinds of its own.
 */
export const KIT_KINDS: Readonly<Record<string, () => readonly ContentKind[]>> = {
  topdown: () => [roomKind() as unknown as ContentKind],
};
