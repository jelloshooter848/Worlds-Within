import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { SceneStack } from '@engine/core/scene';
import { HostScene, type HostDrawer } from '@engine/core/shell/host-scene';
import type { PlatformerEvent, PlatformerWorld } from '@kits/platformer';
import { createGame } from './headless';

/**
 * The game in the browser: the headless game (`createGame`, every level in turn) in the engine's
 * `HostScene`, which pushes the core `miniGameScene` when the door starts the vault round (the
 * level sequence still steps it, so the round's result acts on the level as headless) and draws
 * through the drawer `picture(r)` makes (`main.ts`: a `testPicture`).
 */
export function testScene(
  content: ContentBundle,
  stack: SceneStack,
  picture: (r: Renderer) => HostDrawer<PlatformerWorld, PlatformerEvent>,
): HostScene<PlatformerWorld, PlatformerEvent> {
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
