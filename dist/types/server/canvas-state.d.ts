/**
 * Server-side canvas state manager.
 *
 * Maintains the authoritative node layout so that:
 * - Agent tools (Phase 3) can read/mutate canvas state
 * - Client syncs bidirectionally (SSE for server→client, POST for client→server)
 *
 * Persistence: canvas state auto-saves to `.pmx-canvas/state.json` in the
 * workspace root on every mutation (debounced). Auto-loads on `loadFromDisk()`.
 */
export declare const PMX_CANVAS_DIR = ".pmx-canvas";
export interface PersistedBlobRef {
    __pmxCanvasBlob: 'v1';
    path: string;
    sha256: string;
    encoding: 'json+gzip';
    bytes: number;
    jsonBytes: number;
}
interface PersistedCanvasState {
    version: number;
    viewport: ViewportState;
    nodes: CanvasNodeState[];
    edges: CanvasEdge[];
    annotations?: CanvasAnnotation[];
    contextPins: string[];
}
interface LoadFromDiskOptions {
    clearExisting?: boolean;
}
export declare const IMAGE_MIME_MAP: Record<string, string>;
export interface CanvasSnapshot {
    id: string;
    name: string;
    createdAt: string;
    nodeCount: number;
    edgeCount: number;
}
export interface CanvasSnapshotListOptions {
    limit?: number;
    query?: string;
    before?: string;
    after?: string;
    all?: boolean;
}
export interface CanvasSnapshotGcOptions {
    keep?: number;
    dryRun?: boolean;
}
export interface CanvasSnapshotGcResult {
    ok: boolean;
    kept: number;
    deleted: CanvasSnapshot[];
    dryRun: boolean;
}
export interface CanvasNodeState {
    id: string;
    type: 'markdown' | 'mcp-app' | 'webpage' | 'json-render' | 'graph' | 'prompt' | 'response' | 'status' | 'context' | 'ledger' | 'trace' | 'file' | 'image' | 'html' | 'group';
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
export interface CanvasAnnotationPoint {
    x: number;
    y: number;
}
export interface CanvasAnnotation {
    id: string;
    type: 'freehand' | 'text';
    points: CanvasAnnotationPoint[];
    bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    color: string;
    width: number;
    text?: string;
    label?: string;
    createdAt: string;
}
export interface CanvasLayout {
    viewport: ViewportState;
    nodes: CanvasNodeState[];
    edges: CanvasEdge[];
    annotations: CanvasAnnotation[];
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
    operationType: 'addNode' | 'updateNode' | 'removeNode' | 'addEdge' | 'removeEdge' | 'addAnnotation' | 'removeAnnotation' | 'clear' | 'restoreSnapshot' | 'setPins' | 'arrange' | 'batch' | 'groupNodes' | 'ungroupNodes' | 'viewport';
    description: string;
    forward: () => void;
    inverse: () => void;
}
interface GroupNodesOptions {
    preservePositions?: boolean;
    layout?: 'grid' | 'column' | 'flow';
    keepGroupFrame?: boolean;
}
interface ApplyUpdatesOptions {
    skipGroupChildTranslation?: boolean;
}
declare class CanvasStateManager {
    private nodes;
    private edges;
    private annotations;
    private _viewport;
    private _contextPinnedNodeIds;
    private _workspaceRoot;
    private _changeListeners;
    /** Register a listener for state changes. Used by MCP server to emit resource notifications. */
    onChange(cb: (type: CanvasChangeType) => void): void;
    private notifyChange;
    private _mutationRecorder;
    private _suppressRecordingDepth;
    /** Register a mutation recorder. Used by mutation-history to capture undo/redo closures. */
    onMutation(cb: (info: MutationRecordInfo) => void): void;
    /** Run a function with mutation recording suppressed (for undo/redo replay and computed edges). */
    withSuppressedRecording(fn: () => void): void;
    /** Create a closure that runs with recording suppressed. */
    private suppressed;
    private recordMutation;
    private applyResolvedGroupBounds;
    private getGroupSnapshot;
    private normalizeNode;
    private reflowAllGroups;
    private translateGroupChildren;
    private recomputeParentGroupBounds;
    private compactGroupChildren;
    private _stateFilePath;
    private _saveTimer;
    /** Set the workspace root to enable auto-persistence. */
    setWorkspaceRoot(workspaceRoot: string): void;
    private get blobsDir();
    private relativeBlobPath;
    private resolveBlobPath;
    private writeBlobValue;
    private readBlobValue;
    private externalizeNodeDataBlobs;
    private resolveNodeDataBlobs;
    isBlobReference(value: unknown): value is PersistedBlobRef;
    resolveBlobReference(value: unknown): unknown;
    private externalizePersistedStateBlobs;
    /**
     * One-time migration: rename files from the pre-consolidation layout
     * (`.pmx-canvas.json` + `.pmx-canvas-snapshots/`) into `.pmx-canvas/`.
     * No-op when the new layout already exists.
     */
    private migrateLegacyLayout;
    getWorkspaceRoot(): string;
    private emptyPersistedState;
    /** Load canvas state from disk. Call once on server startup. */
    loadFromDisk(options?: LoadFromDiskOptions): boolean;
    /** Debounced save — coalesces rapid mutations into a single disk write. */
    private scheduleSave;
    flushToDisk(): void;
    /** Write current state to disk immediately. */
    private saveToDisk;
    private get snapshotsDir();
    private applyPersistedState;
    private readResolvedSnapshot;
    getSnapshotDataForPersistence(idOrName: string): {
        snapshot: CanvasSnapshot;
        state: PersistedCanvasState;
    } | null;
    /** Save current canvas state as a named snapshot. */
    saveSnapshot(name: string): CanvasSnapshot | null;
    /** List saved snapshots, newest first. */
    listSnapshots(options?: CanvasSnapshotListOptions): CanvasSnapshot[];
    gcSnapshots(options?: CanvasSnapshotGcOptions): CanvasSnapshotGcResult;
    /** Restore canvas state from a snapshot. */
    restoreSnapshot(idOrName: string): boolean;
    /** Read a snapshot's data without restoring it (for diff). Resolves by ID or name. */
    getSnapshotData(idOrName: string): {
        name: string;
        nodes: CanvasNodeState[];
        edges: CanvasEdge[];
        annotations: CanvasAnnotation[];
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
    getNodeForPersistence(id: string): CanvasNodeState | undefined;
    addEdge(edge: CanvasEdge): boolean;
    removeEdge(id: string): boolean;
    getEdges(): CanvasEdge[];
    getEdgesForNode(nodeId: string): CanvasEdge[];
    addAnnotation(annotation: CanvasAnnotation): void;
    removeAnnotation(id: string): boolean;
    getAnnotations(): CanvasAnnotation[];
    private removeEdgesForNode;
    getLayout(): CanvasLayout;
    getLayoutForPersistence(): CanvasLayout;
    applyUpdates(updates: CanvasNodeUpdate[], options?: ApplyUpdatesOptions): {
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
