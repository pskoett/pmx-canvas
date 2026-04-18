import type { Signal } from '@preact/signals';
import type { ViewportState } from '../types';
interface NodeDragOptions {
    nodeId: string;
    viewport: Signal<ViewportState>;
    onMove: (id: string, x: number, y: number) => void;
    onDragEnd: () => void;
}
/**
 * Hook for dragging canvas nodes by their title bar.
 * Converts screen-space pointer delta to canvas-space position delta
 * (accounting for current viewport scale).
 */
export declare function useNodeDrag({ nodeId, viewport, onMove, onDragEnd }: NodeDragOptions): (e: PointerEvent, currentX: number, currentY: number) => void;
export {};
