import type { CanvasLayout, CanvasNodeState } from './canvas-state.js';
export interface SerializedCanvasNode extends CanvasNodeState {
    title: string | null;
    content: string | null;
    path: string | null;
    url: string | null;
}
export interface SerializedCanvasLayout extends Omit<CanvasLayout, 'nodes'> {
    nodes: SerializedCanvasNode[];
}
export declare function getCanvasNodeTitle(node: CanvasNodeState): string | null;
export declare function getCanvasNodeContent(node: CanvasNodeState): string | null;
export declare function serializeCanvasNode(node: CanvasNodeState): SerializedCanvasNode;
export declare function serializeCanvasLayout(layout: CanvasLayout): SerializedCanvasLayout;
