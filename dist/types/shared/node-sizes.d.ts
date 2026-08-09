/**
 * Per-type minimum node size — the readability floor.
 *
 * Agents frequently create nodes with explicit frames far too small for their
 * content (clipped markdown, charts squeezed behind inner scrollbars), so the
 * server clamps undersized explicit sizes UP at creation and `validate` reports
 * anything below the floor.
 *
 * This lives in `shared/` because BOTH sides must honor it. The 0.4.6 report's
 * Finding AA: the server clamped a 200x100 markdown node up to 360x180, and
 * then the browser's DOM auto-fit measured the (short) content and persisted
 * 360x132 — undoing the guarantee on the most common path, a connected
 * workbench. A floor only one side knows about is not a floor.
 *
 * `strictSize: true` is the escape hatch for a deliberately small fixed frame,
 * and it exempts a node from both the creation clamp and the auto-fit floor.
 * Types absent from the table are intentionally unclamped — `trace` is small by
 * design, `group` sizes to its children.
 */
export declare const NODE_MIN_SIZES: Record<string, {
    width: number;
    height: number;
}>;
/** The readability floor for a node type, or undefined when it has none. */
export declare function nodeMinSize(type: string): {
    width: number;
    height: number;
} | undefined;
/** Creation-time clamp: an explicit size below the floor is raised to it. */
export declare function clampCreateNodeSize(type: string, width: number, height: number, strictSize?: boolean): {
    width: number;
    height: number;
};
