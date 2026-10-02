import type { CanvasNodeState, CanvasNodeUpdate } from './canvas-state.js';
/** Flat fields take precedence over nested aliases; absent axes remain absent. */
export declare function resolveCreateGeometry(body: Record<string, unknown>): {
    x: number | undefined;
    y: number | undefined;
    width: number | undefined;
    height: number | undefined;
};
/** Guards and PATCH execution must resolve aliases and single-axis moves identically. */
export declare function resolvePatchGeometry(body: Record<string, unknown>, existing: CanvasNodeState): {
    size?: {
        width: number;
        height: number;
    } | undefined;
    position?: {
        x: number;
        y: number;
    } | undefined;
};
export declare function validateCanvasNodePatch(patch: {
    position?: unknown;
    size?: unknown;
}): string | null;
/** Invalid patches cannot count as explicit child-position overrides. */
export declare function validCanvasNodeUpdates(input: unknown): CanvasNodeUpdate[];
