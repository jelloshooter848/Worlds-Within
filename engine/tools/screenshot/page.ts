import {
  CanvasRenderer,
  CanvasUiPainter,
  drawTransition,
  skinSetCanvasPresenter,
} from '@engine/backends/canvas2d';
import { contentPixelSheets, contentSheets } from '@engine/core/assets/content-sheets';
import type { SheetLookup } from '@engine/core/assets/sheet-lookup';
import { transitionShape } from '@engine/core/fx';
import { withContentImages } from '@engine/core/assets/content-images';
import { contentFonts, paintUi, type FontLookup, type StatValues, type UiFrameSize } from '@engine/core/ui';
import type { ContentBundle } from '@engine/core/content/bundle';
import { canonicalJson, type JsonObject } from '@engine/core/headless';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import {
  contentDecor,
  MINI_GAME_STATUS,
  presenterBySkinSet,
  skinSet,
  type DeepReadonly,
  type PresentFrame,
  type Presenter,
} from '@engine/core/present';
import type { ViewEntry, ViewGame } from '@engine/core/view';
import type { PixiRenderer } from '@engine/backends/pixi';
import { checkGameTexts } from '../game-check';
import { overlayTransition, overlayUi } from '../sheet-overlay';
import type { ShotJob, ShotRefusal, ShotResult, ShotTile } from './job';

/**
 * The screenshot page (browser only, tools only). `pnpm cli screenshot` opens it in headless
 * Chromium and calls `window.wwShoot(job)`: the page checks the game's files, imports the game's
 * view module by its URL, and steps it exactly `job.ticks` times with the run's scripted input (no
 * real-time loop, no audio), drawing every tick (tick 0 included) with the canvas2d backend onto
 * a canvas of the game's picture size (`job.screen`, from `game.json`), as a player's screen
 * would. It returns the last picture as a PNG data URL, the snapshot at that tick, and the state
 * hashes it saw on the way (tick 0, every `job.hashEvery` ticks and the last), so the CLI can
 * check that drawing every tick changed nothing. The skins' PNG sheets (Engine 0.16 T10) are
 * decoded first (`withContentImages`), so the picture waits for them.
 *
 * With `job.backend` `three` the page shows the view's `frame()` through a `ThreePresenter` and
 * the game's `three` skins (`skinSet`: `three.json`, and `three-<id>.json` for the frames of mini
 * game `<id>`, Engine 0.7 T8) on a WebGL canvas of the same size instead: it reads the WebGL renderer
 * string first and refuses (a {@link ShotRefusal}) when there is no context, or when it is a
 * software renderer and `job.allowSoftwareGl` is false; it syncs the scene with every tick's
 * frame (so the camera's lerp is the one play shows) and renders once, at the last tick. The
 * skins' glTF models (Engine 0.16 T11) are loaded first (`ModelLibrary.preload`).
 *
 * With `job.backend` `pixi` (Engine 0.16 T13b-5) the page shows the view's `frame()` through
 * `pixiDisplay` (`@engine/backends/pixi`, imported only then) and the game's `canvas2d` skins on a
 * WebGL canvas of the picture's size, presenting every tick as the shell does. The drawing buffer
 * is kept (`preserveDrawingBuffer`), so the canvas reads back after any picture. Software WebGL
 * (SwiftShader here) is not refused: the result names the renderer string instead.
 */

