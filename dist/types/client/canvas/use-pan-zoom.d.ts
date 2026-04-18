import type { Signal } from '@preact/signals';
import type { ViewportState } from '../types';
interface PanZoomOptions {
    viewport: Signal<ViewportState>;
    onViewportChange: (v: ViewportState) => void;
    onViewportCommit: (v: ViewportState) => void;
}
/**
 * Hook that wires up pan/zoom interactions on a container element.
 * - Wheel + Ctrl/Cmd: zoom centered on pointer
 * - Wheel without modifier: pan
 * - Pointer drag on background: pan
 * - Pinch (touch): zoom
 */
export declare function usePanZoom({ viewport, onViewportChange, onViewportCommit }: PanZoomOptions): import("preact/src").RefObject<HTMLDivElement>;
export {};
