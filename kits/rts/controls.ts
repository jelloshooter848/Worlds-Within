import type { PointerGesture } from '@engine/core/input/pointer-logic';
import type { RtsCamera } from '@engine/core/present';
import type { RuleSwitch } from '@engine/core/rules';
import {
  buildCommand,
  commandAt,
  launchMission,
  stopCommand,
  trainCommand,
  type LaunchResult,
  type MissionLauncher,
  type OrderDraft,
} from './commands';
import type { RtsPlacing, RtsPresentOptions } from './present';
import { cellOf, Selection, type WorldBox } from './selection';
import type { RtsView } from './snapshot';

/**
 * The player's controls (Engine 0.9, the RTS view): pointer gestures (`input/pointer-logic.ts`)
 * through the camera (`RtsCamera`) into selection and orders. The page's glue feeds it each
 * step's gestures and hands the drafts it returns to `RtsGame.issue`; buttons (train, build,
 * stop, select heroes) call the methods directly. Presentation only, no world rules: it lives in
 * the glue, never in a world or a hash.
 *
 * - `pan` and `zoom` move the camera.
 * - A primary `tap` selects (`Selection.click`); while placing a building it places it there
 *   (`buildCommand` with the selected builders) and placing ends.
 * - A primary `box` drag shows the box (`move`) and selects on `end` (`Selection.box`).
 * - A secondary `tap` (right click, long-press) commands (`commandAt`); while placing it cancels.
 */
export class RtsControls {
  readonly selection: Selection;
  private dragging: WorldBox | null = null;
  private placingKind: string | null = null;
  private hoverCell: { x: number; y: number } | null = null;

  constructor(
    faction: string,
    readonly camera: RtsCamera,
    readonly tileSize: number,
    private readonly rules: RuleSwitch | null = null,
  ) {
    this.selection = new Selection(faction, rules);
  }

  /** Applies one gesture; returns the order it makes, if any. */
  gesture(g: PointerGesture, view: RtsView, additive = false): OrderDraft | null {
    if (this.camera.apply(g)) return null;
    if (g.type === 'tap') {
      const p = this.camera.screenToWorld(g.x, g.y);
      if (g.button === 'secondary') {
        if (this.placingKind !== null) {
          this.placingKind = null;
          return null;
        }
        return commandAt(view, this.selection, p, this.tileSize, this.rules);
      }
      if (this.placingKind !== null) {
        const draft = buildCommand(view, this.selection, this.placingKind, cellOf(p, this.tileSize));
        this.placingKind = null;
        return draft;
      }
      this.selection.click(view, p, this.tileSize, additive);
      return null;
    }
    if (g.type === 'box') {
      const a = this.camera.screenToWorld(g.x0, g.y0);
      const b = this.camera.screenToWorld(g.x1, g.y1);
      const box = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
      this.dragging = g.phase === 'move' ? box : null;
      if (g.phase === 'end') this.selection.box(view, box, this.tileSize, additive);
    }
    return null;
  }

  /** The hovering cursor (picture px), for the placing ghost; null when it left. */
  hover(at: { x: number; y: number } | null): void {
    this.hoverCell = at === null ? null : cellOf(this.camera.screenToWorld(at.x, at.y), this.tileSize);
  }

  /** Starts placing a building of type `kind` (the next primary tap places it). */
  startPlacing(kind: string): void {
    this.placingKind = kind;
  }

  cancelPlacing(): void {
    this.placingKind = null;
  }

  /** A train button: one `unit` at each selected building that trains it. */
  train(view: RtsView, unit: string): OrderDraft | null {
    return trainCommand(view, this.selection, unit);
  }

  /** The stop button. */
  stop(view: RtsView): OrderDraft | null {
    return stopCommand(view, this.selection);
  }

  /**
   * The bar's mission button: launches offered mission `id` through `launcher` (the game's
   * `MissionHost`); the result says whether it opened or why not (`launchMission`).
   */
  launchMission(view: RtsView, id: string, launcher: MissionLauncher): LaunchResult {
    return launchMission(view, id, launcher);
  }

  /** Selects the player's heroes alone. */
  selectHeroes(view: RtsView): number[] {
    return this.selection.heroes(view);
  }

  /** The building being placed at the hovered cell, sized from the world's types, or null. */
  placing(view: RtsView): RtsPlacing | null {
    if (this.placingKind === null || this.hoverCell === null) return null;
    const size = view.types?.buildings[this.placingKind]?.size ?? { w: 1, h: 1 };
    return { building: this.placingKind, cell: { ...this.hoverCell }, w: size.w, h: size.h };
  }

  /** The interface part of `presentWorld`'s options: selection (pruned), box, ghost and camera. */
  presentOptions(view: RtsView): Pick<RtsPresentOptions, 'selection' | 'box' | 'placing' | 'camera'> {
    return {
      selection: this.selection.prune(view),
      box: this.dragging,
      placing: this.placing(view),
      camera: this.camera.hint(),
    };
  }
}
