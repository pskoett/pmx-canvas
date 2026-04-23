import type { Signal } from '@preact/signals';
import type { CanvasEdge, CanvasNodeState, ViewportState } from '../types';
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
export declare function Minimap({ viewport, nodes, edges, onNavigate, containerWidth, containerHeight, }: MinimapProps): import("preact/src").JSX.Element;
export {};
