import type { CanvasNodeState } from '../types';
/**
 * Image node renderer.
 * Supports: file paths (served via /api/canvas/image/:nodeId), data URIs, and URLs.
 * Features: fit-to-container, zoom in/out within node, pan when zoomed.
 */
export declare function ImageNode({ node, expanded, }: {
    node: CanvasNodeState;
    expanded?: boolean;
}): import("preact/src").JSX.Element;
