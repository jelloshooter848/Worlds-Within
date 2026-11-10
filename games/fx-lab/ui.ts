import type { ContentBundle } from '@engine/core/content/bundle';
import type { SheetLookup } from '@engine/core/assets/sheet-lookup';
import { UiScreen, UI_KIND, type FontLookup, type UiFrameSize, type UiScreenFile } from '@engine/core/ui';

/**
 * Glue for the lab's UI screen (Engine 0.16 T7): `content/ui/lab.json` (a pause menu with a
 * slider, a toggle, a disabled item and a "Talk" item that opens Pip's dialog with a portrait,
 * three pages and a choice) as a `UiScreen`. No layout or rule here: it is all in the file.
 */

/** The lab's `ui` file by name (`lab`); throws when there is none. */
export function fxUiFile(content: ContentBundle, name = 'lab'): UiScreenFile {
  const entry = content.entries.find((e) => e.kind === UI_KIND.name && e.name === name);
  if (entry === undefined) throw new Error(`the fx lab has no ui screen "${name}" (content/ui/${name}.json)`);
  return entry.value as UiScreenFile;
}

/** Sprite frame sizes from the lab's sheets (a panel's frame, a portrait). */
export function sheetFrameSize(sheets: SheetLookup): UiFrameSize {
  return (sheet, palette, frame) => {
    const rect = sheets(sheet, palette)?.frames.get(frame);
    return rect === undefined ? null : { w: rect.w, h: rect.h };
  };
}

export interface FxUiOptions {
  sheets: SheetLookup;
  fonts: FontLookup;
  onSound?: (id: string) => void;
  /** `menu` (the pause menu focused, default) or `dialog` (Pip's dialog alone). */
  open?: 'menu' | 'dialog';
}

/** A fresh lab screen: the pause menu, or (with `open: 'dialog'`) only the dialog. */
export function fxUiScreen(content: ContentBundle, opts: FxUiOptions): UiScreen {
  const ui = new UiScreen(fxUiFile(content), {
    screen: content.manifest.screen,
    fonts: opts.fonts,
    frameSize: sheetFrameSize(opts.sheets),
    ...(opts.onSound !== undefined && { onSound: opts.onSound }),
  });
  if (opts.open === 'dialog') {
    ui.close('main');
    for (const w of ['#0', '#1', '#2']) ui.close(w);
    ui.open('talk');
  }
  return ui;
}
