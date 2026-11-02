import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { SceneStack } from '@engine/core/scene';
import { HostScene, type HostDrawer } from '@engine/core/shell/host-scene';
import type { PlatformerEvent, PlatformerWorld } from '@kits/platformer';
import { createGame } from './headless';

/** The lab's scene: the engine's `HostScene` over the lab's level sequence. */
export type LabScene = HostScene<PlatformerWorld, PlatformerEvent>;

/**
 * The lab in the browser: the headless game (`createGame`, every level in turn) in the engine's
 * `HostScene`, which pushes the core `miniGameScene` when a trigger starts a round and draws
 * through the drawer `picture(r)` makes (`main.ts`: a `labPicture` onto the display's presenter).
 * Arrows (or the touch pad) move, Z jumps, X runs; in the mini game X (attack) stops the bar.
 */
export function labScene(
  content: ContentBundle,
  stack: SceneStack,
  picture: (r: Renderer) => HostDrawer<PlatformerWorld, PlatformerEvent>,
): LabScene {
  const game = createGame(content, content.manifest.start.seed);
  return new HostScene({
    stack,
    step: (input) => game.step(input),
    world: () => game.world,
    events: () => game.events,
    miniGame: () => game.world.miniGame?.game ?? null,
    picture,
  });
}
