export interface CanvasPlacementRect {
    position: {
        x: number;
        y: number;
    };
    size: {
        width: number;
        height: number;
    };
}
export declare function rectsOverlap(a: {
    x: number;
    y: number;
}, aw: number, ah: number, b: CanvasPlacementRect, gap: number): boolean;
export declare function overlapsAny(pos: {
    x: number;
    y: number;
}, width: number, height: number, existing: CanvasPlacementRect[], gap: number): boolean;
export declare function findBlocker(pos: {
    x: number;
    y: number;
}, width: number, height: number, existing: CanvasPlacementRect[], gap: number): CanvasPlacementRect | undefined;
export declare function findOpenCanvasPosition(existing: CanvasPlacementRect[], width: number, height: number, gap?: number): {
    x: number;
    y: number;
};
