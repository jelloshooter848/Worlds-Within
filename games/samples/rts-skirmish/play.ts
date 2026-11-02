import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { InputFrame } from '@engine/core/input/input-manager';
import type { PointerGesture } from '@engine/core/input/pointer-logic';
import { RtsCamera } from '@engine/core/present';
import type { Scene } from '@engine/core/scene';
import { RtsControls, RTS_TILE_SIZE, trainButtons, type OrderDraft, type RtsView } from '@kits/rts';
import { PLAYER } from './content';
import { createGame, sidesOf, type SideSummary, type SkirmishGame } from './headless';
import type { InterfaceOptions, SkirmishPicture } from './picture';
import { BattleRecorder, type RecordedRun } from './recording';

/**
 * The skirmish as the browser plays it (Engine 0.9 T12): a `Scene` for `bootBrowserGame` that
 * joins the page's pointer gestures and buttons to the headless game. Thin glue: the camera is
 * the engine's `RtsCamera`, selection and commands are the kit's `RtsControls`, the world is the
 * same `SkirmishGame` the tools play (`headless.ts`), and the picture is `picture.ts`'s. No DOM
 * and no clock here (`main.ts` has them), so Node tests drive it with scripted gestures.
 *
 * Each loop step (60 a second) it applies the buttons pressed and the gestures made since the last
 * one (an order they give goes to `RtsGame.issue`, stamped and recorded with the tick it is applied
 * at), and every `stepsPerTick` steps it steps the game one tick and hands the snapshot to the
 * recorder (`recording.ts`). A sim tick is 1/60 s in the tools; the page shows `TICKS_PER_SECOND`
 * of them a second so a battle is followable. Same orders at the same ticks give the same world,
 * whatever the page's speed: `exportRun` is the battle as a run file `pnpm cli run` replays.
 *
 * The controls' selection is the page's alone (presentation, like the camera): the game's own
 * interface selection (`ui.selection` in its snapshot, used by run files' interface actions) stays
 * empty, as it does when the recorded orders are replayed.
 */

/** Sim ticks the page plays per second (the loop steps 60 times a second). */
export const TICKS_PER_SECOND = 10;
export const STEPS_PER_TICK = 60 / TICKS_PER_SECOND;

/** What the page reads of the pointer each step (`PointerSource`, or a script in tests). */
export interface GestureFeed {
  gestures(): readonly PointerGesture[];
  /** The hovering mouse cursor in picture pixels, or null. */
  cursor(): { x: number; y: number } | null;
}

/** A button on the page's bar. */
export type PageButton =
  | { kind: 'build'; building: string }
  | { kind: 'train'; unit: string }
  | { kind: 'stop' }
  | { kind: 'heroes' }
  | { kind: 'cancel' };

/** What the bar shows for the selection now. */
export interface ButtonState {
  /** Building types the selected builders can put up (empty when no builder is selected). */
  build: string[];
  /** Unit types the selected finished buildings train. */
  train: string[];
  /** True when own units are selected (stop). */
  stop: boolean;
  /** The building being placed, or null. */
  placing: string | null;
}

export interface SkirmishPlayOptions {
  /** The game's content and seed (`game.json`'s `start.seed` on the page). */
  content: ContentBundle;
  seed: number;
  /** The pointer, or null (buttons only). */
  pointer: GestureFeed | null;
  /** Makes the picture on the first render, with the frame options the interface adds. */
  picture(r: Renderer, ui: InterfaceOptions): SkirmishPicture;
  /** Loop steps per game tick (default `STEPS_PER_TICK`). */
  stepsPerTick?: number;
  /** True while the page's additive key (Shift) is held. */
  additive?: () => boolean;
}

export class SkirmishPlay implements Scene {
  readonly game: SkirmishGame;
  readonly camera: RtsCamera;
  readonly controls: RtsControls;
  readonly recorder: BattleRecorder;
  /** The last order's refusal (the sim's reason), or '' since it was applied. */
  message = '';
  private readonly stepsPerTick: number;
  private readonly pressed: PageButton[] = [];
  private placingKind: string | null = null;
  private steps = 0;
  private picture: SkirmishPicture | null = null;

