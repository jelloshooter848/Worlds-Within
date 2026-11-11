import { ModelLibrary, threeScenePresenter } from '@engine/backends/three';
import { CanvasRenderer, skinSetCanvasPresenter } from '@engine/backends/canvas2d';
import { contentPixelSheets, contentSheets } from '@engine/core/assets/content-sheets';
import type { ContentBundle } from '@engine/core/content/bundle';
import type { ScreenSize } from '@engine/core/gfx/screen';
import { contentDecor, skinSet, type Presenter, type SoundCue } from '@engine/core/present';
import { roundLayerDisplay, type BrowserDisplay } from '@engine/core/shell';
import { contentFonts } from '@engine/core/ui';

// Shared by the run tests that present a game in 3D (presentation invariance and the stepped
// shell's, Engine 0.16 F9): the Three.js presenter as the game's 3D page builds it, so the
// invariance covers what a player sees. The scene gets the game's glTF models (loaded before the
// first frame, as the page preloads them), its decor grids, sheets and fonts; the rounds the 3D
// skin draws in 2D (`rounds2d`, Engine 0.16 F8: the mini siege's rooms and walls) go through the
// shell's own `roundLayerDisplay` to the game's Canvas2D skins on `ctx`, as the page's round layer
// does. No WebGL: the scene is synced, not drawn.

/** The page's 3D presenter for a game's content, and what it showed. */
export interface PageThree {
  /** Every frame goes here. */
  presenter: Presenter;
  /** The Three.js scene presenter (its `scene` and `rounds`, for counting what showed). */
  three: ReturnType<typeof threeScenePresenter>;
  /** How many frames the 2D round layer drew. */
  layered(): number;
  dispose(): void;
}

/** The 3D page's presenter for `content` (whose `three` skin must exist), its rounds in 2D on `ctx`. */
export async function pageThree(
  content: ContentBundle,
  opts: {
    screen: ScreenSize;
    /** The 2D context the `rounds2d` rounds draw on (a stub in Node). */
    ctx: CanvasRenderingContext2D;
    background?: string;
    onSound?: (id: string, cue?: SoundCue) => void;
  },
): Promise<PageThree> {
  const skins = skinSet(content, 'three');
  if (skins.main === null) throw new Error('the game has no three skin');
  const models = new ModelLibrary(content.assets ?? {});
  await models.preload([skins.main, ...Object.values(skins.rounds)]);
  const ids = skins.main.rounds2d ?? [];
  const rounds = Object.fromEntries(Object.entries(skins.rounds).filter(([id]) => !ids.includes(id)));
  const three = threeScenePresenter(skins.main, {
    screen: opts.screen,
    rounds,
    sheets: contentPixelSheets(content),
    fonts: contentFonts(content),
    models,
    decor: contentDecor(content),
    ...(opts.background !== undefined && { background: opts.background }),
    ...(opts.onSound !== undefined && { onSound: opts.onSound }),
  });
  const renderer = new CanvasRenderer(opts.ctx);
  const dispose = () => {
    three.scene.dispose();
    for (const scene of Object.values(three.rounds)) scene.dispose();
    models.dispose();
  };
  if (ids.length === 0) return { presenter: three, three, layered: () => 0, dispose };
  const flat = skinSet(content, 'canvas2d');
  if (flat.main === null) throw new Error('the 3D skin lists rounds2d, but the game has no canvas2d skin');
  let layered = 0;
  const flatPresenter = skinSetCanvasPresenter(renderer, {
    skin: flat.main,
    rounds: flat.rounds,
    sheet: contentSheets(content),
    fonts: contentFonts(content),
    screen: opts.screen,
    ...(opts.onSound !== undefined && { onSound: opts.onSound }),
  });
  const display = (presenter: Presenter): BrowserDisplay => ({ renderer, presenter, fit() {}, present() {} });
  const layer = roundLayerDisplay({
    world: display(three),
    round: display({
      present: (frame) => {
        layered++;
        flatPresenter.present(frame);
      },
    }),
    ids,
    show() {},
  });
  return { presenter: layer.presenter, three, layered: () => layered, dispose };
}
