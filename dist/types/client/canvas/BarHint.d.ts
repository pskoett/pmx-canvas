import type { ComponentChildren } from 'preact';
/**
 * Styled hover/focus tooltip for bar controls — the replacement for native
 * `title` hints, which are delay-gated and never render in embedded panes.
 */
export declare function BarHint({ label, shortcut, body, align, side, tapToOpen, fitWithin, children, }: {
    label: string;
    shortcut?: string;
    /** One or two plain sentences under the label — the explanation a native `title` used to hide. */
    body?: string;
    align?: 'start' | 'center' | 'end';
    /** Which way the tooltip opens. Bars at the bottom of the region open 'up'. */
    side?: 'down' | 'up';
    /**
     * Informational (non-button) content: a click/focus opens the tooltip, so
     * surfaces that do not forward hover (embedded panes, touch) still reach
     * the explanation. Never for action buttons — their tooltips must dismiss
     * after the click, not linger on focus.
     */
    tapToOpen?: boolean;
    /**
     * The clipping box to stay inside (a CSS selector for an ancestor). As the
     * tooltip opens it takes whichever of end/start alignment fits — a node
     * header chip sits anywhere along a card that clips its contents.
     */
    fitWithin?: string;
    children: ComponentChildren;
}): import("preact").JSX.Element;
