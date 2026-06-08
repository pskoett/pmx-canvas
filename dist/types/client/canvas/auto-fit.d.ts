import type { CanvasNodeState } from '../types';
export declare const AUTO_FIT_TITLEBAR_HEIGHT = 37;
export declare const AUTO_FIT_MAX_HEIGHT = 600;
export declare const AUTO_FIT_MAX_HEIGHT_IFRAME = 1400;
export declare const AUTO_FIT_BODY_PADDING = 24;
/** DOM-content nodes (markdown/status/file/…) whose body scrollHeight is directly
 *  measurable — the one-shot ResizeObserver auto-fit in CanvasNode handles these. */
export declare function shouldAutoFitNode(node: CanvasNodeState): boolean;
export declare function computeAutoFitHeight(node: CanvasNodeState, contentHeight: number): number | null;
/** Iframe surfaces that should GROW to fit their reported content height. */
export declare function shouldContentFitIframeNode(node: CanvasNodeState): boolean;
/**
 * Grow-only target height from a surface-reported content height. Returns null
 * when the node is exempt, the report is non-positive, or the node already fits
 * (so it never shrinks — monotonic growth can't oscillate). Adds the titlebar +
 * node-body padding so the content fully clears (no residual inner scrollbar),
 * capped at the iframe ceiling.
 */
export declare function computeContentGrowHeight(node: CanvasNodeState, contentHeight: number): number | null;
