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
}
/** Build the stable per-node surface URL (/api/canvas/surface/:id) the iframe and "Open as site" both use. */
export declare function nodeSurfaceUrl(nodeId: string, opts?: SurfaceUrlOptions): string;
/** Whether a node can be opened as a standalone site (shared with the server). */
export declare function canOpenAsSite(node: CanvasNodeState): boolean;
/** Open the node's surface in a new browser tab. */
export declare function openNodeAsSite(node: CanvasNodeState): void;
/**
 * Open the node's surface in the user's real SYSTEM browser via the server's OS
 * launcher — for hosts (e.g. Codex) whose embedded browser makes a normal
 * `_blank` tab feel in-place. Falls back to a normal new-tab open when the server
 * can't launch (headless / PMX_CANVAS_DISABLE_BROWSER_OPEN).
 */
export declare function openNodeInSystemBrowser(node: CanvasNodeState): Promise<void>;
