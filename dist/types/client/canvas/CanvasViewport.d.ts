import type { CanvasNodeState } from '../types';
type AnnotationTool = 'pen' | 'eraser' | null;
interface CanvasViewportProps {
    onNodeContextMenu?: (e: MouseEvent, nodeId: string) => void;
    onCanvasContextMenu?: (e: MouseEvent, canvasX: number, canvasY: number) => void;
    annotationMode?: boolean;
    annotationTool?: AnnotationTool;
}
export declare function getRenderableWorldNodes(allNodes: Iterable<CanvasNodeState>, focusedNodeId: string | null): CanvasNodeState[];
export declare function CanvasViewport({ onNodeContextMenu, onCanvasContextMenu, annotationMode, annotationTool }: CanvasViewportProps): import("preact/src").JSX.Element;
export {};
