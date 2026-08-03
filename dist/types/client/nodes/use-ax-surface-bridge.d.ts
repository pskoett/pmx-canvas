import type { RefObject } from 'preact';
/** Sandboxed surfaces that emit through this bridge (clamped to their own node server-side). */
export type AxSurfaceBridgeSurface = 'json-render' | 'html-node' | 'mcp-app';
/**
 * The sandboxed-surface AX trust boundary, single-sited (plan-009 M2; the
 * listener was copy-pasted across HtmlNode, McpAppNode, and ExtAppFrame — a
 * prior near-miss lived exactly in that duplication). Receives a
 * `window.PMX_AX.emit(...)` message from THIS node's iframe, validates the
 * event source against the live contentWindow plus the per-mount nonce token
 * and node id, submits the interaction through the capability-gated endpoint
 * (the server re-validates capabilities and clamps sandboxed surfaces to their
 * own node), and acks the result back so the surface can self-confirm (#55).
 */
export declare function useAxSurfaceBridge(options: {
    enabled: boolean;
    token: string;
    nodeId: string;
    sourceSurface: AxSurfaceBridgeSurface;
    iframeRef: RefObject<HTMLIFrameElement>;
}): void;
