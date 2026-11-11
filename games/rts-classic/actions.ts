import { z } from 'zod';
import type { RuleSwitch } from '@engine/core/rules';
import {
  buildCommand,
  commandAt,
  RTS_TILE_SIZE,
  Selection,
  stopCommand,
  trainCommand,
  type OrderDraft,
  type RtsView,
} from '@kits/rts';

/**
 * Interface actions: the player's clicks, boxes and buttons as data, so a run file can drive the
 * skirmish through the kit's selection and command mapper (`Selection`, `commandAt`, ...) as the
 * page does, and the kit's interface rules (`box-selects-own-units`, `command-attacks-enemies`,
 * `command-gathers-resources`) can be mutant-checked headless. A run file gives them in `orders`
 * next to recorded orders, told apart by `ui`:
 *
 *   { "tick": 0,  "ui": "box", "box": { "x": 112, "y": 144, "w": 16, "h": 32 } }
 *   { "tick": 0,  "ui": "build", "building": "barracks", "cell": { "x": 10, "y": 9 } }
 *   { "tick": 30, "ui": "click", "at": { "x": 168, "y": 152 } }
 *   { "tick": 30, "ui": "train", "unit": "soldier" }
 *   { "tick": 99, "ui": "command", "at": { "x": 456, "y": 248 } }
 *
 * Points and boxes are world pixels (16 per cell, `RTS_TILE_SIZE`), as the page's pointer gives
 * them once the camera is undone. `click` and `box` change the selection (`additive` adds to it);
 * `command`, `build`, `train` and `stop` turn it into an order, which the game stamps and applies
 * like any other. A recorded battle is still its orders: the page records what these produce.
 */

const Point = z.strictObject({
  x: z.int().describe('world px, east'),
  y: z.int().describe('world px, south'),
});
const Id = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'must be a letter followed by letters, digits, _ or -');

export const interfaceActionSchema = z.discriminatedUnion('ui', [
  z.strictObject({ ui: z.literal('click'), at: Point, additive: z.boolean().default(false) }),
  z.strictObject({
    ui: z.literal('box'),
    box: z.strictObject({ x: z.int(), y: z.int(), w: z.int(), h: z.int() }),
    additive: z.boolean().default(false),
  }),
  z.strictObject({ ui: z.literal('command'), at: Point }),
  z.strictObject({ ui: z.literal('build'), building: Id, cell: z.strictObject({ x: z.int(), y: z.int() }) }),
  z.strictObject({ ui: z.literal('train'), unit: Id }),
  z.strictObject({ ui: z.literal('stop') }),
]);
export type InterfaceAction = z.output<typeof interfaceActionSchema>;

/** The player's interface: the selection, and the actions that change it or give an order. */
export class PlayerInterface {
  readonly selection: Selection;

  constructor(
    faction: string,
    private readonly rules: RuleSwitch,
  ) {
    this.selection = new Selection(faction, rules);
  }

  /**
   * Carries out `action` on the world as `view` shows it: null for a selection change, else the
   * order it gives, or a reason when nothing selected can take it.
   */
  act(view: RtsView, action: InterfaceAction): OrderDraft | string | null {
    const sel = this.selection;
    sel.prune(view);
    const ts = RTS_TILE_SIZE;
    switch (action.ui) {
      case 'click':
        sel.click(view, action.at, ts, action.additive);
        return null;
      case 'box':
        sel.box(view, action.box, ts, action.additive);
        return null;
      case 'command':
        return commandAt(view, sel, action.at, ts, this.rules) ?? 'nothing selected can take a command';
      case 'build':
        return buildCommand(view, sel, action.building, action.cell) ?? 'no builder selected';
      case 'train':
        return trainCommand(view, sel, action.unit) ?? `no selected building trains ${action.unit}`;
      case 'stop':
        return stopCommand(view, sel) ?? 'no unit selected';
    }
  }
}
