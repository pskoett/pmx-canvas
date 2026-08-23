/**
 * Scope fence geometry shared by the server's enforcement and the client's
 * rendering so both draw the same box: the bounding box of the fenced nodes
 * plus `padding` px. Null when none of the fenced nodes exist.
 */
export interface FenceRect {
    x: number;
    y: number;
    width: number;
    height: number;
}
export declare function fenceRectFromNodes(nodes: Iterable<{
    position: {
        x: number;
        y: number;
    };
    size: {
        width: number;
        height: number;
    };
}>, padding: number): FenceRect | null;
