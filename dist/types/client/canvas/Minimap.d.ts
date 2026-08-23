import type { Signal } from '@preact/signals';
import type { CanvasEdge, CanvasNodeState, ViewportState } from '../types';
/**
 * Minimap v2 (rail-chrome-v2 phase 7, design item 19): a true-scale node map
 * rendered from the store — each node a scaled rect in its kind color, groups
 * and the scope fence as dashed outlines, the viewport frame with a grab
 * cursor, the zoom % in the corner, selection outlines mirrored, and a pulsing
 * violet dot where an attached agent is. 168×112 at rest; hovering magnifies
 * the whole map ×1.7 from the bottom-right corner (CSS). Click jumps the
 * viewport; dragging pans.
 */
export declare const MINIMAP_W = 168;
export declare const MINIMAP_H = 112;
interface MinimapBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}
interface MinimapFrame {
    bounds: MinimapBounds;
    scale: number;
}
export declare function computeMinimapFrame(nodeMap: Map<string, CanvasNodeState>, currentViewport: ViewportState, containerWidth: number, containerHeight: number): MinimapFrame;
interface MinimapProps {
    viewport: Signal<ViewportState>;
    nodes: Signal<Map<string, CanvasNodeState>>;
    edges: Signal<Map<string, CanvasEdge>>;
    onNavigate: (x: number, y: number) => void;
    containerWidth: number;
    containerHeight: number;
}
export declare function Minimap({ viewport, nodes, onNavigate, containerWidth, containerHeight }: MinimapProps): import("preact/jsx-runtime").JSX.Element;
export {};
