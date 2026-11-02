import { Actions, type Action } from './actions';
import type { Code, PlayerBindings } from './bindings';
import { defaultBindings } from './bindings';

export interface InputSource {
  /** Set of raw codes currently held. Called once per fixed step. */
  poll(): ReadonlySet<Code>;
  /** Raw codes that went down since the last call (for remap capture). */
  takeJustPressed?(): Code[];
}

/** Per-player, per-frame view of input. The headless sim provides its own implementation. */
export interface InputFrame {
  held(a: Action): boolean;
  pressed(a: Action): boolean;
  released(a: Action): boolean;
  /** Was jump pressed within the last `windowFrames` frames (and not yet consumed)? */
  bufferedJump(windowFrames: number): boolean;
  consumeJumpBuffer(): void;
  /** Signed horizontal direction: -1, 0, 1 (right wins ties, like holding both on a d-pad is impossible). */
  readonly dirX: -1 | 0 | 1;
}

export class ActionState implements InputFrame {
  private cur = new Set<Action>();
  private prev = new Set<Action>();
  private jumpPressedFrame = -1000;
  private frame = 0;

  beginFrame(next: Set<Action>): void {
    this.prev = this.cur;
    this.cur = next;
    this.frame++;
    if (this.pressed('jump')) this.jumpPressedFrame = this.frame;
  }
  held(a: Action): boolean {
    return this.cur.has(a);
  }
  pressed(a: Action): boolean {
    return this.cur.has(a) && !this.prev.has(a);
  }
  released(a: Action): boolean {
    return !this.cur.has(a) && this.prev.has(a);
  }
  bufferedJump(windowFrames: number): boolean {
    return this.frame - this.jumpPressedFrame < windowFrames;
  }
  consumeJumpBuffer(): void {
    this.jumpPressedFrame = -1000;
  }
  get dirX(): -1 | 0 | 1 {
    const l = this.cur.has('left');
    const r = this.cur.has('right');
    return l && !r ? -1 : r && !l ? 1 : 0;
  }
  /** Any action held at all (used by the title screen gate). */
  get any(): boolean {
    return this.cur.size > 0;
  }
  /** Any action pressed this frame. */
  get anyPressed(): boolean {
    for (const a of this.cur) if (!this.prev.has(a)) return true;
    return false;
  }
}

/** Empty frame for scenes that ignore input. */
export const NO_INPUT: InputFrame = {
  held: () => false,
  pressed: () => false,
  released: () => false,
  bufferedJump: () => false,
  consumeJumpBuffer: () => undefined,
  dirX: 0,
};

/** A key or pad button caught by the remap UI. */
export interface CaptureResult {
  code: Code;
  kind: 'keyboard' | 'gamepad';
}

export class InputManager {
  readonly players: ActionState[] = [];
  bindings: PlayerBindings[];
  private readonly sources: { keyboard: InputSource[]; gamepad: InputSource[]; touch: InputSource[] } = {
    keyboard: [],
    gamepad: [],
    touch: [],
  };

  /** While set, raw presses are routed here instead of to players (remap UI); null = cancelled. */
  private capture: ((got: CaptureResult | null) => void) | null = null;
  /**
   * Codes held when a capture ended (the key just bound, Esc that cancelled, anything else still
   * down): ignored until released, so the new key does not also fire its new action at once.
   */
  private readonly suppressed = new Set<Code>();

  constructor(playerCount = 2, bindings?: PlayerBindings[]) {
    this.bindings = bindings ?? Array.from({ length: playerCount }, (_, i) => defaultBindings(i));
    for (let i = 0; i < playerCount; i++) this.players.push(new ActionState());
  }

  addSource(kind: 'keyboard' | 'gamepad' | 'touch', src: InputSource): void {
    this.sources[kind].push(src);
  }

  /** Capture the next raw key or button press; resolves with the code, or null if cancelled (Esc). */
  captureNext(): Promise<CaptureResult | null> {
    this.capture?.(null);
    return new Promise((resolve) => {
      this.capture = (got) => {
        this.capture = null;
        resolve(got);
      };
    });
  }

  cancelCapture(): void {
    this.capture?.(null);
  }

  get capturing(): boolean {
    return this.capture !== null;
  }

  /** Sample all sources once and compute every player's action set. Call at the start of each fixed step. */
  beginFrame(): void {
    const kb = union(this.sources.keyboard.map((s) => s.poll()));
    const touch = union(this.sources.touch.map((s) => s.poll()));
    const padsByIndex = this.sources.gamepad.map((s) => s.poll());
    const allPads = union(padsByIndex);
    // A suppressed code counts again once it has been seen released.
    for (const c of this.suppressed) if (!kb.has(c) && !allPads.has(c)) this.suppressed.delete(c);
    if (this.capture) {
      let got: CaptureResult | null | undefined;
      for (const s of this.sources.keyboard) {
        const code = s.takeJustPressed?.()[0];
        if (code) {
          got = code === 'Escape' ? null : { code, kind: 'keyboard' };
          break;
        }
      }
      if (got === undefined) {
        for (const s of this.sources.gamepad) {
          const code = s.takeJustPressed?.()[0];
          if (code) {
            got = { code, kind: 'gamepad' };
            break;
          }
        }
      }
      if (got !== undefined) {
        // Everything down now (the captured key or button, Esc) waits for its release.
        for (const c of kb) this.suppressed.add(c);
        for (const c of allPads) this.suppressed.add(c);
        if (got) this.suppressed.add(got.code);
        this.capture(got);
      }
      for (const p of this.players) p.beginFrame(new Set());
      return;
    }
    for (const s of [...this.sources.keyboard, ...this.sources.gamepad]) s.takeJustPressed?.();
    const live = (set: ReadonlySet<Code>) => (c: Code) => set.has(c) && !this.suppressed.has(c);
    const kbDown = live(kb);
    for (let p = 0; p < this.players.length; p++) {
      const b = this.bindings[p] ?? defaultBindings(p);
      const padDown = live(padsByIndex[b.gamepadIndex ?? p] ?? padsByIndex[0] ?? EMPTY);
      const next = new Set<Action>();
      for (const a of Actions) {
        if (b.keyboard[a]?.some(kbDown)) next.add(a);
        else if (b.gamepad[a]?.some(padDown)) next.add(a);
        else if (p === 0 && touch.has(`touch:${a}`)) next.add(a);
      }
      this.players[p]?.beginFrame(next);
    }
  }

  player(i: number): ActionState {
    const p = this.players[i];
    if (!p) throw new Error(`no player ${i}`);
    return p;
  }

  rebind(player: number, kind: 'keyboard' | 'gamepad', action: Action, codes: Code[]): void {
    const b = this.bindings[player];
    if (!b) return;
    b[kind][action] = codes;
  }
}

const EMPTY: ReadonlySet<Code> = new Set();
function union(sets: ReadonlySet<Code>[]): ReadonlySet<Code> {
  if (sets.length === 0) return EMPTY;
  if (sets.length === 1) return sets[0] as ReadonlySet<Code>;
  const out = new Set<Code>();
  for (const s of sets) for (const c of s) out.add(c);
  return out;
}
