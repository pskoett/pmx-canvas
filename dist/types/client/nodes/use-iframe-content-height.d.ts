import type { CanvasNodeState } from '../types';
/**
 * Grow an iframe-surface node to fit the content height its surface reports over
 * the nonce-validated `content-height` postMessage bridge. Grow-only and gated
 * (see computeContentGrowHeight / shouldContentFitIframeNode), so it never clips,
 * never shrinks, never fights a manual resize / strictSize / docked node, and —
 * because growth is monotonic with a dead-band — cannot oscillate. This is the
 * fix for iframe nodes whose body scrollHeight the parent can't measure.
 *
 * The latest node is read through a ref so the effect stays mounted across the
 * grow (its deps are only id + token). Putting node.size in the deps would re-run
 * the effect on each grow and its cleanup would cancel the pending persist.
 */
export declare function useIframeContentHeight(node: CanvasNodeState, iframeRef: {
    current: HTMLIFrameElement | null;
}, frameToken: string): void;
