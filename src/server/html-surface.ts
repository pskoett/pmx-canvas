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

import { contentHeightReporterTag } from '../shared/content-height-reporter.js';

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

/**
 * Bridge that exposes `window.PMX_AX.emit(type, payload)` to author HTML. Calls
 * post a nonce-tagged message to the parent canvas, which validates the nonce +
 * node id and submits the interaction through the capability-gated endpoint. Only
 * injected when the node's AX capabilities are enabled (opt-in for `html`), and
 * the server re-validates every interaction — so this is a convenience surface,
 * not a trust boundary.
 */
export function buildAxBridge(axToken: string, nodeId: string): string {
  const token = JSON.stringify(axToken);
  const node = JSON.stringify(nodeId);
  return `<script data-pmx-canvas-ax-bridge>
const PMX_AX_TOKEN = ${token};
const PMX_AX_NODE_ID = ${node};
window.PMX_AX = window.PMX_AX || {};
window.PMX_AX.emit = function (type, payload) {
  window.parent.postMessage({
    source: 'pmx-canvas-ax',
    token: PMX_AX_TOKEN,
    nodeId: PMX_AX_NODE_ID,
    interaction: { type: String(type), payload: payload && typeof payload === 'object' ? payload : {} },
  }, '*');
};
</script>`;
}

/**
 * Read-side bridge: seeds `window.PMX_AX.state` with a snapshot of the canvas AX
 * state and keeps it live via nonce-validated `ax-update` messages from the parent
 * canvas. Author HTML can read `window.PMX_AX.state` and subscribe to the
 * `pmx-ax-update` CustomEvent to render a live work queue / focus. Injected only
 * alongside the emit bridge (AX-enabled nodes). Read-only — no capability beyond
 * the existing AX-enabled gate.
 */
export function buildAxStateBridge(axToken: string, snapshotJson: string): string {
  const token = JSON.stringify(axToken);
  return `<script data-pmx-canvas-ax-state-bridge>
(function () {
  const PMX_AX_STATE_TOKEN = ${token};
  window.PMX_AX = window.PMX_AX || {};
  window.PMX_AX.state = ${snapshotJson};
  window.addEventListener('message', function (event) {
    const m = event.data;
    if (!m || m.source !== 'pmx-canvas-html-node' || m.type !== 'ax-update' || m.token !== PMX_AX_STATE_TOKEN) return;
    window.PMX_AX.state = m.state;
    try { window.dispatchEvent(new CustomEvent('pmx-ax-update', { detail: m.state })); } catch (e) {}
  });
})();
</script>`;
}

/**
 * Reports the surface's natural content height to the parent canvas so the node
 * can GROW to fit it (the fix for iframe nodes the parent can't measure — graph,
 * json-render, html, web-artifact). Thin wrapper over the shared reporter so this
 * and the json-render injection site stay byte-identical (no drift).
 */
export function buildContentHeightReporter(frameToken: string): string {
  return contentHeightReporterTag(frameToken);
}

/** Escape a string for safe interpolation into element text (e.g. `<title>`). */
function escapeSurfaceHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface HtmlSurfaceOptions {
  theme: SurfaceTheme;
  /**
   * Tab/document title. Injected as `<title>` only when the author HTML does not
   * already declare one, so a standalone "Open as site" tab shows the node title
   * instead of falling back to the raw URL.
   */
  title?: string;
  /** Client nonce that authorizes parent → iframe theme-update messages. */
  themeToken?: string;
  presentation?: boolean;
  presentationExitToken?: string;
  /** Inject window.PMX_AX.emit (only when the node's AX capabilities are enabled). */
  axBridge?: boolean;
  /** Nonce authorizing iframe → parent AX emits; embedded in the bridge. */
  axToken?: string;
  /** Node id stamped on emitted interactions. */
  nodeId?: string;
  /**
   * Initial AX state snapshot to seed `window.PMX_AX.state` (only used when
   * axBridge is enabled). Kept live via parent → iframe `ax-update` messages.
   */
  axState?: unknown;
  /** Nonce for the content-height reporter (lets the node grow to fit content). */
  contentHeightToken?: string;
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
  const axBridge = options.axBridge
    ? buildAxBridge(sanitizeToken(options.axToken), sanitizeToken(options.nodeId))
    : '';
  // Read-side AX state bridge (seed + live push). `</` is escaped so a work-item
  // title containing "</script>" can't break out of the inline script.
  const axStateBridge = options.axBridge
    ? buildAxStateBridge(
        sanitizeToken(options.axToken),
        options.axState !== undefined ? JSON.stringify(options.axState).replace(/</g, '\\u003c') : 'null',
      )
    : '';
  const contentHeightBridge = options.contentHeightToken
    ? buildContentHeightReporter(sanitizeToken(options.contentHeightToken))
    : '';
  const injectedHeadContent = `${link}${themeBridge}${presentationBridge}${axBridge}${axStateBridge}${contentHeightBridge}`;
  const presentationAttr = options.presentation ? ' data-pmx-presentation-mode="present"' : '';
  const trimmed = userHtml.trim();
  const isFullDoc = /<html[\s>]/i.test(trimmed);
  // Only supply a fallback <title> when the author HTML does not already set a
  // DOCUMENT title. Strip inline <svg>/<math> first so a nested accessibility
  // <title> (e.g. <svg><title>…</title></svg>) doesn't suppress the fallback.
  const withoutNestedTitles = trimmed
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<math[\s\S]*?<\/math>/gi, '');
  const titleTag = options.title && !/<title[\s>]/i.test(withoutNestedTitles)
    ? `<title>${escapeSurfaceHtml(options.title)}</title>`
    : '';
  if (isFullDoc) {
    const withTheme = trimmed.replace(
      /<html([^>]*)>/i,
      `<html$1 data-pmx-canvas-theme="${options.theme}" data-theme="${options.theme}"${presentationAttr}>`,
    );
    return injectIntoHead(withTheme, `${titleTag}${injectedHeadContent}`);
  }
  // Fragment — wrap in a full document.
  return `<!doctype html><html data-pmx-canvas-theme="${options.theme}" data-theme="${options.theme}"${presentationAttr}><head><meta charset="utf-8">${titleTag}${injectedHeadContent}</head><body>${userHtml}</body></html>`;
}
