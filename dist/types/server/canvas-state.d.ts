/**
 * Server-side canvas state manager.
 *
 * Maintains the authoritative node layout so that:
 * - Agent tools (Phase 3) can read/mutate canvas state
 * - Client syncs bidirectionally (SSE for server→client, POST for client→server)
 *
 * Persistence: canvas state auto-saves to `.pmx-canvas.json` in the workspace
 * root on every mutation (debounced). Auto-loads on `loadFromDisk()`.
 */
export declare const IMAGE_MIME_MAP: Record<string, string>;
export interface CanvasSnapshot {
    id: string;
    name: string;
    createdAt: string;
    nodeCount: number;
    edgeCount: number;
}
export interface CanvasNodeState {
    id: string;
    type: 'markdown' | 'mcp-app' | 'webpage' | 'json-render' | 'graph' | 'prompt' | 'response' | 'status' | 'context' | 'ledger' | 'trace' | 'file' | 'image' | 'group';
    position: {
        x: number;
        y: number;
    };
    size: {
        width: number;
        height: number;
    };
    zIndex: number;
    collapsed: boolean;
    pinned: boolean;
    dockPosition: 'left' | 'right' | null;
    data: Record<string, unknown>;
}
export interface ViewportState {
    x: number;
    y: number;
    scale: number;
}
export interface CanvasEdge {
    id: string;
    from: string;
    to: string;
    type: 'relation' | 'depends-on' | 'flow' | 'references';
    label?: string;
    style?: 'solid' | 'dashed' | 'dotted';
    animated?: boolean;
}
export interface CanvasLayout {
    viewport: ViewportState;
    nodes: CanvasNodeState[];
    edges: CanvasEdge[];
}
export interface CanvasNodeUpdate {
    id: string;
    position?: {
        x: number;
        y: number;
    };
    size?: {
        width: number;
        height: number;
    };
    collapsed?: boolean;
    dockPosition?: 'left' | 'right' | null;
}
export type CanvasChangeType = 'pins' | 'nodes';
export interface MutationRecordInfo {
    operationType: 'addNode' | 'updateNode' | 'removeNode' | 'addEdge' | 'removeEdge' | 'clear' | 'setPins' | 'arrange' | 'batch' | 'groupNodes' | 'ungroupNodes' | 'viewport';
    description: string;
    forward: () => void;
    inverse: () => void;
}
interface GroupNodesOptions {
    preservePositions?: boolean;
    layout?: 'grid' | 'column' | 'flow';
    keepGroupFrame?: boolean;
}
declare class CanvasStateManager {
    private nodes;
    private edges;
    private _viewport;
    private _contextPinnedNodeIds;
    private _workspaceRoot;
    private _changeListeners;
    /** Register a listener for state changes. Used by MCP server to emit resource notifications. */
    onChange(cb: (type: CanvasChangeType) => void): void;
    private notifyChange;
    private _mutationRecorder;
    private _suppressRecording;
    /** Register a mutation recorder. Used by mutation-history to capture undo/redo closures. */
    onMutation(cb: (info: MutationRecordInfo) => void): void;
    /** Run a function with mutation recording suppressed (for undo/redo replay and computed edges). */
    withSuppressedRecording(fn: () => void): void;
    /** Create a closure that runs with recording suppressed. */
    private suppressed;
    private recordMutation;
    private applyResolvedGroupBounds;
    private getGroupSnapshot;
    private reflowAllGroups;
    private recomputeParentGroupBounds;
    private compactGroupChildren;
    private _stateFilePath;
    private _saveTimer;
    /** Set the workspace root to enable auto-persistence. */
    setWorkspaceRoot(workspaceRoot: string): void;
    getWorkspaceRoot(): string;
    /** Load canvas state from disk. Call once on server startup. */
    loadFromDisk(): boolean;
    /** Debounced save — coalesces rapid mutations into a single disk write. */
    private scheduleSave;
    /** Write current state to disk immediately. */
    private saveToDisk;
    private get snapshotsDir();
    /** Save current canvas state as a named snapshot. */
    saveSnapshot(name: string): CanvasSnapshot | null;
    /** List all saved snapshots. */
    listSnapshots(): CanvasSnapshot[];
    /** Restore canvas state from a snapshot. */
    restoreSnapshot(id: string): boolean;
    /** Read a snapshot's data without restoring it (for diff). Resolves by ID or name. */
    getSnapshotData(idOrName: string): {
        name: string;
        nodes: CanvasNodeState[];
        edges: CanvasEdge[];
    } | null;
    /** Delete a snapshot. */
    deleteSnapshot(id: string): boolean;
    get viewport(): ViewportState;
    addNode(node: CanvasNodeState): void;
    addJsonRenderNode(node: CanvasNodeState): void;
    addGraphNode(node: CanvasNodeState): void;
    updateNode(id: string, patch: Partial<CanvasNodeState>): void;
    removeNode(id: string): void;
    getNode(id: string): CanvasNodeState | undefined;
    addEdge(edge: CanvasEdge): boolean;
    removeEdge(id: string): boolean;
    getEdges(): CanvasEdge[];
    getEdgesForNode(nodeId: string): CanvasEdge[];
    private removeEdgesForNode;
    getLayout(): CanvasLayout;
    applyUpdates(updates: CanvasNodeUpdate[]): {
        applied: number;
        skipped: number;
    };
    setViewport(v: Partial<ViewportState>): void;
    get contextPinnedNodeIds(): Set<string>;
    setContextPins(nodeIds: string[]): void;
    clearContextPins(): void;
    /** Move child nodes into a group. Sets data.parentGroup on children and data.children on the group. */
    groupNodes(groupId: string, childIds: string[], options?: GroupNodesOptions): boolean;
    /** Remove all children from a group, clearing their parentGroup. */
    ungroupNodes(groupId: string): boolean;
    clear(): void;
}
export declare const canvasState: CanvasStateManager;
export {};
