/*
 * Actions that must run inside the player's own input event (0.4.44). iOS Safari (and, more
 * loosely, other browsers) let a page share, copy to or read from the clipboard, or focus a text
 * box with the keyboard up, only inside a user-gesture event handler (keydown, touchend /
 * pointerup, click), never later in the game loop. So the scene on top offers its confirm
 * action (Scene.gesture) while its cursor sits on such an item, and the input handlers run it in
 * the event itself:
 * - a confirm key (the JUMP or START key) runs it on key down;
 * - a touch confirm button (A / MENU) runs it on release: a touch's press is not a gesture on
 *   iOS until the finger lifts, so the press only claims it.
 * The scene's frame then sees the confirm press and asks `take()`: true means the event already
 * ran (or, for a touch, will run) the action, so the frame does nothing more. A gamepad has no
 * such event: its press finds nothing taken and the scene runs the action in the frame as before.
 */

export type GestureAction = () => void;

export class GestureGate {
  /** A confirm press was handled (or claimed for its release) by an event since the last frame. */
  private claimed = false;
  /** The action a touch confirm button claimed on its way down, run when it lifts. */
  private onRelease: GestureAction | null = null;

  /** `current`: the top scene's gesture action now (null: none, the frame handles its press). */
  constructor(private readonly current: () => GestureAction | null) {}

  /** A confirm key went down (inside its keydown): runs the action. True when one ran. */
  key(): boolean {
    const fn = this.current();
    if (!fn) return false;
    this.claimed = true;
    this.onRelease = null;
    fn();
    return true;
  }

  /** A touch confirm button went down: claims the press, to act on release (iOS). */
  touchDown(): void {
    const fn = this.current();
    if (!fn) return;
    this.claimed = true;
    this.onRelease = fn;
  }

  /** A touch confirm button lifted (inside its pointerup): runs what it claimed. */
  touchUp(): boolean {
    const fn = this.onRelease;
    this.onRelease = null;
    // The scene may have moved on meanwhile (a back press with the other thumb): then nothing.
    if (!fn || !this.current()) return false;
    fn();
    return true;
  }

  /** The scene's confirm press this frame: true when an event handles it (do nothing more). */
  take(): boolean {
    const c = this.claimed;
    this.claimed = false;
    return c;
  }

  /** After each frame: a claim no scene asked about (its press fell in a guard) is dropped. */
  endFrame(): void {
    this.claimed = false;
  }
}

/** The confirm actions: a key or touch button bound to one of these is a confirm. */
export const CONFIRM_ACTIONS = ['jump', 'start'] as const;

/**
 * Runs `gate`'s action inside every confirm key's keydown on `target` (main.ts: the window).
 * Keys typed into a text box (the paste box, the editor's fields) are the box's, not a confirm.
 */
export function bindGestureKeys(
  gate: GestureGate,
  target: EventTarget,
  isConfirm: (code: string) => boolean,
): void {
  target.addEventListener('keydown', (e) => {
    const ev = e as KeyboardEvent;
    if (ev.repeat || !isConfirm(ev.code)) return;
    const t = ev.target as { tagName?: string; isContentEditable?: boolean } | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName ?? ''))) return;
    gate.key();
  });
}
