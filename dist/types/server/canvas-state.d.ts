/**
 * Server-side canvas state manager.
 *
 * Maintains the authoritative node layout so that:
 * - Agent tools (Phase 3) can read/mutate canvas state
 * - Client syncs bidirectionally (SSE for server→client, POST for client→server)
 *
 * Persistence: canvas state auto-saves to `.pmx-canvas/canvas.db` (SQLite WAL mode)
 * in the workspace root on every mutation (debounced). Auto-loads on `loadFromDisk()`.
 * Legacy `.pmx-canvas/state.json` is auto-migrated on first boot.
 */
import { type PersistedCanvasState, type CanvasTheme, type AxTimelineQuery } from './canvas-db.js';
import { type PmxAxActivityKind, type PmxAxElicitation, type PmxAxModeRequest, type PmxAxMode, type PmxAxCommandDescriptor, type PmxAxPolicy, type PmxAxFocusState, type PmxAxSource, type PmxAxState, type PmxAxWorkItem, type PmxAxWorkItemStatus, type PmxAxApprovalGate, type PmxAxReviewAnnotation, type PmxAxReviewKind, type PmxAxReviewSeverity, type PmxAxReviewStatus, type PmxAxReviewAnchorType, type PmxAxReviewRegion, type PmxAxEvent, type PmxAxEventKind, type PmxAxEvidence, type PmxAxEvidenceKind, type PmxAxSteeringMessage, type PmxAxHostCapability, type PmxAxTimelineSummary } from './ax-state.js';
export declare const PMX_CANVAS_DIR = ".pmx-canvas";
export interface PersistedBlobRef {
    __pmxCanvasBlob: 'v1';
    path: string;
    sha256: string;
    encoding: 'json+gzip';
    bytes: number;
    jsonBytes: number;
}
export type { PersistedCanvasState } from './canvas-db.js';
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
    theme: CanvasTheme;
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
export type CanvasChangeType = 'pins' | 'nodes' | 'ax' | 'ax-timeline';
export interface MutationRecordInfo {
    operationType: 'addNode' | 'updateNode' | 'removeNode' | 'addEdge' | 'removeEdge' | 'addAnnotation' | 'removeAnnotation' | 'clear' | 'restoreSnapshot' | 'setPins' | 'setAxFocus' | 'addWorkItem' | 'updateWorkItem' | 'requestApproval' | 'resolveApproval' | 'addReviewAnnotation' | 'updateReviewAnnotation' | 'requestElicitation' | 'respondElicitation' | 'requestMode' | 'resolveModeRequest' | 'setPolicy' | 'arrange' | 'batch' | 'groupNodes' | 'ungroupNodes' | 'viewport';
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
    private _theme;
    private _contextPinnedNodeIds;
    private _axState;
    private _axHostCapability;
    private _workspaceRoot;
    private _changeListeners;
    /**
     * Register a listener for state changes. Used by MCP server to emit resource
     * notifications and by the blocking-wait endpoints to await an AX transition.
     * Returns a disposer that unregisters the listener (callers that don't need it
     * — e.g. the long-lived MCP subscription — may ignore the return value).
     */
    onChange(cb: (type: CanvasChangeType) => void): () => void;
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
    private currentNodeIdSet;
    private normalizeAxForCurrentNodes;
    private applyAxState;
    private applyResolvedGroupBounds;
    private getGroupSnapshot;
    private normalizeNode;
    private nodeForRead;
    private reflowAllGroups;
    private translateGroupChildren;
    private recomputeParentGroupBounds;
    private compactGroupChildren;
    private _stateFilePath;
    private _db;
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
    /**
     * One-time migration: import state.json + snapshot JSON files + blob files
     * into the SQLite database. Renames originals to `.bak`.
     */
    private migrateJsonToSqlite;
    getWorkspaceRoot(): string;
    private emptyPersistedState;
    /** Load canvas state from SQLite (or legacy JSON fallback). Call once on server startup. */
    loadFromDisk(options?: LoadFromDiskOptions): boolean;
    /**
     * Whether this workspace's canvas DB already holds saved state. Used to gate
     * brand-new-workspace seeding (e.g. the default docked status/context widgets)
     * so we never add nodes to a canvas that already has content. Reflects the
     * pre-run persisted flag until the next save.
     */
    hasPersistedState(): boolean;
    /** Debounced save — coalesces rapid mutations into a single write. */
    private scheduleSave;
    flushToDisk(): void;
    /** Write current state to SQLite immediately. */
    private saveToDisk;
    /** Close the SQLite database cleanly. Call on server shutdown. */
    close(): void;
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
    /** Remove all snapshots from the DB. Used by test teardown. */
    clearAllSnapshots(): void;
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
    get theme(): CanvasTheme;
    setTheme(theme: CanvasTheme): CanvasTheme;
    get contextPinnedNodeIds(): Set<string>;
    getAxState(): PmxAxState;
    getAxFocus(): PmxAxFocusState;
    setAxFocus(nodeIds: string[], options?: {
        source?: PmxAxSource;
        recordHistory?: boolean;
    }): PmxAxFocusState;
    clearAxFocus(): PmxAxFocusState;
    getWorkItems(): PmxAxWorkItem[];
    addWorkItem(input: {
        title: string;
        status?: PmxAxWorkItemStatus;
        detail?: string | null;
        nodeIds?: string[];
    }, options?: {
        source?: PmxAxSource;
    }): PmxAxWorkItem;
    updateWorkItem(id: string, patch: {
        title?: string;
        status?: PmxAxWorkItemStatus;
        detail?: string | null;
        nodeIds?: string[];
    }, options?: {
        source?: PmxAxSource;
    }): PmxAxWorkItem | null;
    getApprovalGates(): PmxAxApprovalGate[];
    requestApproval(input: {
        title: string;
        detail?: string | null;
        action?: string | null;
        nodeIds?: string[];
    }, options?: {
        source?: PmxAxSource;
    }): PmxAxApprovalGate;
    resolveApproval(id: string, decision: 'approved' | 'rejected', options?: {
        resolution?: string;
        source?: PmxAxSource;
    }): PmxAxApprovalGate | null;
    getReviewAnnotations(): PmxAxReviewAnnotation[];
    addReviewAnnotation(input: {
        body: string;
        kind?: PmxAxReviewKind;
        severity?: PmxAxReviewSeverity;
        anchorType?: PmxAxReviewAnchorType;
        nodeId?: string | null;
        file?: string | null;
        region?: PmxAxReviewRegion | null;
        author?: string | null;
    }, options?: {
        source?: PmxAxSource;
    }): PmxAxReviewAnnotation | null;
    updateReviewAnnotation(id: string, patch: {
        body?: string;
        status?: PmxAxReviewStatus;
        severity?: PmxAxReviewSeverity;
        kind?: PmxAxReviewKind;
    }, options?: {
        source?: PmxAxSource;
    }): PmxAxReviewAnnotation | null;
    getHostCapability(): PmxAxHostCapability | null;
    getElicitations(): PmxAxElicitation[];
    requestElicitation(input: {
        prompt: string;
        fields?: string[];
        nodeIds?: string[];
    }, options?: {
        source?: PmxAxSource;
    }): PmxAxElicitation;
    respondElicitation(id: string, response: Record<string, unknown>, options?: {
        source?: PmxAxSource;
    }): PmxAxElicitation | null;
    getModeRequests(): PmxAxModeRequest[];
    requestMode(input: {
        mode: PmxAxMode;
        reason?: string | null;
        nodeIds?: string[];
    }, options?: {
        source?: PmxAxSource;
    }): PmxAxModeRequest;
    resolveModeRequest(id: string, decision: 'approved' | 'rejected', options?: {
        resolution?: string;
        source?: PmxAxSource;
    }): PmxAxModeRequest | null;
    getApproval(id: string): PmxAxApprovalGate | null;
    getElicitation(id: string): PmxAxElicitation | null;
    getModeRequest(id: string): PmxAxModeRequest | null;
    getCommandRegistry(): PmxAxCommandDescriptor[];
    /** Invoke a registry-gated PMX command intent — records a timeline event (no execution). */
    invokeCommand(name: string, args?: Record<string, unknown> | null, options?: {
        source?: PmxAxSource;
    }): PmxAxEvent | null;
    getPolicy(): PmxAxPolicy;
    /** Merge a declarative tool/prompt policy patch (canvas-bound, snapshotted). */
    setPolicy(patch: {
        tools?: Partial<PmxAxPolicy['tools']>;
        prompt?: Partial<PmxAxPolicy['prompt']>;
    }, _options?: {
        source?: PmxAxSource;
    }): PmxAxPolicy;
    setHostCapability(input: unknown, _options?: {
        source?: PmxAxSource;
    }): PmxAxHostCapability;
    recordAxEvent(input: {
        kind: PmxAxEventKind;
        summary: string;
        detail?: string | null;
        nodeIds?: string[];
        data?: Record<string, unknown> | null;
    }, options?: {
        source?: PmxAxSource;
    }): PmxAxEvent;
    addEvidence(input: {
        kind: PmxAxEvidenceKind;
        title: string;
        body?: string | null;
        ref?: string | null;
        nodeIds?: string[];
        data?: Record<string, unknown> | null;
    }, options?: {
        source?: PmxAxSource;
    }): PmxAxEvidence;
    recordSteeringMessage(message: string, options?: {
        source?: PmxAxSource;
    }): PmxAxSteeringMessage;
    markSteeringDelivered(id: string): boolean;
    /**
     * Ingest a normalized agent activity (a tool/session event a harness forwards)
     * and apply kind-driven board reactions, so the agent's real work flows back into
     * the board without it remembering to push each item (report primitive A — makes
     * AX bidirectional). Always records a timeline event; then, unless the caller
     * overrides/suppresses via `reactions`, applies defaults by kind/outcome:
     *   • failure | error | outcome==='failure' → work item (blocked) + review
     *     (finding/error, anchored to a valid nodeId else the `ref` file) + evidence (logs)
     *   • tool-result + outcome==='success'      → evidence (tool-result)
     *   • everything else (tool-start, session-*, command, note) → event only
     * A reaction value of `false` suppresses it; an object overrides its fields/forces it on.
     */
    ingestActivity(input: {
        kind: PmxAxActivityKind;
        title: string;
        summary?: string | null;
        outcome?: 'success' | 'failure';
        ref?: string | null;
        nodeIds?: string[];
        data?: Record<string, unknown> | null;
        reactions?: {
            workItem?: false | {
                status?: PmxAxWorkItemStatus;
                detail?: string | null;
            };
            evidence?: false | {
                kind?: PmxAxEvidenceKind;
                body?: string | null;
            };
            review?: false | {
                severity?: PmxAxReviewSeverity;
                kind?: PmxAxReviewKind;
                anchorType?: PmxAxReviewAnchorType;
                nodeId?: string | null;
            };
        };
    }, options?: {
        source?: PmxAxSource;
    }): {
        event: PmxAxEvent;
        workItem: PmxAxWorkItem | null;
        evidence: PmxAxEvidence | null;
        review: PmxAxReviewAnnotation | null;
    };
    getAxEvents(q?: AxTimelineQuery): PmxAxEvent[];
    getAxEvidence(q?: AxTimelineQuery): PmxAxEvidence[];
    getAxSteering(q?: AxTimelineQuery & {
        onlyPending?: boolean;
    }): PmxAxSteeringMessage[];
    /**
     * Undelivered steering for a consumer (Phase 4 delivery). Excludes messages
     * whose source equals the consumer to prevent delivery loops (e.g. Copilot
     * should not be handed back steering it originated).
     */
    getPendingSteering(options?: {
        consumer?: string;
        limit?: number;
    }): PmxAxSteeringMessage[];
    getAxTimelineSummary(): PmxAxTimelineSummary;
    getAxTimeline(q?: AxTimelineQuery): {
        events: PmxAxEvent[];
        evidence: PmxAxEvidence[];
        steering: PmxAxSteeringMessage[];
        summary: PmxAxTimelineSummary;
    };
    setContextPins(nodeIds: string[]): void;
    clearContextPins(): void;
    /** Move child nodes into a group. Sets data.parentGroup on children and data.children on the group. */
    groupNodes(groupId: string, childIds: string[], options?: GroupNodesOptions): boolean;
    /** Remove all children from a group, clearing their parentGroup. */
    ungroupNodes(groupId: string): boolean;
    clear(): void;
}
export declare const canvasState: CanvasStateManager;
