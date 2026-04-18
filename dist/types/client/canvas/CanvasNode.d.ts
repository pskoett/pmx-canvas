import type { CanvasNodeState } from '../types';
interface CanvasNodeProps {
    node: CanvasNodeState;
    children: preact.ComponentChildren;
    onContextMenu?: (e: MouseEvent, nodeId: string) => void;
}
export declare function CanvasNode({ node, children, onContextMenu }: CanvasNodeProps): import("preact/src").JSX.Element;
export {};
