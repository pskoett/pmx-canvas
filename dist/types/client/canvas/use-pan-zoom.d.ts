import type { Signal } from '@preact/signals';
import type { ViewportState } from '../types';
interface PanZoomOptions {
    viewport: Signal<ViewportState>;
    onViewportChange: (v: ViewportState) => void;
    onViewportCommit: (v: ViewportState) => void;
    onBackgroundContextMenu?: (e: MouseEvent, worldX: number, worldY: number) => void;
    onEdgeContextMenu?: (e: MouseEvent, edgeId: string) => void;
    disabled?: boolean;
}
/**
 * Hook that wires up pan/zoom interactions on a container element.
 * - Wheel + Ctrl/Cmd: zoom centered on pointer
 * - Wheel without modifier: pan
 * - Right or middle pointer drag: pan from anywhere
 * - Right-click on background: creation menu on release, unless dragged
 * - Pointer drag on background in pan mode: pan
 * - Pinch (touch): zoom
 */
export declare function usePanZoom({ viewport, onViewportChange, onViewportCommit, onBackgroundContextMenu, onEdgeContextMenu, disabled, }: PanZoomOptions): import("preact/src").RefObject<HTMLDivElement>;
export {};
