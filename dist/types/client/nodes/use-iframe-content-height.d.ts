import type { CanvasNodeState } from '../types';
/**
 * Grow an iframe-surface node to fit the content height its surface reports over
 * the nonce-validated `content-height` postMessage bridge. Grow-only and gated
 * (see computeContentGrowHeight / shouldContentFitIframeNode), so it never clips,
 * never shrinks, never fights a manual resize / strictSize / docked node, and —
 * because growth is monotonic with a dead-band — cannot oscillate. This is the
 * fix for iframe nodes whose body scrollHeight the parent can't measure.
 *
 * Debounce before changing geometry, retaining the latest measurement during a
 * human grab. Read current geometry at application time; persist only this node.
 * Relocations are undoable, height-only adjustments do not fill the undo stack.
 */
export declare function useIframeContentHeight(node: CanvasNodeState, iframeRef: {
    current: HTMLIFrameElement | null;
}, frameToken: string): void;
