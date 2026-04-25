import { type CanvasEdge, type CanvasLayout, type CanvasNodeState, type ConnectionStatus, type ViewportState } from '../types';
export declare const viewport: import("@preact/signals-core").Signal<ViewportState>;
export declare const nodes: import("@preact/signals-core").Signal<Map<string, CanvasNodeState>>;
export declare const edges: import("@preact/signals-core").Signal<Map<string, CanvasEdge>>;
export declare const activeNodeId: import("@preact/signals-core").Signal<string | null>;
export declare const connectionStatus: import("@preact/signals-core").Signal<ConnectionStatus>;
export declare const sessionId: import("@preact/signals-core").Signal<string>;
export declare const traceEnabled: import("@preact/signals-core").Signal<boolean>;
export declare const canvasTheme: import("@preact/signals-core").Signal<string>;
export declare const hasInitialServerLayout: import("@preact/signals-core").Signal<boolean>;
export declare const expandedNodeId: import("@preact/signals-core").Signal<string | null>;
export declare const pendingExpandedNodeCloseId: import("@preact/signals-core").Signal<string | null>;
export declare const pendingConnection: import("@preact/signals-core").Signal<{
    from: string;
} | null>;
export declare const draggingEdge: import("@preact/signals-core").Signal<{
    fromId: string;
    fromX: number;
    fromY: number;
    cursorX: number;
    cursorY: number;
} | null>;
export declare const searchHighlightIds: import("@preact/signals-core").Signal<Set<string> | null>;
export declare const selectedNodeIds: import("@preact/signals-core").Signal<Set<string>>;
export declare const contextPinnedNodeIds: import("@preact/signals-core").Signal<Set<string>>;
export declare function getNeighborNodeIds(nodeId: string | null, edgeMap: Map<string, CanvasEdge>): Set<string>;
export declare const activeNeighborNodeIds: import("@preact/signals-core").ReadonlySignal<Set<string>>;
export declare function toggleSelected(id: string): void;
export declare function selectNodes(ids: string[]): void;
export declare function clearSelection(): void;
export declare function getSelectedNodes(): CanvasNodeState[];
export declare function toggleContextPin(id: string): void;
export declare function addContextPins(ids: string[]): void;
export declare function clearContextPins(): void;
export declare function replaceContextPinsFromServer(ids: string[]): void;
export declare function getContextPinnedNodes(): CanvasNodeState[];
export declare function addNode(node: CanvasNodeState): void;
export declare function updateNode(id: string, patch: Partial<CanvasNodeState>): void;
export declare function updateNodeData(id: string, dataPatch: Record<string, unknown>): void;
export declare function removeNode(id: string): void;
export declare function addEdge(edge: CanvasEdge): void;
export declare function removeEdge(id: string): void;
export declare function removeEdgesForNode(nodeId: string): void;
export declare function resizeNode(id: string, size: {
    width: number;
    height: number;
}): void;
export declare function bringToFront(id: string): void;
export declare function toggleCollapsed(id: string): void;
export declare function dockNode(id: string, position: 'left' | 'right'): void;
export declare function undockNode(id: string): void;
export declare function setViewport(v: Partial<ViewportState>): void;
export declare function replaceViewport(next: ViewportState): void;
export declare function commitViewport(next: ViewportState): void;
export declare function applyServerCanvasLayout(layout: Pick<CanvasLayout, 'nodes' | 'edges'> & {
    viewport?: ViewportState;
}): void;
/**
 * Smoothly animate the viewport to a target state.
 * Cancels any in-flight animation. Direct manipulation (pan/zoom gestures)
 * should use setViewport() instead for instant response.
 */
export declare function animateViewport(target: ViewportState, duration?: number): void;
/** Cancel any in-flight viewport animation (e.g. when user starts dragging). */
export declare function cancelViewportAnimation(): void;
export declare function persistLayout(): void;
export declare function restoreLayout(): Map<string, Partial<CanvasNodeState>> | null;
export declare function fitAll(containerW: number, containerH: number): void;
export declare function focusNode(id: string): void;
export declare function cycleActiveNode(direction?: 1 | -1): void;
export declare function walkGraph(direction: 'up' | 'down' | 'left' | 'right'): void;
export declare function expandNode(id: string): void;
export declare function collapseExpandedNode(): void;
export declare function autoArrange(): void;
export declare function forceDirectedArrange(): void;
