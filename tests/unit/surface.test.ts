import { describe, expect, test } from 'bun:test';
import { canOpenNodeAsSurface } from '../../src/shared/surface.ts';

describe('canOpenNodeAsSurface', () => {
  test('html / json-render / graph / url-webpage are openable; bare ones are not', () => {
    expect(canOpenNodeAsSurface('html', { html: '<p>x</p>' })).toBe(true);
    expect(canOpenNodeAsSurface('html', { content: 'hi' })).toBe(true);
    expect(canOpenNodeAsSurface('html', {})).toBe(false);
    expect(canOpenNodeAsSurface('json-render', {})).toBe(true);
    expect(canOpenNodeAsSurface('graph', {})).toBe(true);
    expect(canOpenNodeAsSurface('webpage', { url: 'https://example.com' })).toBe(true);
    expect(canOpenNodeAsSurface('webpage', {})).toBe(false);
    expect(canOpenNodeAsSurface('markdown', {})).toBe(false);
  });

  test('#61: hosted ext-app mcp-app is NOT openable as a site; web-artifact + url-backed still are', () => {
    // Excalidraw and other hosted MCP apps: a live shell that needs the in-canvas host.
    expect(canOpenNodeAsSurface('mcp-app', { mode: 'ext-app', html: '<main>app</main>' })).toBe(false);
    // Bundled static web-artifact and real url-backed viewers remain openable.
    expect(canOpenNodeAsSurface('mcp-app', { viewerType: 'web-artifact', path: 'foo/bundle.html' })).toBe(true);
    expect(canOpenNodeAsSurface('mcp-app', { url: 'https://example.com/app' })).toBe(true);
    expect(canOpenNodeAsSurface('mcp-app', {})).toBe(false);
  });
});
