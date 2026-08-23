/**
 * A human create from the rail, keyboard, palette, or empty state lands
 * centred in the CURRENT viewport — where the human is looking — instead of
 * at the server's board-relative auto-placement, which on a busy board can
 * be far off-screen (the rail's Group landed out of view). Explicit x/y win.
 */
export declare function createNodeInView(opts: {
    type: string;
    title?: string;
    content?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
}): Promise<{
    ok: boolean;
    id?: string;
}>;