/** The state hash as `run` computes it: the first 16 hex digits of the SHA-256 of the JSON. */
async function stateHash(json: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

async function shoot(job: ShotJob): Promise<ShotResult | ShotRefusal> {
  const checked = checkGameTexts(job.files, job.root);
  if (!checked.ok) throw new Error(`the game's content has errors: ${JSON.stringify(checked.errors)}`);
  // The skins' PNG sheets are decoded before the view is made, so every frame drawn has them.
  const content = { ok: true as const, value: await withContentImages(checked.value) };
  const entry = (await import(/* @vite-ignore */ job.viewUrl)) as Partial<ViewEntry>;
  if (typeof entry.createView !== 'function')
    throw new Error(`${job.viewUrl} does not export createView(content, seed) (engine/core/view.ts)`);
  const game = entry.createView(content.value, job.seed, {
    disabledRules: job.disabledRules,
    disabledRulesByKit: job.disabledRulesByKit,
    ...(job.campaign === null ? {} : { campaign: job.campaign }),
    ...(job.start === null ? {} : { start: job.start }),
  });
  const { width, height } = job.screen;
  if (game.screen?.width !== width || game.screen.height !== height)
    throw new Error(
      `${job.viewUrl} draws a ${String(game.screen?.width)}x${String(game.screen?.height)} picture, but game.json says ${width}x${height}`,
    );
  if (job.backend === 'three') return shootThree(job, game, content.value);
  if (job.backend === 'pixi') return shootPixi(job, game, content.value);
  return shootCanvas(job, game, content.value);
}

/**
 * `pnpm cli sheet` (Engine 0.16 T14): the indexes of the job's tiles taken at `tick`, in order.
 * Each tile's picture is the tick's frame with its overlay (`../sheet-overlay.ts`) drawn over it:
 * in 2D on a copy of the canvas (the UI through `CanvasUiPainter`, a transition with
 * `drawTransition`, its iris on the picture's centre: the view's camera is not reachable here), in
 * 3D through the presenter's own overlay and transition passes.
 */
function tilesAt(job: ShotJob, tick: number): number[] {
  const out: number[] = [];
  (job.tiles ?? []).forEach((t, i) => {
    if (t.tick === tick) out.push(i);
  });
  return out;
}

/** A `UiFrameSize` from a sheet lookup (a panel's frame, a portrait), as the shell's boot makes it. */
function frameSizeOf(sheets: SheetLookup): UiFrameSize {
  return (sheet, palette, frame) => {
    const rect = sheets(sheet, palette)?.frames.get(frame);
    return rect === undefined ? null : { w: rect.w, h: rect.h };
  };
}

/** What a tile's overlay needs: the content, its 2D sheets (frame sizes, the 2D painter) and fonts. */
interface OverlayContext {
  content: ContentBundle;
  sheets: SheetLookup;
  fonts: FontLookup;
}

function overlayContext(content: ContentBundle): OverlayContext {
  return { content, sheets: contentSheets(content), fonts: contentFonts(content) };
}

/**
 * A canvas as a PNG data URL at the job's whole-number `scale` (Engine 0.16 part B, `screenshot
 * --scale`): copied onto a canvas `scale` times as large with image smoothing off, so every pixel
 * becomes an exact `scale` x `scale` block.
 */
function pngOf(job: ShotJob, canvas: HTMLCanvasElement): string {
  const scale = job.scale ?? 1;
  if (scale <= 1) return canvas.toDataURL('image/png');
  const big = document.createElement('canvas');
  big.width = canvas.width * scale;
  big.height = canvas.height * scale;
  const ctx = big.getContext('2d');
  if (!ctx) throw new Error('2D canvas not supported');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, 0, 0, big.width, big.height);
  return big.toDataURL('image/png');
}

/** A 2D tile: a copy of `canvas` with the tile's overlay drawn over it, as a PNG data URL. */
function canvasTile(
  job: ShotJob,
  canvas: HTMLCanvasElement,
  tile: ShotTile,
  o: OverlayContext,
  status: ReturnType<NonNullable<ViewGame['status']>> | null,
): string {
  const copy = newCanvas(job);
  const ctx = copy.getContext('2d');
  if (!ctx) throw new Error('2D canvas not supported');
  ctx.drawImage(canvas, 0, 0);
  if (tile.overlay !== null) {
    const draws = overlayUi(o.content, tile.overlay, {
      fonts: o.fonts,
      frameSize: frameSizeOf(o.sheets),
      status: status as StatValues | null,
    });
    if (draws.length > 0) paintUi(draws, new CanvasUiPainter(new CanvasRenderer(ctx), o.sheets, o.fonts));
    const view = overlayTransition(o.content, tile.overlay);
    const shape = view && transitionShape(view, job.screen, null);
    if (shape) drawTransition(ctx, shape, job.screen);
  }
  return pngOf(job, copy);
}

