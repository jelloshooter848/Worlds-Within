import { ModelLibrary, ThreePresenter } from '@engine/backends/three';
import { contentDecor, freezeFrame } from '@engine/core/present';
import { contentFonts } from '@engine/core/ui';
import gameFiles from 'virtual:game-files';
import { mustLoadFxLab } from '../content';
import { groundCamera, groundFrame, groundSkin } from '../ground';

/**
 * The ground-view example page (Engine 0.16 F2; not one of `pnpm build`'s pages: the browser
 * test `tests/browser/fx-lab-ground.test.ts` builds it alone): the lab's meadow (`../ground.ts`) in the `ground` skin through the
 * WebGL `ThreePresenter`, frame by frame at 60 a second. `?frame=<n>` holds frame `n` (every
 * frame before it is synced first, so particles and turns are where play has them); `?scale=<n>`
 * draws at n x the picture size (`renderScale`, Engine 0.16 F3); a drag pans
 * and the wheel zooms the `RtsCamera` the frames are framed by. `window.wwGround.shown` is the
 * last frame drawn (for `tests/browser/fx-lab-ground.test.ts`).
 */
const content = mustLoadFxLab(gameFiles);
const skin = groundSkin(content);
const screen = content.manifest.screen;
const models = new ModelLibrary(content.assets);
await models.preload([skin]);
const canvas = document.getElementById('screen') as HTMLCanvasElement;
canvas.width = screen.width;
canvas.height = screen.height;
const renderScale = Number(new URLSearchParams(location.search).get('scale') ?? '1');
const presenter = new ThreePresenter(canvas, skin, {
  size: screen,
  fonts: contentFonts(content),
  models,
  decor: contentDecor(content),
  renderScale,
});
const camera = groundCamera(skin, screen);
const hold = Number(new URLSearchParams(location.search).get('frame') ?? 'NaN');
const state = { shown: -1 };
(window as unknown as { wwGround: typeof state }).wwGround = state;

const toPicture = (e: PointerEvent | WheelEvent) => {
  const r = canvas.getBoundingClientRect();
  const scale = Math.min(r.width / screen.width, r.height / screen.height);
  return {
    x: (e.clientX - r.left - (r.width - screen.width * scale) / 2) / scale,
    y: (e.clientY - r.top - (r.height - screen.height * scale) / 2) / scale,
  };
};
let drag: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => (drag = toPicture(e)));
canvas.addEventListener('pointerup', () => (drag = null));
canvas.addEventListener('pointermove', (e) => {
  if (drag === null) return;
  const at = toPicture(e);
  camera.panBy(at.x - drag.x, at.y - drag.y);
  drag = at;
});
canvas.addEventListener('wheel', (e) => camera.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, toPicture(e)));

let n = 0;
if (Number.isFinite(hold)) {
  for (; n < hold; n++) presenter.scene.sync(freezeFrame(groundFrame(n, camera, screen)));
}
const step = () => {
  presenter.present(freezeFrame(groundFrame(n, camera, screen)));
  state.shown = n;
  if (!Number.isFinite(hold)) n++;
  requestAnimationFrame(step);
};
step();
