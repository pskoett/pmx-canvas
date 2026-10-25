import type { CanvasNodeState } from '../types';
/** The closest node whose centre lies in `dir` from `from` (a 90° cone, weighted toward the axis). */
export declare function nearestNodeInDirection(from: CanvasNodeState, dir: {
    dx: number;
    dy: number;
}, candidates: Iterable<CanvasNodeState>): CanvasNodeState | null;
interface CanvasNodeProps {
    node: CanvasNodeState;
    children: preact.ComponentChildren;
    onContextMenu?: (e: MouseEvent, nodeId: string) => void;
}
export declare function CanvasNode({ node, children, onContextMenu }: CanvasNodeProps): import("preact/src").JSX.Element;
export {};
