import type { CanvasLayout, CanvasNodeState, ViewportState } from './canvas-state.js';
import { type CanvasNodeProvenance } from './canvas-provenance.js';
export interface SerializedCanvasNode extends CanvasNodeState {
    title: string | null;
    content: string | null;
    path: string | null;
    url: string | null;
    provenance: CanvasNodeProvenance | null;
}
export interface SerializedCanvasLayout extends Omit<CanvasLayout, 'nodes'> {
    nodes: SerializedCanvasNode[];
}
export declare function getCanvasNodeTitle(node: CanvasNodeState): string | null;
export declare function getCanvasNodeContent(node: CanvasNodeState): string | null;
export declare function serializeCanvasNode(node: CanvasNodeState): SerializedCanvasNode;
export declare function serializeCanvasLayout(layout: CanvasLayout): SerializedCanvasLayout;
export interface CanvasSummary {
    totalNodes: number;
    totalEdges: number;
    nodesByType: Record<string, number>;
    pinnedCount: number;
    pinnedTitles: string[];
    viewport: ViewportState;
}
export declare function buildCanvasSummary(): CanvasSummary;
