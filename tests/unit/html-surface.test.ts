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

  test('injects the AX bridge only when enabled, with sanitized token + nodeId', () => {
    const off = buildHtmlSurfaceDocument('<body>x</body>', { theme: 'dark' });
    expect(off).not.toContain('window.PMX_AX');

    const on = buildHtmlSurfaceDocument('<body>x</body>', {
      theme: 'dark',
      axBridge: true,
      axToken: 'ax-abc',
      nodeId: 'node-1',
    });
    expect(on).toContain('data-pmx-canvas-ax-bridge');
    expect(on).toContain('window.PMX_AX');
    expect(on).toContain('PMX_AX_TOKEN = "ax-abc"');
    expect(on).toContain('PMX_AX_NODE_ID = "node-1"');

    const evil = buildHtmlSurfaceDocument('<body>x</body>', {
      theme: 'dark',
      axBridge: true,
      axToken: 'a</script><x>',
      nodeId: 'n',
    });
    expect(evil).not.toContain('a</script><x>');
  });

  test('injects a fallback <title> for a fragment when given a title', () => {
    const doc = buildHtmlSurfaceDocument('<main>Report</main>', { theme: 'dark', title: 'Quarterly Dashboard' });
    expect(doc).toContain('<title>Quarterly Dashboard</title>');
  });

  test('injects a fallback <title> into a full document head when the author HTML has none', () => {
    const doc = buildHtmlSurfaceDocument('<html><head><meta charset="utf-8"></head><body>full</body></html>', {
      theme: 'dark',
      title: 'Full Doc Title',
    });
    expect(doc).toContain('<title>Full Doc Title</title>');
  });

  test('injects a fallback <title> even when author HTML only has a nested SVG <title>', () => {
    const fragment = buildHtmlSurfaceDocument('<svg><title>icon label</title><rect /></svg>', {
      theme: 'dark',
      title: 'Node Title',
    });
    expect(fragment).toContain('<title>Node Title</title>');
    expect(fragment).toContain('<title>icon label</title>'); // nested svg title preserved

    const fullDoc = buildHtmlSurfaceDocument(
      '<html><head><meta charset="utf-8"></head><body><svg><title>icon</title></svg></body></html>',
      { theme: 'dark', title: 'Doc Title' },
    );
    expect(fullDoc).toContain('<title>Doc Title</title>');
  });

  test('does not override an author-provided <title>', () => {
    const doc = buildHtmlSurfaceDocument(
      '<!doctype html><html><head><title>Author Title</title></head><body>x</body></html>',
      { theme: 'dark', title: 'Node Title' },
    );
    expect(doc).toContain('<title>Author Title</title>');
    expect(doc).not.toContain('<title>Node Title</title>');
  });

  test('omits a <title> when no title is provided', () => {
    const doc = buildHtmlSurfaceDocument('<main>x</main>', { theme: 'dark' });
    expect(doc).not.toContain('<title>');
  });

  test('escapes a title so it cannot break out of the <title> element', () => {
    const doc = buildHtmlSurfaceDocument('<main>x</main>', { theme: 'dark', title: '<script>x</script> & Co' });
    expect(doc).toContain('<title>&lt;script&gt;x&lt;/script&gt; &amp; Co</title>');
    expect(doc).not.toContain('<title><script>x</script>');
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
