interface CanvasViewportProps {
    onNodeContextMenu?: (e: MouseEvent, nodeId: string) => void;
    onCanvasContextMenu?: (e: MouseEvent, canvasX: number, canvasY: number) => void;
}
export declare function CanvasViewport({ onNodeContextMenu, onCanvasContextMenu }: CanvasViewportProps): import("preact/src").JSX.Element;
export {};
