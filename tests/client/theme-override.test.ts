import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  clearThemeOverride,
  initSessionThemeOverride,
  sessionThemeParam,
  themeOverrideActive,
} from '../../src/client/state/theme-override.ts';

// Host-default theming: a ?theme= param gives ONE client session its own
// theme (hosts match their chrome) without touching the server-global theme.
// These tests pin the param parsing, activation, auto scheme-following, and
// the explicit-pick override ending.

function setPageUrl(url: string): void {
  (window as unknown as { happyDOM: { setURL(next: string): void } }).happyDOM.setURL(url);
}

beforeEach(() => {
  setPageUrl('http://localhost:3000/workbench');
});

afterEach(() => {
  clearThemeOverride();
});

describe('sessionThemeParam', () => {
  test('parses a registered theme name, auto, and rejects junk', () => {
    setPageUrl('http://localhost:3000/workbench?theme=sepia');
    expect(sessionThemeParam()).toBe('sepia');
    setPageUrl('http://localhost:3000/workbench?theme=auto');
    expect(sessionThemeParam()).toBe('auto');
    setPageUrl('http://localhost:3000/workbench?theme=hotdog');
    expect(sessionThemeParam()).toBeNull();
    setPageUrl('http://localhost:3000/workbench');
    expect(sessionThemeParam()).toBeNull();
  });
});

describe('initSessionThemeOverride', () => {
  test('applies a named theme and marks the override active', () => {
    setPageUrl('http://localhost:3000/workbench?theme=light');
    const apply = mock((_theme: string) => {});
    initSessionThemeOverride(apply);
    expect(apply.mock.calls).toEqual([['light']]);
    expect(themeOverrideActive()).toBe(true);
    clearThemeOverride();
    expect(themeOverrideActive()).toBe(false);
  });

  test('no param means no override — server theme applies as usual', () => {
    const apply = mock((_theme: string) => {});
    initSessionThemeOverride(apply);
    expect(apply.mock.calls.length).toBe(0);
    expect(themeOverrideActive()).toBe(false);
  });

  test('auto resolves through prefers-color-scheme', () => {
    setPageUrl('http://localhost:3000/workbench?theme=auto');
    const apply = mock((_theme: string) => {});
    initSessionThemeOverride(apply);
    // Environment-derived: whatever scheme this DOM reports maps to its theme
    // (the live host-flip behavior is covered by the e2e emulateMedia test).
    const expected = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    expect(apply.mock.calls).toEqual([[expected]]);
    expect(themeOverrideActive()).toBe(true);
  });
});