/** Plays the job's input, recorded orders and mission steps on `game`, calling `show(tick)` at every tick (tick 0 included). */
async function play(
  job: ShotJob,
  game: ViewGame,
  show: (tick: number) => void,
): Promise<Pick<ShotResult, 'snapshot' | 'hashes'>> {
  const input = new ScriptedInput(job.input);
  const hashes: ShotResult['hashes'] = [];
  let snapshot = '';
  let next = 0; // the next recorded order to hand over
  let nextMission = 0; // the next mission step to hand over
  for (let tick = 0; ; tick++) {
    if (tick > 0) {
      for (; next < job.orders.length && job.orders[next]!.tick === tick - 1; next++) {
        if (!game.order)
          throw new Error(`${job.viewUrl}: the run has orders, but the view has no order(order) method`);
        const { tick: _tick, ...order } = job.orders[next]!;
        game.order(order as JsonObject);
      }
      // Then that tick's mission steps, in file order (a refusal is the run's to report, not the page's).
      for (
        ;
        nextMission < job.missions.length && job.missions[nextMission]!.tick === tick - 1;
        nextMission++
      ) {
        if (!game.mission)
          throw new Error(`${job.viewUrl}: the run has missions, but the view has no mission(step) method`);
        const { tick: _tick, ...step } = job.missions[nextMission]!;
        game.mission(step as JsonObject);
      }
      input.next();
      game.step(input);
    }
    show(tick);
    if (tick % job.hashEvery === 0 || tick === job.ticks) {
      snapshot = canonicalJson(game.snapshot());
      hashes.push({ tick, hash: await stateHash(snapshot) });
    }
    if (tick === job.ticks) break;
  }
  return { snapshot, hashes };
}

function newCanvas(job: ShotJob): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = job.screen.width;
  canvas.height = job.screen.height;
  return canvas;
}

async function shootCanvas(job: ShotJob, game: ViewGame, content: ContentBundle): Promise<ShotResult> {
  const canvas = newCanvas(job);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas not supported');
  const renderer = new CanvasRenderer(ctx);
  const overlays = job.tiles === undefined ? null : overlayContext(content);
  const tiles: string[] = [];
  const played = await play(job, game, (tick) => {
    game.render(renderer);
    for (const i of tilesAt(job, tick))
      tiles[i] = canvasTile(job, canvas, job.tiles![i]!, overlays!, game.status?.() ?? null);
  });
  return {
    png: pngOf(job, canvas),
    width: canvas.width,
    height: canvas.height,
    ...played,
    renderer: null,
    tiles,
  };
}

