import { type CanvasAnnotation, type CanvasEdge, type CanvasLayout, type CanvasNodeState, type ConnectionStatus, type ViewportState } from '../types';
export declare const viewport: import("@preact/signals-core").Signal<ViewportState>;
export declare const nodes: import("@preact/signals-core").Signal<Map<string, CanvasNodeState>>;
export declare const edges: import("@preact/signals-core").Signal<Map<string, CanvasEdge>>;
export declare const annotations: import("@preact/signals-core").Signal<Map<string, CanvasAnnotation>>;
export declare const activeNodeId: import("@preact/signals-core").Signal<string | null>;
export declare const connectionStatus: import("@preact/signals-core").Signal<ConnectionStatus>;
export declare const workbenchConnectionEpoch: import("@preact/signals-core").Signal<number>;
/**
 * Degraded-connection detail (rail-chrome-v2 phase 7, design item 14):
 * the reconnect attempt and the delay before the next try while the stream is
 * down. Both reset to 0 when a transport is back.
 */
export declare const reconnectAttempt: import("@preact/signals-core").Signal<number>;
export declare const reconnectDelay: import("@preact/signals-core").Signal<number>;
export declare const sessionId: import("@preact/signals-core").Signal<string>;
export declare const traceEnabled: import("@preact/signals-core").Signal<boolean>;
export declare const canvasTheme: import("@preact/signals-core").Signal<string>;
export declare const hasInitialServerLayout: import("@preact/signals-core").Signal<boolean>;
export declare const axSurfaceState: import("@preact/signals-core").Signal<unknown>;
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
export type CanvasTool = 'select' | 'pan';
export declare const canvasTool: import("@preact/signals-core").Signal<CanvasTool>;
/** Held-Space temporary pan — same semantics as the pan tool while held. */
export declare const spacePanHeld: import("@preact/signals-core").Signal<boolean>;
export declare function isPanModeActive(): boolean;
export declare function getNeighborNodeIds(nodeId: string | null, edgeMap: Map<string, CanvasEdge>): Set<string>;
export declare const activeNeighborNodeIds: import("@preact/signals-core").ReadonlySignal<Set<string>>;
export declare function toggleSelected(id: string): void;
export declare function selectNodes(ids: string[]): void;
export declare function clearSelection(): void;
/**
 * Membership feedback while a node is being dragged: the group it would join
 * on release (`add`), or the parent it would leave (`remove`). Membership
 * changes ONLY on release while this is set — never silently by geometry.
 * Esc during the drag clears it and keeps it cleared for that drag.
 */
export declare const dragDropTarget: import("@preact/signals-core").Signal<{
    nodeId: string;
    groupId: string;
    mode: "add" | "remove";
} | null>;
export declare function suppressDropForDrag(): void;
export declare function endDropTracking(): void;
/**
 * Called on every drag move of `nodeId`: updates the drop target and grows a
 * fit-mode parent frame live so a child dragged against it never clips
 * (the server re-fits on persist; shrinking happens there).
 */
export declare function trackDragMembership(nodeId: string): void;
/** Children of collapsed groups are hidden; edges to them point at the chip. */
export declare const hiddenByCollapsedGroup: import("@preact/signals-core").ReadonlySignal<Map<string, string>>;
/** The node that stands in for `id` on the canvas: itself, or its collapsed group's chip. */
export declare function visibleNodeFor(id: string): CanvasNodeState | undefined;
/** Collapsed groups render as a chip; children keep their positions for restore. */
export declare function groupsOfSelection(): string[];
export declare function alignSelection(edge: 'left' | 'top'): void;
/** Even horizontal gaps between the selected nodes, first and last staying put. */
export declare function distributeSelection(): void;
/** Grid the selection in reading order from its own top-left corner. */
export declare function arrangeSelection(gap?: number): void;
export declare function getSelectedNodes(): CanvasNodeState[];
export declare function toggleContextPin(id: string): void;
export declare function addContextPins(ids: string[]): void;
export declare function clearContextPins(): void;
export declare function replaceContextPinsFromServer(ids: string[]): void;
export declare function addNode(node: CanvasNodeState): void;
export declare function updateNode(id: string, patch: Partial<CanvasNodeState>): void;
export declare function updateNodeData(id: string, dataPatch: Record<string, unknown>): void;
export declare function removeNode(id: string): void;
export declare function addEdge(edge: CanvasEdge): void;
export declare function removeEdge(id: string): void;
export declare function removeEdgesForNode(nodeId: string): void;
export declare function addAnnotation(annotation: CanvasAnnotation): void;
export declare function removeAnnotation(id: string): void;
export declare function createAnnotationFromClient(input: {
    type?: CanvasAnnotation['type'];
    points: CanvasAnnotation['points'];
    color: string;
    width: number;
    text?: string;
    label?: string;
}): Promise<{
    ok: boolean;
}>;
export declare function removeAnnotationFromClient(id: string): Promise<{
    ok: boolean;
}>;
export declare function resizeNode(id: string, size: {
    width: number;
    height: number;
}): void;
export declare function bringToFront(id: string): void;
export declare function toggleCollapsed(id: string): void;
export declare function setViewport(v: Partial<ViewportState>): void;
export declare function replaceViewport(next: ViewportState): void;
export declare function commitViewport(next: ViewportState): void;
export declare function applyServerCanvasLayout(layout: Pick<CanvasLayout, 'nodes' | 'edges'> & {
    viewport?: ViewportState;
    annotations?: CanvasAnnotation[];
}, options?: {
    applyViewport?: boolean;
}): void;
/**
 * Smoothly animate the viewport to a target state.
 * Cancels any in-flight animation. Direct manipulation (pan/zoom gestures)
 * should use setViewport() instead for instant response.
 */
/**
 * Zoom by a factor about the CENTRE of the viewport.
 *
 * The toolbar's +/- used to change `scale` alone and keep `x`/`y`, which anchors
 * the zoom at the world origin — so zooming in visibly slid the board up-left and
 * zooming out pushed it down-right, instead of magnifying what you were looking
 * at. Same correction the pointer-anchored wheel zoom applies, with the viewport
 * centre as the anchor.
 */
export declare function zoomByFactor(factor: number, duration?: number): void;
export declare function animateViewport(target: ViewportState, duration?: number, options?: {
    recordHistory?: boolean;
}): void;
/** Cancel any in-flight viewport animation (e.g. when user starts dragging). */
export declare function cancelViewportAnimation(): void;
export declare function persistLayout(options?: {
    recordHistory?: boolean;
}): void;
export declare function restoreLayout(): Map<string, Partial<CanvasNodeState>> | null;
export declare function fitAll(containerW: number, containerH: number): void;
export declare function focusNode(id: string, options?: {
    recordHistory?: boolean;
}): void;
export declare function cycleActiveNode(direction?: 1 | -1): void;
export declare function walkGraph(direction: 'up' | 'down' | 'left' | 'right'): void;
export declare function expandNode(id: string): void;
export declare function collapseExpandedNode(): void;
export declare function autoArrange(): void;
export declare function forceDirectedArrange(): void;
