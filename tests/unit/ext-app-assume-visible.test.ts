import { describe, expect, test } from 'bun:test';
import { shouldAssumeVisibleRearm } from '../../src/client/nodes/ExtAppFrame.tsx';

// Finding N (0.4.7 report): the GitHub Copilot panel's WKWebView reports
// `visibilityState === 'hidden'` continuously, so the visibilitychange re-arm
// never fires and `paint-ok` is a false green while the user sees a black tile.
// The instrumented trail carried `visibility: "hidden"` on every recovery event
// with the panel open and on-screen.

const WEBKIT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const VIEWPORT = { width: 1440, height: 900 };
const ON_SCREEN = { top: 100, left: 120, bottom: 500, right: 640, width: 520, height: 400 };

function ask(overrides: Partial<Parameters<typeof shouldAssumeVisibleRearm>[0]> = {}) {
  return shouldAssumeVisibleRearm({
    userAgent: WEBKIT_UA,
    visibilityState: 'hidden',
    rect: ON_SCREEN,
    viewport: VIEWPORT,
    alreadyRearmed: false,
    ...overrides,
  });
}

describe('shouldAssumeVisibleRearm', () => {
  test('re-arms the Copilot case: WebKit, permanently hidden, frame on-screen', () => {
    expect(ask()).toBe(true);
  });

  test('leaves a host with a working visibility signal to the visibilitychange path', () => {
    expect(ask({ visibilityState: 'visible' })).toBe(false);
  });

  test('does not re-arm a frame scrolled off-screen', () => {
    // Genuinely out of view: the black tile nobody is looking at.
    expect(ask({ rect: { top: 1200, left: 120, bottom: 1600, right: 640, width: 520, height: 400 } })).toBe(false);
    expect(ask({ rect: { top: -900, left: 120, bottom: -500, right: 640, width: 520, height: 400 } })).toBe(false);
    expect(ask({ rect: { top: 100, left: 2000, bottom: 500, right: 2520, width: 520, height: 400 } })).toBe(false);
  });

  test('does not re-arm a collapsed frame with no box to composite', () => {
    expect(ask({ rect: { top: 100, left: 120, bottom: 100, right: 120, width: 0, height: 0 } })).toBe(false);
  });

  test('stays a strict no-op on engines without the compositor dropout', () => {
    expect(ask({ userAgent: CHROME_UA })).toBe(false);
  });

  test('fires at most once, so a forever-hidden host cannot loop remounts', () => {
    expect(ask({ alreadyRearmed: true })).toBe(false);
  });

  test('counts a frame straddling the viewport edge as on-screen', () => {
    expect(ask({ rect: { top: -50, left: -20, bottom: 350, right: 500, width: 520, height: 400 } })).toBe(true);
  });
});
