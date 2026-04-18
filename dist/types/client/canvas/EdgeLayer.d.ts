import type { Signal } from '@preact/signals';
import type { CanvasEdge, CanvasNodeState } from '../types';
interface EdgeLayerProps {
    nodes: Signal<Map<string, CanvasNodeState>>;
    edges: Signal<Map<string, CanvasEdge>>;
}
export declare function EdgeLayer({ nodes, edges }: EdgeLayerProps): import("preact/src").JSX.Element | null;
export {};
