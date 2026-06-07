import { describe, expect, test } from 'bun:test';
import {
  buildHtmlSurfaceDocument,
  normalizeSurfaceTheme,
  SURFACE_THEME_STYLESHEET,
} from '../../src/server/html-surface.ts';

describe('normalizeSurfaceTheme', () => {
  test('accepts the three known themes, defaults to dark', () => {
    expect(normalizeSurfaceTheme('light')).toBe('light');
    expect(normalizeSurfaceTheme('high-contrast')).toBe('high-contrast');
    expect(normalizeSurfaceTheme('dark')).toBe('dark');
    expect(normalizeSurfaceTheme('nonsense')).toBe('dark');
    expect(normalizeSurfaceTheme(null)).toBe('dark');
  });
});

describe('buildHtmlSurfaceDocument', () => {
  test('links the same-origin theme stylesheet and sets data-theme on a full document', () => {
    const doc = buildHtmlSurfaceDocument('<!doctype html><html><head><title>x</title></head><body>Hi</body></html>', {
      theme: 'light',
      themeToken: 'theme-abc',
    });
    expect(doc).toContain(`<link rel="stylesheet" href="${SURFACE_THEME_STYLESHEET}">`);
    expect(doc).toContain('data-theme="light"');
    expect(doc).toContain('data-pmx-canvas-theme="light"');
    expect(doc).toContain('data-pmx-canvas-theme-bridge');
    expect(doc).toContain('theme-update');
    expect(doc).toContain('theme-abc');
    expect(doc).toContain('Hi');
  });

  test('wraps a fragment into a full document', () => {
    const doc = buildHtmlSurfaceDocument('<main>Report</main>', { theme: 'dark' });
    expect(doc.startsWith('<!doctype html>')).toBe(true);
    expect(doc).toContain('<meta charset="utf-8">');
    expect(doc).toContain('<main>Report</main>');
    expect(doc).toContain(`<link rel="stylesheet" href="${SURFACE_THEME_STYLESHEET}">`);
  });

  test('marks presentation mode + embeds exit token only when requested', () => {
    const review = buildHtmlSurfaceDocument('<!doctype html><html><head></head><body>Deck</body></html>', {
      theme: 'dark',
      presentation: false,
    });
    const present = buildHtmlSurfaceDocument('<!doctype html><html><head></head><body>Deck</body></html>', {
      theme: 'dark',
      presentation: true,
      presentationExitToken: 'presentation-xyz',
    });
    expect(review).not.toContain('data-pmx-presentation-mode="present"');
    expect(review).not.toContain('presentation-bridge');
    expect(present).toContain('data-pmx-presentation-mode="present"');
    expect(present).toContain('data-pmx-canvas-presentation-bridge');
    expect(present).toContain('presentation-xyz');
  });

  test('sanitizes caller tokens so they cannot break out of the inline script', () => {
    const doc = buildHtmlSurfaceDocument('<body>x</body>', {
      theme: 'dark',
      themeToken: 'abc</script><script>alert(1)</script>',
      presentation: true,
      presentationExitToken: 'tok"; evil()',
    });
    // The injected token strings keep only [A-Za-z0-9_-]; the injected attack
    // payload must not survive verbatim inside our bridge scripts.
    expect(doc).not.toContain('alert(1)');
    expect(doc).not.toContain('evil()');
    expect(doc).toContain('PMX_CANVAS_THEME_TOKEN = "abcscriptscriptalert1script"');
    expect(doc).toContain('PMX_CANVAS_PRESENTATION_EXIT_TOKEN = "tokevil"');
  });
});
