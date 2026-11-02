import type { ContentBundle } from '@engine/core/content/bundle';
import { GamepadSource } from '@engine/core/input/gamepad';
import { InputManager } from '@engine/core/input/input-manager';
import { KeyboardSource } from '@engine/core/input/keyboard';
import { TouchSource } from '@engine/core/input/touch';
import { layoutScreen } from '@engine/core/input/touch-layout';
import { FixedLoop } from '@engine/core/loop';
import { SceneStack } from '@engine/core/scene';
import { CanvasRenderer, Viewport } from '@engine/backends/canvas2d';
import { labBackend, otherBackendLink, type LabBackend, type LabDisplay } from './backend';
import { loadLab, mustLoad } from './content';
import { LAB_FILES } from './files';
import { LabPicture, labLook } from './picture';
import { LabScene } from './scene';

/**
 * Boots the lab in the browser: keyboard, gamepad and the touch pad (shown on touch devices, laid
 * out clear of the picture), and the lab scene on a `SceneStack` (which pushes the mini game's
 * scene over the level when a trigger starts a round), stepped by a `FixedLoop`. The picture is
 * Canvas2D by default; `?backend=three` shows the same frames through the Three.js backend
 * (`main3d.ts`, imported only then, so the 2D page loads no Three.js). No audio: the lab has no
 * sounds yet.
 */
async function boot(): Promise<void> {
  const canvas = document.getElementById('screen') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('#screen canvas missing');

  const backend = labBackend(window.location.search);
  showToggle(backend);
  const content = mustLoad(loadLab(LAB_FILES));
  const display = backend === 'three' ? await threeDisplay(canvas, content) : canvasDisplay(canvas, content);
  if (typeof display === 'string') {
    showMessage(canvas, display);
    return;
  }
  const screen = content.manifest.screen;

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
    display.fit(layout);
    touch.applyLayout(layout);
  };
  relayout();
  window.addEventListener('resize', relayout);

  const scenes = new SceneStack();
  scenes.push(new LabScene(content, display.picture, scenes));

  new FixedLoop({
    step() {
      input.beginFrame();
      scenes.update([input.player(0)]);
    },
    render() {
      scenes.render(display.renderer);
      display.present();
    },
  }).start();
  document.body.dataset.backend = backend;
}

/** The Canvas2D display: a `Viewport` and `CanvasRenderer`, drawn through `LabPicture`. */
function canvasDisplay(canvas: HTMLCanvasElement, content: ContentBundle): LabDisplay {
  const look = labLook(content);
  const viewport = new Viewport(canvas, { integerScale: false }, content.manifest.screen);
  return {
    renderer: new CanvasRenderer(viewport.ctx),
    picture: (r) => new LabPicture(r, look),
    fit(layout) {
      viewport.fit = layout.fit;
      viewport.resize();
    },
    present: () => viewport.present(),
  };
}

/** The Three.js display (`main3d.ts`, its own chunk with Three.js in it), or why it cannot start. */
async function threeDisplay(canvas: HTMLCanvasElement, content: ContentBundle): Promise<LabDisplay | string> {
  const { threeDisplay: make } = await import('./main3d');
  return make(canvas, content);
}

/** The link to the other backend, top left (`#backend` in index.html). */
function showToggle(backend: LabBackend): void {
  const link = document.getElementById('backend') as HTMLAnchorElement | null;
  if (!link) return;
  const other = otherBackendLink(backend);
  link.textContent = other.label;
  link.href = other.href;
  link.title = other.title;
}

/** Shows why the picture cannot start (no WebGL), with a way back to 2D, instead of a blank page. */
function showMessage(canvas: HTMLCanvasElement, text: string): void {
  canvas.hidden = true;
  const box = document.createElement('div');
  box.id = 'message';
  box.setAttribute('role', 'alert');
  const line = document.createElement('p');
  line.textContent = text;
  const back = document.createElement('a');
  back.href = otherBackendLink('three').href;
  back.textContent = 'Play in 2D instead';
  box.append(line, back);
  document.body.append(box);
  document.body.dataset.backend = 'none';
}

void boot();
