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
export declare const SURFACE_THEME_STYLESHEET = "/canvas/surface-theme.css";
/** CSP sandbox tokens for an `html`/`html-primitive` surface — scripts only, opaque origin. */
export declare const HTML_SURFACE_SANDBOX = "allow-scripts";
export declare function normalizeSurfaceTheme(value: string | null | undefined): SurfaceTheme;
/**
 * Bridge that exposes `window.PMX_AX.emit(type, payload)` to author HTML. Calls
 * post a nonce-tagged message to the parent canvas, which validates the nonce +
 * node id and submits the interaction through the capability-gated endpoint. Only
 * injected when the node's AX capabilities are enabled (opt-in for `html`), and
 * the server re-validates every interaction — so this is a convenience surface,
 * not a trust boundary.
 *
 * `emit` returns a Promise that resolves with the interaction result once the
 * parent acks it (report #55 — built-in confirmation so a click no longer looks
 * like "nothing happened"). Authors can also `window.PMX_AX.on('ack', cb)` or
 * listen for the `pmx-ax-ack` CustomEvent. Resolves with an `ax-ack-timeout`
 * result after 10s if no ack arrives (e.g. an older parent), so `await emit()`
 * never hangs.
 */
export declare function buildAxBridge(axToken: string, nodeId: string): string;
/**
 * Read-side bridge: seeds `window.PMX_AX.state` with a snapshot of the canvas AX
 * state and keeps it live via nonce-validated `ax-update` messages from the parent
 * canvas. Author HTML can read `window.PMX_AX.state` and subscribe to the
 * `pmx-ax-update` CustomEvent to render a live work queue / focus. Injected only
 * alongside the emit bridge (AX-enabled nodes). Read-only — no capability beyond
 * the existing AX-enabled gate.
 */
export declare function buildAxStateBridge(axToken: string, snapshotJson: string): string;
/**
 * Reports the surface's natural content height to the parent canvas so the node
 * can GROW to fit it (the fix for iframe nodes the parent can't measure — graph,
 * json-render, html, web-artifact). Thin wrapper over the shared reporter so this
 * and the json-render injection site stay byte-identical (no drift).
 */
export declare function buildContentHeightReporter(frameToken: string): string;
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
export declare function buildHtmlSurfaceDocument(userHtml: string, options: HtmlSurfaceOptions): string;
