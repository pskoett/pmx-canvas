/**
 * Surface-side renderer for `mermaid` nodes — the entry point of the separately
 * built dist/canvas/mermaid-entry.js bundle (see package.json build:client).
 * The server (handleNodeSurface) serves a themed surface document containing the
 * HTML-escaped diagram source in `<pre class="mermaid-source">`; this script
 * reads it back via textContent, renders it to SVG, and re-renders when the
 * parent canvas live-switches the theme (the theme bridge toggles the document's
 * `data-theme` attribute). Standalone views and exports share the canvas renderer.
 */
export {};
