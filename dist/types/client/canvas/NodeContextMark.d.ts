import type { CanvasNodeState } from '../types';
export declare const GLYPHS: {
    readonly eye: "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12zM12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5";
    readonly eyeOff: "M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3 3.6M6.6 6.6C3.8 8.3 2 12 2 12s3.5 6 10 6a9.6 9.6 0 0 0 4.4-1";
    readonly spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z";
    readonly pen: "M4 20l4.2-1L19 8.2 15.8 5 5 15.8z";
    readonly warn: "M12 4l9 16H3zM12 10v4M12 17v.5";
};
/** The header chip saying what agents did with this node (one per node; glyph + word). */
export declare function NodeContextMark({ node, pinned }: {
    node: CanvasNodeState;
    pinned: boolean;
}): import("preact/src").JSX.Element | null;
/** Pinned by an agent: the violet dot on the pin badge. */
export declare function isAgentPin(nodeId: string): boolean;
/**
 * Near a pin (docs/design/NearPin.dc.html): a dotted pin-blue chip on an
 * unpinned node the brief carries as title + short summary. Weaker than "in
 * context" on purpose: the agent never gets this node's full content.
 */
export declare function NearPinMark({ node, pinned }: {
    node: CanvasNodeState;
    pinned: boolean;
}): import("preact/src").JSX.Element | null;