async function shootThree(
  job: ShotJob,
  game: ViewGame,
  content: ContentBundle,
): Promise<ShotResult | ShotRefusal> {
  const frame = game.frame?.bind(game);
  if (frame === undefined)
    return {
      refused: 'no_frame_hook',
      renderer: null,
      message: `${job.viewUrl} gives no frame() (engine/core/view.ts), which --backend three needs`,
    };
  const skins = skinSet(content, 'three');
  if (!skins.main) throw new Error(`the game has no skin with backend "three"`);
  const { ModelLibrary, ThreePresenter, isSoftwareRenderer } = await import('@engine/backends/three');
  const canvas = newCanvas(job);
  // The sprite sheets as decoded pixels, for every skin's HUD (gap G33).
  const sheets = contentPixelSheets(content);
  // The font files, for HUD text and the UI kit's widgets (Engine 0.16 T6).
  const fonts = contentFonts(content);
  // The skins' glTF models (Engine 0.16 T11), loaded before the first frame so none shows its
  // text mesh stand-in.
  const models = new ModelLibrary(content.assets ?? {});
  await models.preload([skins.main, ...Object.values(skins.rounds)]);
  // The skins' decor grids (Engine 0.16 F3).
  const decor = contentDecor(content);
  let presenter: InstanceType<typeof ThreePresenter>;
  try {
    presenter = new ThreePresenter(canvas, skins.main, {
      size: job.screen,
      sheets,
      fonts,
      models,
      decor,
      ...(job.renderScale !== undefined && { renderScale: job.renderScale }),
      ...(game.background !== undefined && { background: game.background }),
    });
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return { refused: 'no_webgl', renderer: null, message: `no WebGL context: ${why}` };
  }
  const { renderer } = presenter.rendererInfo();
  if (isSoftwareRenderer(renderer) && !job.allowSoftwareGl) {
    presenter.dispose();
    return { refused: 'software_gl', renderer, message: `WebGL runs on a software renderer: ${renderer}` };
  }
  // Each mini game with a skin of its own gets a scene of its own on the same canvas; every tick
  // syncs the scene its frame belongs to, and the last tick also draws it.
  const draws: Record<string, Presenter> = {};
  const syncs: Record<string, Presenter> = {};
  // The rounds the 3D skin draws in 2D (`rounds2d`, Engine 0.16 F8), as the page's round layer
  // does: every one of their frames through the game's Canvas2D skins on a picture-sized canvas;
  // a shot whose last frame is one is that canvas scaled up to the 3D picture's size.
  const layer = roundLayer(job, content, skins.main.rounds2d ?? [], game.background);
  for (const [id, skin] of Object.entries(skins.rounds)) {
    if (layer?.ids.includes(id)) continue;
    const round = presenter.withSkin(skin, { sheets, fonts, models, decor });
    draws[id] = round;
    syncs[id] = { present: (f) => round.scene.sync(f) };
  }
  const main = presenter;
  const draw = presenterBySkinSet(main, draws);
  const sync = presenterBySkinSet({ present: (f) => main.scene.sync(f) }, syncs);
  const overlays = job.tiles === undefined ? null : overlayContext(content);
  const tiles: string[] = [];
  let lastInLayer = false;
  const played = await play(job, game, (tick) => {
    const here = tilesAt(job, tick);
    if (layer !== null) {
      const shown = frame();
      lastInLayer = layer.ids.includes(String(shown.status[MINI_GAME_STATUS] ?? ''));
      if (lastInLayer) {
        layer.present(shown);
        for (const i of here) tiles[i] = layer.png(canvas.width, canvas.height);
        return;
      }
      if (here.length === 0) {
        (tick === job.ticks ? draw : sync).present(shown);
        return;
      }
    } else if (here.length === 0) {
      (tick === job.ticks ? draw : sync).present(frame());
      return;
    }
    // A tick with tiles is drawn once per tile (the same frame), each with its overlay's passes.
    const shown = frame();
    for (const i of here) {
      const tile = job.tiles![i]!;
      const o = overlays!;
      presenter.transition(tile.overlay === null ? null : overlayTransition(o.content, tile.overlay));
      draw.present(shown);
      if (tile.overlay !== null)
        presenter.ui(
          overlayUi(o.content, tile.overlay, {
            fonts: o.fonts,
            frameSize: frameSizeOf(o.sheets),
            status: shown.status as StatValues,
          }),
        );
      tiles[i] = pngOf(job, canvas);
    }
    presenter.transition(null);
  });
  const png = lastInLayer && layer !== null ? layer.png(canvas.width, canvas.height) : pngOf(job, canvas);
  presenter.dispose();
  models.dispose();
  return { png, width: canvas.width, height: canvas.height, ...played, renderer, tiles };
}

/** The 3D shot's 2D round layer: its rounds, a frame presenter and its picture scaled to a size. */
interface ShotRoundLayer {
  ids: readonly string[];
  present(frame: DeepReadonly<PresentFrame>): void;
  png(width: number, height: number): string;
}

