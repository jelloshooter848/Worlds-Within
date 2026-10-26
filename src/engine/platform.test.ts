import { describe, expect, it } from 'vitest';
import {
  captureInstallPrompt,
  installVariant,
  isIOS,
  isIOSSafari,
  isPhone,
  isStandalone,
  type PlatformEnv,
} from './platform';

/** Real user-agent strings, one per kind of browser the Options row tells apart. */
export const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1',
  iphoneFirefox:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/141.0 Mobile/15E148 Safari/605.1.15',
  iphoneEdge:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/138.3351.83 Mobile/15E148 Safari/605.1.15',
  /** Facebook's in-app browser: a WKWebView with no Safari token. */
  iphoneFacebook:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/520.0.0.38.101;FBBV/1;FBDV/iPhone16,2;FBMD/iPhone;FBSN/iOS;FBSV/18.5;FBSS/3;FBCR/;FBID/phone;FBLC/en_US;FBOP/80]',
  /** Instagram's in-app browser. */
  iphoneInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 390.0.0.27.82 (iPhone16,2; iOS 18_5; en_US; en; scale=3.00; 1179x2556; 754234520)',
  /** Google's app: has Safari/ but also GSA/. */
  iphoneGoogleApp:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/380.0.756103284 Mobile/15E148 Safari/604.1',
  ipadSafari:
    'Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  /** iPadOS asks for the desktop site by default: a Mac UA, but a touch screen. */
  ipadDesktopMode:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 15; Mobile; rv:141.0) Gecko/141.0 Firefox/141.0',
  desktopChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  desktopFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0',
} as const;

/** A matchMedia fake: `display-mode` queries match `mode` only. */
function media(mode: 'browser' | 'standalone' | 'fullscreen' | 'minimal-ui') {
  return (q: string) => ({ matches: q.replace(/\s/g, '') === `(display-mode:${mode})` });
}

function env(ua: string, over: Partial<PlatformEnv> = {}): PlatformEnv {
  return { ua, maxTouchPoints: 0, matchMedia: media('browser'), ...over };
}

describe('platform: isIOS / isIOSSafari / isPhone', () => {
  it('tells iPhone and iPad from everything else, iPad desktop mode by its touch screen', () => {
    expect(isIOS(env(UA.iphoneSafari, { maxTouchPoints: 5 }))).toBe(true);
    expect(isIOS(env(UA.iphoneChrome, { maxTouchPoints: 5 }))).toBe(true);
    expect(isIOS(env(UA.ipadSafari, { maxTouchPoints: 5 }))).toBe(true);
    expect(isIOS(env(UA.ipadDesktopMode, { maxTouchPoints: 5 }))).toBe(true);
    expect(isIOS(env(UA.macSafari, { maxTouchPoints: 0 }))).toBe(false);
    expect(isIOS(env(UA.androidChrome, { maxTouchPoints: 5 }))).toBe(false);
    expect(isIOS(env(UA.desktopChrome))).toBe(false);
  });

  it('Safari only: not Chrome, Firefox, Edge, Google or in-app browsers on iOS, nor Safari on a Mac', () => {
    expect(isIOSSafari(env(UA.iphoneSafari, { maxTouchPoints: 5 }))).toBe(true);
    expect(isIOSSafari(env(UA.ipadSafari, { maxTouchPoints: 5 }))).toBe(true);
    expect(isIOSSafari(env(UA.ipadDesktopMode, { maxTouchPoints: 5 }))).toBe(true);
    for (const ua of [
      UA.iphoneChrome,
      UA.iphoneFirefox,
      UA.iphoneEdge,
      UA.iphoneFacebook,
      UA.iphoneInstagram,
      UA.iphoneGoogleApp,
    ])
      expect(isIOSSafari(env(ua, { maxTouchPoints: 5 })), ua).toBe(false);
    expect(isIOSSafari(env(UA.macSafari))).toBe(false);
    expect(isIOSSafari(env(UA.androidChrome, { maxTouchPoints: 5 }))).toBe(false);
  });

  it('a phone or tablet: iOS and Android, not desktops', () => {
    expect(isPhone(env(UA.iphoneSafari, { maxTouchPoints: 5 }))).toBe(true);
    expect(isPhone(env(UA.iphoneFacebook, { maxTouchPoints: 5 }))).toBe(true);
    expect(isPhone(env(UA.androidChrome, { maxTouchPoints: 5 }))).toBe(true);
    expect(isPhone(env(UA.androidFirefox, { maxTouchPoints: 5 }))).toBe(true);
    expect(isPhone(env(UA.desktopChrome))).toBe(false);
    expect(isPhone(env(UA.macSafari))).toBe(false);
  });
});

