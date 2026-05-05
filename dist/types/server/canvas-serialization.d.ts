import type { CanvasAnnotation, CanvasLayout, CanvasNodeState, ViewportState } from './canvas-state.js';
import { type CanvasNodeProvenance } from './canvas-provenance.js';
export interface SerializedCanvasNode extends CanvasNodeState {
    kind: string;
    title: string | null;
    content: string | null;
    path: string | null;
    url: string | null;
    provenance: CanvasNodeProvenance | null;
}
export interface SerializedCanvasLayout extends Omit<CanvasLayout, 'nodes'> {
    nodes: SerializedCanvasNode[];
}
export interface CanvasAnnotationSummary {
    id: string;
    type: CanvasAnnotation['type'];
    bounds: CanvasAnnotation['bounds'];
    color: string;
    width: number;
    pointCount: number;
    label: string | null;
    createdAt: string;
}
export interface CanvasAnnotationContextSummary {
    id: string;
    label: string | null;
    bounds: CanvasAnnotation['bounds'];
    targetNodeIds: string[];
    targetNodeTitles: string[];
    target: string;
}
export declare function getCanvasNodeKind(node: CanvasNodeState, data: Record<string, unknown>): string;
export declare function getCanvasNodeTitle(node: CanvasNodeState): string | null;
export declare function getCanvasNodeContent(node: CanvasNodeState): string | null;
export declare function serializeCanvasNode(node: CanvasNodeState): SerializedCanvasNode;
export declare function serializeCanvasNodeForAgent(node: CanvasNodeState): SerializedCanvasNode;
export declare function serializeCanvasNodeWithBlobSummaries(node: CanvasNodeState): SerializedCanvasNode;
export declare function serializeCanvasLayout(layout: CanvasLayout): SerializedCanvasLayout;
export declare function serializeCanvasLayoutForAgent(layout: CanvasLayout): SerializedCanvasLayout;
export declare function serializeCanvasLayoutWithBlobSummaries(layout: CanvasLayout): SerializedCanvasLayout;
export declare function summarizeCanvasAnnotation(annotation: CanvasAnnotation): CanvasAnnotationSummary;
export declare function summarizeCanvasAnnotationForContext(annotation: CanvasAnnotation, nodes: CanvasNodeState[]): CanvasAnnotationContextSummary;
export interface CanvasSummary {
    totalNodes: number;
    totalEdges: number;
    totalAnnotations: number;
    annotations: CanvasAnnotationContextSummary[];
    nodesByType: Record<string, number>;
    pinnedCount: number;
    pinnedTitles: string[];
    viewport: ViewportState;
}
export declare function buildCanvasSummary(): CanvasSummary;