  constructor(private readonly opts: SkirmishPlayOptions) {
    this.game = createGame(opts.content, opts.seed);
    this.stepsPerTick = opts.stepsPerTick ?? STEPS_PER_TICK;
    const view = this.view();
    const cols = view.terrain?.width ?? 1;
    const rows = view.terrain?.height ?? 1;
    const home = homeOf(view);
    this.camera = new RtsCamera({
      view: opts.content.manifest.screen,
      area: { x: 0, y: 0, w: cols * RTS_TILE_SIZE, h: rows * RTS_TILE_SIZE },
      ...(home && { centre: home }),
    });
    this.controls = new RtsControls(PLAYER, this.camera, RTS_TILE_SIZE, this.game.rts.rules);
    this.recorder = new BattleRecorder(opts.seed);
    this.recorder.reached(0, () => this.game.snapshot());
  }

  /** The world as the kit reads it now. */
  view(): RtsView {
    return this.game.rts.view();
  }

  /** The game tick. */
  get tick(): number {
    return this.game.rts.tick;
  }

  /** Every side at a glance (`sidesOf`). */
  sides(): Record<string, SideSummary> {
    return sidesOf(this.view(), this.game.factions);
  }

  /** A bar button: carried out at the start of the next step. */
  press(button: PageButton): void {
    this.pressed.push(button);
  }

  /** What the bar shows now. */
  buttons(): ButtonState {
    const view = this.view();
    const sel = this.controls.selection;
    sel.prune(view);
    const own = sel.ownUnits(view);
    const builders = own.some((u) => u.worker);
    return {
      build: builders ? Object.keys(view.types?.buildings ?? {}) : [],
      train: trainButtons(view, sel),
      stop: own.length > 0,
      placing: this.placingKind,
    };
  }

  update(input: InputFrame): void {
    for (const b of this.pressed.splice(0)) this.button(b);
    const pointer = this.opts.pointer;
    if (pointer) {
      const additive = this.opts.additive?.() ?? false;
      for (const g of pointer.gestures()) {
        const placing = this.placingKind;
        const draft = this.controls.gesture(g, this.view(), additive);
        // A tap ends placing in the controls (placed or cancelled); keep the bar in step.
        if (placing !== null && g.type === 'tap') this.placingKind = null;
        this.issue(draft);
      }
      this.controls.hover(pointer.cursor());
    }
    if (++this.steps % this.stepsPerTick !== 0) return;
    this.game.step(input);
    this.recorder.reached(this.tick, () => this.game.snapshot());
  }

  render(r: Renderer): void {
    this.picture ??= this.opts.picture(r, () => this.controls.presentOptions(this.view()));
    this.picture.draw(this.game.rts, []);
  }

  /** The battle so far as a run file (`recording.ts`), or null before tick 20. */
  exportRun(game?: string): Promise<RecordedRun | null> {
    return this.recorder.runFile(this.game.rts.recorded(), game);
  }

  private button(b: PageButton): void {
    const view = this.view();
    switch (b.kind) {
      case 'build':
        this.placingKind = b.building;
        this.controls.startPlacing(b.building);
        return;
      case 'cancel':
        this.placingKind = null;
        this.controls.cancelPlacing();
        return;
      case 'train':
        this.issue(this.controls.train(view, b.unit));
        return;
      case 'stop':
        this.issue(this.controls.stop(view));
        return;
      case 'heroes':
        this.controls.selectHeroes(view);
        return;
    }
  }

  private issue(draft: OrderDraft | null): void {
    if (draft === null) return;
    this.message = this.game.rts.issue(draft).error ?? '';
  }
}

/** Where the camera starts: the player's first building (else first unit), else the map's centre. */
function homeOf(view: RtsView): { x: number; y: number } | undefined {
  const b = view.buildings.find((x) => x.faction === PLAYER);
  if (b) return { x: (b.x + b.w / 2) * RTS_TILE_SIZE, y: (b.y + b.h / 2) * RTS_TILE_SIZE };
  const u = view.units.find((x) => x.faction === PLAYER);
  return u ? { x: (u.x + 0.5) * RTS_TILE_SIZE, y: (u.y + 0.5) * RTS_TILE_SIZE } : undefined;
}
