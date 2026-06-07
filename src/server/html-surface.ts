/**
 * Server-side builder for an `html` node's standalone surface document.
 *
 * This is the canonical wrapper that used to live in the client (HtmlNode's
 * `buildSrcDoc`). It now lives on the server so a single document definition
 * backs BOTH the in-canvas iframe and the "Open as site" tab — the iframe and
 * the standalone tab load the exact same URL (/api/canvas/surface/:nodeId), so
 * there is one render path and no content fork.
 *
 * Theming: instead of inlining a token `<style>` block, the document links the
 * same-origin `/canvas/surface-theme.css` stylesheet and selects a palette via
 * the `<html data-theme="...">` attribute. A sandboxed (opaque-origin) document
 * can still load this same-origin stylesheet, and live theme switching works by
 * toggling the attribute (the theme bridge below) — no CSS payload over
 * postMessage required.
 */

export type SurfaceTheme = 'dark' | 'light' | 'high-contrast';

/** Path the surface document links for its theme tokens (served from dist/canvas). */
export const SURFACE_THEME_STYLESHEET = '/canvas/surface-theme.css';

/** CSP sandbox tokens for an `html`/`html-primitive` surface — scripts only, opaque origin. */
export const HTML_SURFACE_SANDBOX = 'allow-scripts';

export function normalizeSurfaceTheme(value: string | null | undefined): SurfaceTheme {
  return value === 'light' || value === 'high-contrast' ? value : 'dark';
}

/**
 * Restrict a caller-supplied token to a safe charset before it is embedded
 * inside an inline `<script>` string. The token is a CSRF-style nonce minted by
 * the client (shape `theme-<base36>-<base36>` / `presentation-<...>`), but it
 * arrives as a query parameter, so it must never be trusted verbatim — anything
 * outside `[A-Za-z0-9_-]` (notably `<`, `"`, backtick) could break out of the
 * script context.
 */
function sanitizeToken(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}

/**
 * Bridge that lets the parent canvas live-switch the surface theme by toggling
 * the `data-theme` attribute. Validates source + type + nonce so unrelated
 * windows cannot drive the attribute. No-op in a standalone tab (no parent
 * posts to it), which is exactly what we want there.
 */
function buildThemeBridge(themeToken: string): string {
  const token = JSON.stringify(themeToken);
  return `<script data-pmx-canvas-theme-bridge>
const PMX_CANVAS_THEME_TOKEN = ${token};
window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || message.source !== 'pmx-canvas-html-node' || message.type !== 'theme-update' || message.token !== PMX_CANVAS_THEME_TOKEN) return;
  if (typeof message.theme !== 'string') return;
  document.documentElement.setAttribute('data-pmx-canvas-theme', message.theme);
  document.documentElement.setAttribute('data-theme', message.theme);
});
</script>`;
}

/**
 * Presentation bridge (deck mode). Identical contract to the previous client
 * version: Escape posts an exit message to the parent overlay, and the parent
 * can forward slide keys back in. Only relevant when the surface is embedded in
 * the in-canvas presentation overlay; harmless (inert) in a standalone tab.
 */
function buildPresentationEscapeBridge(exitToken: string): string {
  const token = JSON.stringify(exitToken);
  return `<script data-pmx-canvas-presentation-bridge>
const PMX_CANVAS_PRESENTATION_EXIT_TOKEN = ${token};
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    window.parent.postMessage({ source: 'pmx-canvas-html-node', type: 'presentation-exit', token: PMX_CANVAS_PRESENTATION_EXIT_TOKEN }, '*');
  }
}, true);
window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || message.source !== 'pmx-canvas-html-node' || message.type !== 'presentation-key' || message.token !== PMX_CANVAS_PRESENTATION_EXIT_TOKEN) return;
  if (typeof message.key !== 'string') return;
  if (typeof window.PMX_CANVAS_PRESENTATION_HANDLE_KEY === 'function') {
    window.PMX_CANVAS_PRESENTATION_HANDLE_KEY(message.key);
    return;
  }
  document.dispatchEvent(new CustomEvent('pmx-presentation-key', { detail: { key: message.key }, bubbles: true, cancelable: true }));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: message.key, bubbles: true, cancelable: true }));
});
</script>`;
}

function injectIntoHead(html: string, content: string): string {
  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${content}`);
  }
  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${content}</head>`);
  }
  return html;
}

export interface HtmlSurfaceOptions {
  theme: SurfaceTheme;
  /** Client nonce that authorizes parent → iframe theme-update messages. */
  themeToken?: string;
  presentation?: boolean;
  presentationExitToken?: string;
}

/**
 * Wrap author HTML into a complete, themed standalone document. Accepts either a
 * full HTML document (injects into its `<head>`) or a fragment (wraps it).
 */
export function buildHtmlSurfaceDocument(userHtml: string, options: HtmlSurfaceOptions): string {
  const themeToken = sanitizeToken(options.themeToken);
  const link = `<link rel="stylesheet" href="${SURFACE_THEME_STYLESHEET}">`;
  const themeBridge = buildThemeBridge(themeToken);
  const presentationBridge = options.presentation
    ? buildPresentationEscapeBridge(sanitizeToken(options.presentationExitToken))
    : '';
  const injectedHeadContent = `${link}${themeBridge}${presentationBridge}`;
  const presentationAttr = options.presentation ? ' data-pmx-presentation-mode="present"' : '';
  const trimmed = userHtml.trim();
  const isFullDoc = /<html[\s>]/i.test(trimmed);
  if (isFullDoc) {
    const withTheme = trimmed.replace(
      /<html([^>]*)>/i,
      `<html$1 data-pmx-canvas-theme="${options.theme}" data-theme="${options.theme}"${presentationAttr}>`,
    );
    return injectIntoHead(withTheme, injectedHeadContent);
  }
  // Fragment — wrap in a full document.
  return `<!doctype html><html data-pmx-canvas-theme="${options.theme}" data-theme="${options.theme}"${presentationAttr}><head><meta charset="utf-8">${injectedHeadContent}</head><body>${userHtml}</body></html>`;
}
