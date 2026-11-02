/**
 * Can the page pick an asset pack's folder? (0.4.73, owner item 84 choice A.)
 *
 * Importing a pack needs a folder picker (`<input type=file webkitdirectory>`, looked for on
 * HTMLInputElement's prototype). iPhone and iPad browsers (all WebKit) know the attribute but
 * their picker ignores it and only offers single files from the Files app, so feature detection
 * alone says yes there: an iOS or iPadOS device (an iPad reports itself as a Mac with touch
 * points) counts as having no folder picker.
 */
export function folderPickerSupported(
  input: object | undefined = typeof HTMLInputElement === 'undefined'
    ? undefined
    : HTMLInputElement.prototype,
  nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator,
): boolean {
  if (!input || !('webkitdirectory' in input)) return false;
  const ua = nav?.userAgent ?? '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav?.maxTouchPoints ?? 0) > 1);
  return !ios;
}

export interface PackPickerFacts {
  /** The on-screen touch pad is up (the player is on touch). */
  touchShown: boolean;
  /** matchMedia('(pointer: coarse)'): the primary pointer is a finger. */
  coarsePointer: boolean;
  /** folderPickerSupported(). */
  folderPicker: boolean;
}

/**
 * The ASSET PACKS page says ASSET PACKS NEED A COMPUTER instead of offering Import: only on a
 * touch device (pad shown, or a finger for a pointer) that cannot pick a folder. Both halves are
 * needed: a desktop browser without the picker still offers Import (its own picker says what it
 * can do, and a keyboard player can always reach a computer's file dialog), and a touch device
 * whose browser can pick folders (Chrome on Android, a touchscreen laptop) keeps Import too.
 */
export function packsNeedComputer(f: PackPickerFacts): boolean {
  return (f.touchShown || f.coarsePointer) && !f.folderPicker;
}
