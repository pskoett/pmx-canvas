import type { ComponentChildren } from 'preact';
import { type CanvasNodeState } from '../types';
export declare const GLYPHS: {
    readonly eye: "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12zM12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5";
    readonly eyeOff: "M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3 3.6M6.6 6.6C3.8 8.3 2 12 2 12s3.5 6 10 6a9.6 9.6 0 0 0 4.4-1";
    readonly spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z";
    readonly pen: "M4 20l4.2-1L19 8.2 15.8 5 5 15.8z";
    readonly warn: "M12 4l9 16H3zM12 10v4M12 17v.5";
};
/**
 * The agent's byline (docs/design/HeaderMarks.dc.html): authorship, not state,
 * so it never takes a chip — a violet sparkle on the type icon, its words in
 * the icon's hint. A person's edit ends it (decided 2026-10-05).
 */
export declare function bylineFor(node: CanvasNodeState): string | null;
/** How a header chip shows: its word, only its glyph, or folded into the type icon's hint. */
export type ChipFold = 'word' | 'glyph' | 'hidden';
/**
 * The one state chip a header carries — near a pin (unpinned) or the read
 * state (pinned) — with what it says when folded into the icon's hint. Never
 * other cards' titles: at rest a node must not contain them.
 */
export declare function headerChip(node: CanvasNodeState, pinned: boolean): {
    amber: boolean;
    folded: string;
} | null;
/** A pinned node's read-state chip: glyph + word, or only the glyph when the title needs the room. */
export declare function NodeContextMark({ node, pinned, fold, }: {
    node: CanvasNodeState;
    pinned: boolean;
    fold?: ChipFold;
}): import("preact").JSX.Element | null;
/**
 * The type icon, with the agent's sparkle when an agent wrote the node, and
 * one hint that holds the full title, the byline and any folded chip.
 */
export declare function NodeTypeIcon({ node, pinned, title, fold, children, }: {
    node: CanvasNodeState;
    pinned: boolean;
    title: string;
    fold: ChipFold;
    children: ComponentChildren;
}): import("preact").JSX.Element;
/** Pinned by an agent: the violet dot on the pin badge. */
export declare function isAgentPin(nodeId: string): boolean;
/**
 * Near a pin (docs/design/NearPin.dc.html): a dotted pin-blue chip on an
 * unpinned node the brief carries as title + short summary. Weaker than "in
 * context" on purpose: the agent sees it only because a pin is nearby. Hover,
 * focus or tap opens its card (`NearPinCard`, §2); it previews while dragged,
 * pulses once on a drop inside and fades on a drop outside (§3).
 */
export declare function NearPinMark({ node, pinned, fold, }: {
    node: CanvasNodeState;
    pinned: boolean;
    fold?: ChipFold;
}): import("preact").JSX.Element | null;
/** The viewport as a key: the card closes when it changes. */
export declare function viewKey(): string;
