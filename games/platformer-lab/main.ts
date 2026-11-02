import { GamepadSource } from '@engine/core/input/gamepad';
import { InputManager } from '@engine/core/input/input-manager';
import { KeyboardSource } from '@engine/core/input/keyboard';
import { TouchSource } from '@engine/core/input/touch';
import { layoutScreen } from '@engine/core/input/touch-layout';
import { FixedLoop } from '@engine/core/loop';
import { SceneStack } from '@engine/core/scene';
import { CanvasRenderer, Viewport } from '@engine/backends/canvas2d';
import { loadLab, mustLoad } from './content';
import { LAB_FILES } from './files';
import { labLook } from './picture';
import { LabScene } from './scene';

/**
 * Boots the lab in the browser: the Canvas2D backend, keyboard, gamepad and the touch pad (shown
 * on touch devices, laid out clear of the picture), and the lab scene on a `SceneStack` (which
 * pushes the mini game's scene over the level when a trigger starts a round). No audio: the lab
 * has no sounds yet.
 */
function boot(): void {
  const canvas = document.getElementById('screen') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('#screen canvas missing');

  const content = mustLoad(loadLab(LAB_FILES));
  const look = labLook(content);
  const screen = content.manifest.screen;

  const viewport = new Viewport(canvas, { integerScale: false }, screen);
  const renderer = new CanvasRenderer(viewport.ctx);
  const input = new InputManager(1);
  input.addSource('keyboard', new KeyboardSource());
  if (GamepadSource.available()) input.addSource('gamepad', new GamepadSource());
  const touch = new TouchSource(document.body);
  input.addSource('touch', touch);
  touch.show(TouchSource.likelyTouchDevice());

  // The picture and the touch controls never overlap (engine/core/input/touch-layout.ts).
  const relayout = () => {
    const layout = layoutScreen({
      width: window.innerWidth,
      height: window.innerHeight,
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
      dpr: window.devicePixelRatio || 1,
      integerScale: false,
      touch: touch.shown,
      touchScale: 1,
      screen,
    });
    viewport.fit = layout.fit;
    viewport.resize();
    touch.applyLayout(layout);
  };
  relayout();
  window.addEventListener('resize', relayout);

  const scenes = new SceneStack();
  scenes.push(new LabScene(content, look, scenes));

  new FixedLoop({
    step() {
      input.beginFrame();
      scenes.update([input.player(0)]);
    },
    render() {
      scenes.render(renderer);
      viewport.present();
    },
  }).start();
}

boot();
