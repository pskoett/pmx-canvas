import { type CanvasPlacementRect } from '../shared/placement.js';
export { findOpenCanvasPosition, type CanvasPlacementRect } from '../shared/placement.js';
export declare const GROUP_PAD = 40;
export declare const GROUP_TITLEBAR_HEIGHT = 32;
/**
 * Compute bounding box for a group that should contain the given child rects.
 * Returns position and size with padding, or null if no valid children.
 */
export declare function computeGroupBounds(children: CanvasPlacementRect[], defaultWidth?: number, defaultHeight?: number): {
    x: number;
    y: number;
    width: number;
    height: number;
} | null;
export declare function computePackedGroupLayout<T extends CanvasPlacementRect & {
    id: string;
}>(children: T[]): {
    positions: Map<string, {
        x: number;
        y: number;
    }>;
    bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    } | null;
};
export declare function resolveGroupCollision(bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
}, existing: CanvasPlacementRect[]): {
    x: number;
    y: number;
};
