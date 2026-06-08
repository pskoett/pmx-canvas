import type { CanvasNodeState } from '../types';
/**
 * Stable content hash (djb2) used to cache-bust the surface iframe `src` when a
 * node's HTML changes. The server always serves current state, but a same `src`
 * string won't reload the iframe on its own — bumping `?v=` does.
 */
export declare function surfaceContentHash(input: string): string;
export interface SurfaceUrlOptions {
    theme?: string;
    themeToken?: string;
    present?: boolean;
    presentToken?: string;
    v?: string;
    /** Nonce authorizing iframe → parent AX emits (html bridge). */
    axToken?: string;
    /** Nonce for the content-height reporter (node grows to fit content). */
    frameToken?: string;
}
/** Build the stable per-node surface URL (/api/canvas/surface/:id) the iframe and "Open as site" both use. */
export declare function nodeSurfaceUrl(nodeId: string, opts?: SurfaceUrlOptions): string;
/** Whether a node can be opened as a standalone site (shared with the server). */
export declare function canOpenAsSite(node: CanvasNodeState): boolean;
/**
 * Open the node's standalone surface in the user's system browser. Falls back to
 * `window.open` when the server cannot launch a browser, preserving in-browser tests
 * and headless/disabled-browser environments.
 */
export declare function openNodeAsSite(node: CanvasNodeState): Promise<void>;
