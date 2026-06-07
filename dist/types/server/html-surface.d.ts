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
}
/**
 * Wrap author HTML into a complete, themed standalone document. Accepts either a
 * full HTML document (injects into its `<head>`) or a fragment (wraps it).
 */
export declare function buildHtmlSurfaceDocument(userHtml: string, options: HtmlSurfaceOptions): string;
