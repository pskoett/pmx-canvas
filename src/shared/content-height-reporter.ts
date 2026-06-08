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
export function sanitizeFrameToken(token: string): string {
  return token.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
}

/** Inline JS (no `<script>` wrapper) that reports content height to the parent. */
export function contentHeightReporterSource(frameToken: string): string {
  const token = JSON.stringify(sanitizeFrameToken(frameToken));
  return `(function(){var T=${token};var last=0,timer=null;`
    + `function m(){var d=document.documentElement;return Math.max(d?d.scrollHeight:0,document.body?document.body.scrollHeight:0);}`
    + `function r(){var h=m();if(Math.abs(h-last)<=4)return;last=h;window.parent.postMessage({source:'pmx-canvas-frame',type:'content-height',token:T,height:h},'*');}`
    + `function s(){if(timer)return;timer=setTimeout(function(){timer=null;r();},100);}`
    + `if(document.readyState!=='loading')s();window.addEventListener('load',s);`
    + `try{new ResizeObserver(s).observe(document.documentElement);}catch(e){}setTimeout(s,60);})();`;
}

/** `<script>`-wrapped reporter for injection into an HTML `<head>` / document. */
export function contentHeightReporterTag(frameToken: string): string {
  return `<script data-pmx-canvas-content-height>${contentHeightReporterSource(frameToken)}</script>`;
}
