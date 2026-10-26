/** Pushes text to an aria-live region so screen readers hear menu and game events. */
export class Announcer {
  private el: HTMLElement | null;
  enabled = true;
  private last = '';
  constructor(el: HTMLElement | null) {
    this.el = el;
  }
  /** The last text said (a box over a screen reads the screen's line again as it closes). */
  get lastText(): string {
    return this.last;
  }
  say(text: string): void {
    if (!this.enabled || !this.el) return;
    // Re-announce identical text by clearing first.
    if (text === this.last) this.el.textContent = '';
    this.last = text;
    requestAnimationFrame(() => {
      if (this.el) this.el.textContent = text;
    });
  }
}

export const NULL_ANNOUNCER = { say(): void {}, enabled: false } as unknown as Announcer;
