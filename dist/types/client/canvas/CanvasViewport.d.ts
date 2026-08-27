import type { AnnotationTool, CanvasNodeState } from '../types';
interface CanvasViewportProps {
    onNodeContextMenu?: (e: MouseEvent, nodeId: string) => void;
    onEdgeContextMenu?: (e: MouseEvent, edgeId: string) => void;
    onCanvasContextMenu?: (e: MouseEvent, canvasX: number, canvasY: number) => void;
    annotationMode?: boolean;
    annotationTool?: AnnotationTool;
}
export declare function getRenderableWorldNodes(allNodes: Iterable<CanvasNodeState>, focusedNodeId: string | null, hiddenIds?: ReadonlySet<string>): CanvasNodeState[];
export declare function CanvasViewport({ onNodeContextMenu, onEdgeContextMenu, onCanvasContextMenu, annotationMode, annotationTool, }: CanvasViewportProps): import("preact/src").JSX.Element;
export {};