describe('platform: isStandalone', () => {
  it('display-mode standalone (or fullscreen), or iOS navigator.standalone', () => {
    expect(isStandalone(env(UA.androidChrome, { matchMedia: media('standalone') }))).toBe(true);
    expect(isStandalone(env(UA.androidChrome, { matchMedia: media('fullscreen') }))).toBe(true);
    expect(isStandalone(env(UA.iphoneSafari, { navigatorStandalone: true }))).toBe(true);
    expect(isStandalone(env(UA.iphoneSafari, { navigatorStandalone: false }))).toBe(false);
    expect(isStandalone(env(UA.desktopChrome))).toBe(false);
    expect(isStandalone(env(UA.desktopChrome, { matchMedia: media('minimal-ui') }))).toBe(false);
  });

  it('no matchMedia at all (old browsers, tests): not standalone', () => {
    expect(isStandalone({ ua: UA.desktopChrome })).toBe(false);
  });
});

describe('platform: installVariant (the Options row)', () => {
  it('hidden once running from the Home Screen, whatever the browser', () => {
    expect(
      installVariant(env(UA.iphoneSafari, { navigatorStandalone: true, maxTouchPoints: 5 }), false),
    ).toBe('hidden');
    expect(installVariant(env(UA.androidChrome, { matchMedia: media('standalone') }), true)).toBe('hidden');
  });

  it('the browser install prompt when one was saved (Android, Chrome, Edge, desktop or phone)', () => {
    expect(installVariant(env(UA.androidChrome, { maxTouchPoints: 5 }), true)).toBe('prompt');
    expect(installVariant(env(UA.desktopChrome), true)).toBe('prompt');
  });

  it("iOS: Safari's guide, else open in Safari first", () => {
    expect(installVariant(env(UA.iphoneSafari, { maxTouchPoints: 5 }), false)).toBe('ios-safari');
    expect(installVariant(env(UA.ipadDesktopMode, { maxTouchPoints: 5 }), false)).toBe('ios-safari');
    expect(installVariant(env(UA.iphoneChrome, { maxTouchPoints: 5 }), false)).toBe('ios-other');
    expect(installVariant(env(UA.iphoneFacebook, { maxTouchPoints: 5 }), false)).toBe('ios-other');
  });

  it('an Android browser with no prompt: its own menu; a desktop with no install API: hidden', () => {
    expect(installVariant(env(UA.androidFirefox, { maxTouchPoints: 5 }), false)).toBe('browser-menu');
    expect(installVariant(env(UA.androidChrome, { maxTouchPoints: 5 }), false)).toBe('browser-menu');
    expect(installVariant(env(UA.desktopFirefox), false)).toBe('hidden');
    expect(installVariant(env(UA.macSafari), false)).toBe('hidden');
    expect(installVariant(env(UA.desktopChrome), false)).toBe('hidden');
  });
});

/** A fake beforeinstallprompt event: prompt() resolves with the player's choice. */
function promptEvent(outcome: 'accepted' | 'dismissed') {
  const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string }>;
    prompted: number;
  };
  e.prompted = 0;
  e.prompt = async () => void e.prompted++;
  e.userChoice = Promise.resolve({ outcome });
  return e;
}

describe('platform: captureInstallPrompt', () => {
  it('keeps the event (stopping the mini-infobar), and prompt() asks once with the choice back', async () => {
    const target = new EventTarget();
    const cap = captureInstallPrompt(target);
    let changes = 0;
    cap.onChange = () => changes++;
    expect(cap.available).toBe(false);
    expect(await cap.prompt()).toBe('unavailable');
    const e = promptEvent('accepted');
    target.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(cap.available).toBe(true);
    expect(changes).toBe(1);
    expect(await cap.prompt()).toBe('accepted');
    expect(e.prompted).toBe(1);
    // An event can be used only once.
    expect(cap.available).toBe(false);
    expect(await cap.prompt()).toBe('unavailable');
  });

  it('a dismissed prompt is gone too (the browser fires a fresh event when it allows another)', async () => {
    const target = new EventTarget();
    const cap = captureInstallPrompt(target);
    target.dispatchEvent(promptEvent('dismissed'));
    expect(await cap.prompt()).toBe('dismissed');
    expect(cap.available).toBe(false);
    target.dispatchEvent(promptEvent('accepted'));
    expect(cap.available).toBe(true);
  });

  it('appinstalled forgets the saved event', () => {
    const target = new EventTarget();
    const cap = captureInstallPrompt(target);
    target.dispatchEvent(promptEvent('accepted'));
    target.dispatchEvent(new Event('appinstalled'));
    expect(cap.available).toBe(false);
    expect(cap.installed).toBe(true);
  });
});
