/**
 * Content-height reporter — injected into iframe-backed canvas surfaces so the
 * parent canvas can grow the node to fit its content (the #48 graph-clipping fix).
 *
 * The surface posts its natural `document` scrollHeight to `window.parent` over a
 * nonce-validated channel; the parent (use-iframe-content-height) grows the node
 * grow-only to fit. Debounced (~100ms) + dead-banded (>4px) so a stray re-measure
 * can't spam, and grow-only growth on the parent side cannot oscillate.
 *
 * Shared by both injection sites — src/server/html-surface.ts (html / web-artifact
 * surfaces) and src/json-render/server.ts (the json-render/graph viewer) — so the
 * two stay byte-identical. This module is framework-agnostic and imports nothing
 * from src/server, preserving the json-render package's decoupling.
 */
/** Sanitize a nonce for safe interpolation into an inline script literal. */
export declare function sanitizeFrameToken(token: string): string;
/** Inline JS (no `<script>` wrapper) that reports content height to the parent. */
export declare function contentHeightReporterSource(frameToken: string): string;
/** `<script>`-wrapped reporter for injection into an HTML `<head>` / document. */
export declare function contentHeightReporterTag(frameToken: string): string;
