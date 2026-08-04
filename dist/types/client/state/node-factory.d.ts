import type { CanvasNodeState } from '../types';
export declare const DEFAULT_POSITIONS: Record<CanvasNodeState['type'], {
    x: number;
    y: number;
    w: number;
    h: number;
}> & Record<'prompt' | 'response', {
    x: number;
    y: number;
    w: number;
    h: number;
}>;
/**
 * Build a canvas node with the shared client defaults. `position`/`size`
 * default to the type's DEFAULT_POSITIONS entry; callers that compute
 * placement (auto-placement, event-supplied geometry) pass explicit values.
 * Status nodes sit at zIndex 0 (background chrome), everything else at 1.
 */
export declare function makeNodeState(id: string, type: CanvasNodeState['type'], data: Record<string, unknown>, options?: {
    position?: {
        x: number;
        y: number;
    };
    size?: {
        width: number;
        height: number;
    };
    dockPosition?: 'left' | 'right' | null;
}): CanvasNodeState;
