import type { CanvasNodeState } from '../types';
export declare const AUTO_FIT_TITLEBAR_HEIGHT = 37;
export declare const AUTO_FIT_MAX_HEIGHT = 600;
export declare const AUTO_FIT_MAX_HEIGHT_IFRAME = 1400;
/** DOM-content nodes (markdown/status/file/…) whose body scrollHeight is directly
 *  measurable — the one-shot ResizeObserver auto-fit in CanvasNode handles these. */
export declare function shouldAutoFitNode(node: CanvasNodeState): boolean;
export declare function computeAutoFitHeight(node: CanvasNodeState, contentHeight: number): number | null;
/** Iframe surfaces that should GROW to fit their reported content height. */
export declare function shouldContentFitIframeNode(node: CanvasNodeState): boolean;
/**
 * Grow-only target height from a surface-reported content height. Returns null
 * when the node is exempt, the report is non-positive, or the node already fits
 * (so it never shrinks). Callers measure the actual chrome in world pixels,
 * including zoom-compensated headers and any captions. A fixed padding allowance
 * makes a full-height viewer grow again on every content-height report.
 */
export declare function computeContentGrowHeight(node: CanvasNodeState, contentHeight: number, chromeHeight: number): number | null;
/** Keep an automatically growing card clear without moving its neighbors or
 * changing its column. Groups and screen-pinned cards retain authored placement. */
export declare function contentFitPosition(node: CanvasNodeState, height: number, allNodes: CanvasNodeState[]): CanvasNodeState['position'];
