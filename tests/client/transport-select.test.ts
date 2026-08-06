import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { forcedTransport } from '../../src/client/state/sse-bridge.ts';

// Amp orbs stamp window.__PMX_AMP_ORB into the page; the portal proxy buffers
// SSE, so orb pages must default to the polling transport instead of burning
// the 3s watchdog (and risking the boot modal) before falling back.

function setPageUrl(url: string): void {
  (window as unknown as { happyDOM: { setURL(next: string): void } }).happyDOM.setURL(url);
}

beforeEach(() => {
  setPageUrl('http://localhost:3000/workbench');
});

afterEach(() => {
  delete (window as Window & { __PMX_AMP_ORB?: boolean }).__PMX_AMP_ORB;
});

describe('forcedTransport (Amp orb default)', () => {
  test('the ?transport= query param wins in both directions', () => {
    setPageUrl('http://localhost:3000/workbench?transport=poll');
    expect(forcedTransport()).toBe('poll');
    // Explicit sse overrides even a stamped orb page (diagnosis escape hatch).
    (window as Window & { __PMX_AMP_ORB?: boolean }).__PMX_AMP_ORB = true;
    setPageUrl('http://localhost:3000/workbench?transport=sse');
    expect(forcedTransport()).toBe('sse');
  });

  test('a stamped Amp orb page defaults straight to polling', () => {
    (window as Window & { __PMX_AMP_ORB?: boolean }).__PMX_AMP_ORB = true;
    expect(forcedTransport()).toBe('poll');
  });

  test('normal pages stay on auto (SSE first, watchdog fallback)', () => {
    expect(forcedTransport()).toBeNull();
  });
});
