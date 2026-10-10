/**
 * Which pin? (docs/design/NearPin.dc.html §2): for a hovered, selected or
 * dragged pin — or the pins a near chip asked to show — dotted tethers to its
 * neighbours, numbered nearest first, and the 600 px radius. Drawn in screen
 * space (architecture rule 9) so they stay legible at fit zoom; while an
 * unpinned node is dragged only the nearest pin's radius shows (§3).
 */
export declare function NearPinLayer(): import("preact/jsx-runtime").JSX.Element | null;
/**
 * Hover a near chip (docs/design/NearPin.dc.html §2): which pins, how far, and
 * the two ways on — pin it to put it first, or show the pins' tethers.
 */
export declare function NearPinCard(): import("preact/jsx-runtime").JSX.Element | null;