/** The round layer for a 3D skin's `rounds2d` (Engine 0.16 F8), or null when it lists none. */
function roundLayer(
  job: ShotJob,
  content: ContentBundle,
  ids: readonly string[],
  background: string | undefined,
): ShotRoundLayer | null {
  if (ids.length === 0) return null;
  const flat = skinSet(content, 'canvas2d');
  if (!flat.main) throw new Error('the 3D skin lists rounds2d, but the game has no canvas2d skin');
  const canvas = newCanvas(job);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas not supported');
  const presenter = skinSetCanvasPresenter(new CanvasRenderer(ctx), {
    skin: flat.main,
    rounds: flat.rounds,
    sheet: contentSheets(content),
    fonts: contentFonts(content),
    screen: job.screen,
    ...(background !== undefined && { background }),
  });
  return {
    ids,
    present: (frame) => presenter.present(frame),
    png(width, height) {
      const big = document.createElement('canvas');
      big.width = width * (job.scale ?? 1);
      big.height = height * (job.scale ?? 1);
      const out = big.getContext('2d');
      if (!out) throw new Error('2D canvas not supported');
      out.imageSmoothingEnabled = false;
      out.drawImage(canvas, 0, 0, big.width, big.height);
      return big.toDataURL('image/png');
    },
  };
}

/** The WebGL renderer string of `canvas`'s context (unmasked where the browser allows), or null. */
function glRenderer(canvas: HTMLCanvasElement): string | null {
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (gl === null) return null;
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return String(gl.getParameter(debug === null ? gl.RENDERER : debug.UNMASKED_RENDERER_WEBGL));
}

async function shootPixi(
  job: ShotJob,
  game: ViewGame,
  content: ContentBundle,
): Promise<ShotResult | ShotRefusal> {
  const frame = game.frame?.bind(game);
  if (frame === undefined)
    return {
      refused: 'no_frame_hook',
      renderer: null,
      message: `${job.viewUrl} gives no frame() (engine/core/view.ts), which --backend pixi needs`,
    };
  const skins = skinSet(content, 'canvas2d');
  if (!skins.main) throw new Error(`the game has no skin with backend "canvas2d"`);
  const { pixiDisplay } = await import('@engine/backends/pixi');
  const canvas = newCanvas(job);
  const o = overlayContext(content);
  const display = await pixiDisplay(canvas, {
    screen: job.screen,
    skin: skins.main,
    rounds: skins.rounds,
    sheet: o.sheets,
    fonts: o.fonts,
    ...(game.background !== undefined && { background: game.background }),
    preserveDrawingBuffer: true,
  });
  if (typeof display === 'string') return { refused: 'no_webgl', renderer: null, message: display };
  const renderer = glRenderer(canvas);
  const tiles: string[] = [];
  // The scenes' display list (`PixiRenderer.stage`), kept after each picture: a tile's UI is
  // painted onto its end and taken off again, so the frame is presented once per tick (a second
  // present would move the camera's lerp and the effects' clock on).
  const stage = (display.renderer as PixiRenderer).stage;
  const played = await play(job, game, (tick) => {
    const shown = frame();
    display.presenter.present(shown);
    display.present();
    // A tick with tiles: each tile's overlay over the same picture, the UI through the display's
    // PixiJS UI painter, a transition through the display's own pass (an iris on the presenter's
    // focus, the camera, as the shell draws it; the 2D tile's iris is on the picture's centre).
    for (const i of tilesAt(job, tick)) {
      const tile = job.tiles![i]!;
      if (tile.overlay === null) {
        tiles[i] = pngOf(job, canvas);
        continue;
      }
      const kept = stage.children.length;
      display.transition?.(overlayTransition(o.content, tile.overlay));
      const draws = overlayUi(o.content, tile.overlay, {
        fonts: o.fonts,
        frameSize: frameSizeOf(o.sheets),
        status: shown.status as StatValues,
      });
      const painter = display.uiPainter?.();
      if (draws.length > 0 && painter !== undefined) paintUi(draws, painter);
      display.present();
      tiles[i] = pngOf(job, canvas);
      // Back to the bare picture, for the next tile and the last tick's PNG.
      if (stage.children.length > kept) stage.removeChildren(kept);
      display.transition?.(null);
      display.present();
    }
  });
  return { png: pngOf(job, canvas), width: canvas.width, height: canvas.height, ...played, renderer, tiles };
}

declare global {
  interface Window {
    wwShoot?: (job: ShotJob) => Promise<ShotResult | ShotRefusal>;
  }
}

window.wwShoot = shoot;
