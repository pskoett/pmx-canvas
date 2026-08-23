import type { CanvasNodeState } from '../types';
/** The closest node whose centre lies in `dir` from `from` (a 90° cone, weighted toward the axis). */
export declare function nearestNodeInDirection(from: CanvasNodeState, dir: {
    dx: number;
    dy: number;
}, candidates: Iterable<CanvasNodeState>): CanvasNodeState | null;
/**
 * How much to enlarge node chrome (title bar, badges, icons) when zoomed out so
 * it stays legible. Full inverse compensation is capped at 2.2x — but the cap
 * alone ignored the node it is drawn on, so on SHORT nodes the growing bar ate
 * the body: a 116px-tall section label at 46% zoom gave the title bar 72% of the
 * node and left 14px for text that needed 41, so the markdown was simply cut off.
 * The scale is therefore also bounded by the node's own height, keeping the bar
 * under MAX_TITLEBAR_HEIGHT_RATIO of it. Tall nodes are unaffected (their height
 * never binds); pass height 0 for collapsed/auto-height nodes to skip the bound.
 */
export declare function nodeChromeScale(viewportScale: number, nodeHeight: number, nodeWidth?: number): number;
interface CanvasNodeProps {
    node: CanvasNodeState;
    children: preact.ComponentChildren;
    onContextMenu?: (e: MouseEvent, nodeId: string) => void;
}
export declare function CanvasNode({ node, children, onContextMenu }: CanvasNodeProps): import("preact/src").JSX.Element;
export {};
