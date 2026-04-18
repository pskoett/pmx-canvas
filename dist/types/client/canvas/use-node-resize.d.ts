import type { Signal } from '@preact/signals';
import type { ViewportState } from '../types';
interface NodeResizeOptions {
    nodeId: string;
    viewport: Signal<ViewportState>;
    onResize: (id: string, width: number, height: number) => void;
    onResizeEnd: () => void;
}
/**
 * Hook for resizing canvas nodes via a corner drag handle.
 * Converts screen-space pointer delta to canvas-space size delta
 * (accounting for current viewport scale).
 */
export declare function useNodeResize({ nodeId, viewport, onResize, onResizeEnd }: NodeResizeOptions): (e: PointerEvent, currentWidth: number, currentHeight: number) => void;
export {};
