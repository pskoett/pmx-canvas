import type { Signal } from '@preact/signals';
import type { CanvasEdge, CanvasNodeState, ViewportState } from '../types';
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
