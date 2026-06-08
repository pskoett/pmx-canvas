import type { CanvasNodeState } from '../types';

export const AUTO_FIT_TITLEBAR_HEIGHT = 37;
export const AUTO_FIT_MAX_HEIGHT = 600;
// Iframe surfaces (charts/dashboards/rich html) can legitimately need more room
// than a text node, so they grow to a higher ceiling before scrolling.
export const AUTO_FIT_MAX_HEIGHT_IFRAME = 1400;
// `.node-body` adds 12px padding top+bottom around an iframe surface (global.css).
// The bridge reports the iframe's OWN document scrollHeight, so the grow target
// must add titlebar + this body padding or the node settles ~24px short and the
// surface shows a residual inner scrollbar. (The DOM auto-fit above doesn't need
// this: body.scrollHeight already includes the body's padding.)
export const AUTO_FIT_BODY_PADDING = 24;

/** Node types the DOM auto-fit can't measure: iframe-backed surfaces (html/
 *  json-render/graph/mcp-app), where the body's scrollHeight equals the iframe
 *  height (circular), and webpage (its card uses a bounded flex/overflow layout,
 *  so auto-fit was already a no-op). Iframe surfaces are sized by the content-
 *  height bridge (use-iframe-content-height) instead; webpage intentionally
 *  scrolls. Excluding them from the DOM path is behaviour-neutral. */
function isIframeNode(node: CanvasNodeState): boolean {
  return node.type === 'html'
    || node.type === 'json-render'
    || node.type === 'graph'
    || node.type === 'mcp-app'
    || node.type === 'webpage';
}

/** Authored iframe surfaces whose content has a bounded natural height — they may
 *  grow to fit it. Excludes presentation decks, hosted ext-apps, and URL/webpage
 *  viewers (unbounded/scrolling content that must not drive node height). */
function isContentFitSurface(node: CanvasNodeState): boolean {
  if (node.type === 'html') return node.data.presentation !== true;
  if (node.type === 'json-render' || node.type === 'graph') return true;
  if (node.type === 'mcp-app') return node.data.viewerType === 'web-artifact';
  return false;
}

/** Shared exemptions: never auto-size a node the user/agent has fixed or a node
 *  whose height is controlled elsewhere. */
function isAutoSizeExempt(node: CanvasNodeState): boolean {
  return node.collapsed === true
    || node.dockPosition != null
    || node.data.strictSize === true
    || node.data.userResized === true
    || node.type === 'group';
}

/** DOM-content nodes (markdown/status/file/…) whose body scrollHeight is directly
 *  measurable — the one-shot ResizeObserver auto-fit in CanvasNode handles these. */
export function shouldAutoFitNode(node: CanvasNodeState): boolean {
  return !isAutoSizeExempt(node) && !isIframeNode(node);
}

export function computeAutoFitHeight(node: CanvasNodeState, contentHeight: number): number | null {
  if (!shouldAutoFitNode(node) || contentHeight <= 0) return null;
  return Math.min(contentHeight + AUTO_FIT_TITLEBAR_HEIGHT, AUTO_FIT_MAX_HEIGHT);
}

/** Iframe surfaces that should GROW to fit their reported content height. */
export function shouldContentFitIframeNode(node: CanvasNodeState): boolean {
  return isContentFitSurface(node) && !isAutoSizeExempt(node);
}

/**
 * Grow-only target height from a surface-reported content height. Returns null
 * when the node is exempt, the report is non-positive, or the node already fits
 * (so it never shrinks — monotonic growth can't oscillate). Adds the titlebar +
 * node-body padding so the content fully clears (no residual inner scrollbar),
 * capped at the iframe ceiling.
 */
export function computeContentGrowHeight(node: CanvasNodeState, contentHeight: number): number | null {
  if (!shouldContentFitIframeNode(node) || contentHeight <= 0) return null;
  const want = Math.min(
    contentHeight + AUTO_FIT_TITLEBAR_HEIGHT + AUTO_FIT_BODY_PADDING,
    AUTO_FIT_MAX_HEIGHT_IFRAME,
  );
  return want > node.size.height + 8 ? want : null;
}
