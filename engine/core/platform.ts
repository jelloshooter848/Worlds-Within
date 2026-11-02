/*
 * Platform detection for the Home Screen (PWA) support (0.4.44): running from the Home Screen,
 * iPhone / iPad, Safari on them, and the browser's saved install prompt. Everything reads a small
 * PlatformEnv, so the tests drive it with user-agent strings and a matchMedia fake.
 */

export interface PlatformEnv {
  ua: string;
  /** navigator.maxTouchPoints: iPadOS shows a Mac user agent, but has a touch screen. */
  maxTouchPoints?: number;
  /** iOS Safari's own flag (navigator.standalone): true when opened from the Home Screen. */
  navigatorStandalone?: boolean;
  matchMedia?: (query: string) => { matches: boolean };
}

/** The live browser's environment (an empty one outside a browser). */
export function currentEnv(): PlatformEnv {
  if (typeof navigator === 'undefined') return { ua: '' };
  const nav = navigator as Navigator & { standalone?: boolean };
  const env: PlatformEnv = { ua: nav.userAgent ?? '', maxTouchPoints: nav.maxTouchPoints ?? 0 };
  if (typeof nav.standalone === 'boolean') env.navigatorStandalone = nav.standalone;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function')
    env.matchMedia = (q) => window.matchMedia(q);
  return env;
}

/** iPhone, iPod or iPad (an iPad in desktop mode by its Mac user agent and touch screen). */
export function isIOS(env: PlatformEnv): boolean {
  if (/iPhone|iPad|iPod/.test(env.ua)) return true;
  return /Macintosh/.test(env.ua) && (env.maxTouchPoints ?? 0) > 1;
}

/**
 * Tokens of the other iOS browsers and in-app browsers (Chrome, Firefox, Edge, Opera, Google,
 * DuckDuckGo, Yandex, Facebook, Instagram, LINE, Twitter / X, Snapchat, TikTok, WeChat): only
 * Safari itself can add a page to the Home Screen as a full-screen app.
 */
const NOT_SAFARI =
  /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|DuckDuckGo|YaBrowser|FBAN|FBAV|Instagram|Line\/|Twitter|Snapchat|musical_ly|BytedanceWebview|MicroMessenger/;

/** Safari on iOS (not another browser or an app's built-in browser). */
export function isIOSSafari(env: PlatformEnv): boolean {
  return isIOS(env) && /Version\/[\d.]+.*Safari\//.test(env.ua) && !NOT_SAFARI.test(env.ua);
}

/** A phone or tablet (iOS or Android), where the Home Screen tip is worth showing. */
export function isPhone(env: PlatformEnv): boolean {
  return isIOS(env) || /Android/.test(env.ua);
}

/** Running as an installed app: from the Home Screen (iOS) or an installed PWA window. */
export function isStandalone(env: PlatformEnv): boolean {
  if (env.navigatorStandalone === true) return true;
  const m = env.matchMedia;
  if (!m) return false;
  return m('(display-mode: standalone)').matches || m('(display-mode: fullscreen)').matches;
}

/**
 * What Options → ADD TO HOME SCREEN does here:
 * - `hidden`: already running from the Home Screen, or a desktop browser with no install API;
 * - `prompt`: the browser's own install prompt (Android, Chrome, Edge), saved earlier;
 * - `ios-safari`: the pixel-art guide to Safari's Share → Add to Home Screen;
 * - `ios-other`: Chrome, Firefox or an app's browser on iOS: open the page in Safari first;
 * - `browser-menu`: an Android browser that gave no prompt: its menu has Add to Home Screen.
 */
export type InstallVariant = 'hidden' | 'prompt' | 'ios-safari' | 'ios-other' | 'browser-menu';

export function installVariant(env: PlatformEnv, hasPrompt: boolean): InstallVariant {
  if (isStandalone(env)) return 'hidden';
  if (hasPrompt) return 'prompt';
  if (isIOS(env)) return isIOSSafari(env) ? 'ios-safari' : 'ios-other';
  if (isPhone(env)) return 'browser-menu';
  return 'hidden';
}

/** The browser's beforeinstallprompt event (Chromium only; not in the DOM typings). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface InstallPrompt {
  /** A saved prompt is waiting to be shown. */
  readonly available: boolean;
  /** The app was installed (appinstalled) this session. */
  readonly installed: boolean;
  /** Called when `available` or `installed` changes. */
  onChange: (() => void) | null;
  /** Shows the saved prompt (once per event): the player's choice, or 'unavailable'. */
  prompt(): Promise<'accepted' | 'dismissed' | 'unavailable'>;
}

/**
 * Saves the browser's install prompt (beforeinstallprompt) instead of letting it show its own
 * banner, so Options → ADD TO HOME SCREEN can show it when the player asks. Listen early (main.ts
 * at boot): the event fires once, soon after the page loads.
 */
export function captureInstallPrompt(target: EventTarget): InstallPrompt {
  let saved: BeforeInstallPromptEvent | null = null;
  const cap: InstallPrompt & { installed: boolean } = {
    get available() {
      return saved !== null;
    },
    installed: false,
    onChange: null,
    async prompt() {
      const e = saved;
      if (!e) return 'unavailable';
      saved = null; // an event can be prompted only once
      cap.onChange?.();
      try {
        await e.prompt();
        return (await e.userChoice).outcome;
      } catch {
        return 'unavailable';
      }
    },
  };
  target.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    saved = e as BeforeInstallPromptEvent;
    cap.onChange?.();
  });
  target.addEventListener('appinstalled', () => {
    saved = null;
    cap.installed = true;
    cap.onChange?.();
  });
  return cap;
}
