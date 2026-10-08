import { EventEmitter } from 'node:events';
import { type Camera, type Tour, type TourStop } from '../shared/tour.js';
import { type TourStep, type TourStepResult } from './tour-control.js';
export type { Tour, TourStop } from '../shared/tour.js';
export type { TourStep, TourStepResult } from './tour-control.js';
import type { AgentPhase, AgentPresence, AgentPresenceSnapshot } from '../shared/agent-presence.js';
import { canvasState } from './canvas-state.js';
import type { CanvasAnnotation, CanvasNodeState, CanvasEdge, CanvasLayout } from './canvas-state.js';
import { type AxInteractionInput, type AxInteractionPublicResult } from './ax-interaction.js';
import type { PmxAxIntent } from '../shared/ax-intent.js';
import type { PmxAxActivityKind, PmxAxApprovalGate, PmxAxCommandDescriptor, PmxAxContext, PmxAxElicitation, PmxAxEvent, PmxAxEvidence, PmxAxEvidenceKind, PmxAxFocusState, PmxAxHostCapability, PmxAxMode, PmxAxModeRequest, PmxAxPolicy, PmxAxReviewAnchorType, PmxAxReviewAnnotation, PmxAxReviewKind, PmxAxReviewRegion, PmxAxReviewSeverity, PmxAxReviewStatus, PmxAxSource, PmxAxState, PmxAxSteeringMessage, PmxAxWorkItem, PmxAxWorkItemStatus } from './ax-state.js';
import type { AxTimelineQuery, CanvasBoard } from './canvas-db.js';
import type { Attachment, DocumentImport, ImportSection } from './document-import.js';
import type { BackupFile, BackupStatus } from './backup.js';
import type { ExportManifest } from './board-export.js';
import { searchNodes } from './spatial-analysis.js';
import { diffLayouts } from './mutation-history.js';
import { fitCanvasView, gcCanvasSnapshots, listCanvasSnapshots } from './canvas-operations.js';
import { type OpenMcpAppCoreResult } from './operations/index.js';
import { type SerializedCanvasNode } from './canvas-serialization.js';
import type { HtmlPrimitiveKind } from './html-primitives.js';
import { type WebArtifactBuildInput, type WebArtifactCanvasBuildResult } from './web-artifacts.js';
import { type ExternalMcpTransportConfig } from './mcp-app-runtime.js';
import type { DiagramPresetOpenInput } from './diagram-presets.js';
import { type GraphNodeInput, type JsonRenderNodeInput, type JsonRenderSpec } from '../json-render/server.js';
import type { CanvasAutomationWebViewOptions, CanvasAutomationWebViewStatus } from './server.js';
/**
 * Node object returned by the SDK's create/get methods. It is the fully
 * serialized node (adds `surfaceUrl`, `kind`, `title`, `content`, …) plus a
 * `nodeId` alias for `id`, so the SDK return shape matches the HTTP/CLI
 * `node`-create responses field-for-field.
 */
export type SdkCanvasNode = SerializedCanvasNode & {
    nodeId: string;
};
export declare class PmxCanvas extends EventEmitter {
    private _port;
    private _server;
    constructor(options?: {
        port?: number;
    });
    private runIntentCommit;
    private runIntentCommitInner;
    start(options?: {
        open?: boolean;
        automationWebView?: boolean | CanvasAutomationWebViewOptions;
        /** Embedded startup must not launch external MCP backends from saved nodes. */
        allowExternalMcp?: boolean;
        /**
         * Bind a nearby free port when the preferred one is taken instead of
         * failing. Default false (an explicit SDK port is honored exactly); the
         * MCP auto-start opts in so a daemon already on the port can't crash it.
         */
        allowPortFallback?: boolean;
    }): Promise<void>;
    stop(): void;
    /**
     * Add a node to the canvas and return the created node (including its `id`,
     * resolved geometry, and data). Destructure `const { id } = canvas.addNode(...)`
     * or keep the whole node — both work. (Previously returned a bare id string.)
     */
    addNode(input: {
        intentId?: string;
        type: CanvasNodeState['type'];
        title?: string;
        content?: string;
        children?: string[];
        childIds?: string[];
        childLayout?: 'grid' | 'column' | 'flow';
        color?: string;
        toolName?: string;
        category?: string;
        status?: string;
        duration?: string;
        resultSummary?: string;
        error?: string;
        x?: number;
        y?: number;
        width?: number;
        height?: number;
        strictSize?: boolean;
    }): SdkCanvasNode;
    addWebpageNode(input: {
        intentId?: string;
        title?: string;
        url: string;
        x?: number;
        y?: number;
        width?: number;
        height?: number;
        strictSize?: boolean;
    }): Promise<{
        ok: boolean;
        id: string;
        error?: string;
        fetch: {
            ok: boolean;
            error?: string;
        };
    }>;
    refreshWebpageNode(id: string, url?: string): Promise<{
        ok: boolean;
        id: string;
        error?: string;
    }>;
    updateNode(id: string, patch: Partial<CanvasNodeState> & Record<string, unknown>): void;
    /** Remove a node. Missing id throws (plan-005 unifies this across surfaces). */
    removeNode(id: string, options?: {
        intentId?: string;
    }): void;
    addEdge(input: {
        intentId?: string;
        from?: string;
        to?: string;
        fromSearch?: string;
        toSearch?: string;
        type: CanvasEdge['type'];
        label?: string;
        style?: CanvasEdge['style'];
        animated?: boolean;
    }): string;
    addAnnotation(input: Omit<CanvasAnnotation, 'id' | 'createdAt'> & {
        id?: string;
        createdAt?: string;
    }): string;
    removeAnnotation(id: string): boolean;
    removeEdge(id: string): void;
    /**
     * Create a group node and optionally add child nodes to it.
     * If childIds are provided, the group auto-sizes to contain them with padding.
     */
    createGroup(input: {
        intentId?: string;
        title?: string;
        childIds?: string[];
        x?: number;
        y?: number;
        width?: number;
        height?: number;
        color?: string;
        childLayout?: 'grid' | 'column' | 'flow';
    }): string;
    /** Add nodes to an existing group. */
    groupNodes(groupId: string, childIds: string[], options?: {
        childLayout?: 'grid' | 'column' | 'flow';
        intentId?: string;
    }): boolean;
    /** Dissolve a group: children released (into the enclosing group when nested), frame removed — one undo step. */
    ungroupNodes(groupId: string, options?: {
        intentId?: string;
    }): boolean;
    getTour(): Tour;
    setTour(tour: Tour | null): void;
    /** Present a tour stop (index, `next` or `previous`) in the workbench. Not recorded in undo history. */
    goToTourStop(step: TourStep, options?: {
        present?: boolean;
    }): TourStepResult;
    /** Leave presentation in every viewer. */
    exitTour(): void;
    /** Ease the camera to a node, world rect or viewport. Not recorded in undo history. */
    moveCamera(stop: TourStop): {
        viewport: Camera;
    };
    clear(): void;
    arrange(layout?: 'grid' | 'column' | 'flow'): void;
    focusNode(id: string, options?: {
        noPan?: boolean;
    }): {
        focused: string;
        panned: boolean;
    } | null;
    getAxState(): PmxAxState;
    getAxContext(options?: {
        consumer?: string;
    }): PmxAxContext & {
        boardId: string | null;
    };
    setAxFocus(nodeIds: string[], options?: {
        source?: PmxAxSource;
    }): PmxAxFocusState;
    recordAxEvent(input: {
        kind: PmxAxEvent['kind'];
        summary: string;
        detail?: string | null;
        nodeIds?: string[];
        data?: Record<string, unknown> | null;
    }, options?: {
        source?: PmxAxSource;
        agentId?: string | null;
    }): PmxAxEvent;
    sendSteering(message: string, options?: {
        source?: PmxAxSource;
        agentId?: string | null;
        target?: string | null;
    }): PmxAxSteeringMessage;
    markSteeringDelivered(id: string, consumer?: string | null): boolean;
    /**
     * Ghost Cursor of Intent — announce a spatial move before making it. The ghost
     * is ephemeral presence (auto-expiring, never snapshotted); the registry emits
     * the `ax-intent` SSE frame so the browser paints a pre-commit placeholder.
     */
    signalIntent(input: Record<string, unknown>): PmxAxIntent;
    updateIntent(id: string, patch: Record<string, unknown>): PmxAxIntent;
    /** Dissolve a ghost; pass `settledNodeId` once the real node has landed. */
    clearIntent(id: string, options?: {
        settledNodeId?: string;
        vetoed?: boolean;
    }): boolean;
    /** Undelivered steering for a consumer (loop-safe; excludes consumer-originated). */
    getPendingSteering(options?: {
        consumer?: string;
        limit?: number;
    }): PmxAxSteeringMessage[];
    /**
     * Submit a node-originated AX interaction (plan-004 Phase 1). Validates the
     * envelope + node capabilities, maps the interaction onto the matching AX
     * operation, and emits the outcome + state SSE events.
     */
    submitAxInteraction(input: AxInteractionInput, options?: {
        source?: PmxAxSource;
    }): AxInteractionPublicResult;
    getAxTimeline(query?: AxTimelineQuery): ReturnType<typeof canvasState.getAxTimeline>;
    listBoards(): {
        activeBoardId: string | null;
        boards: CanvasBoard[];
    };
    listImports(boardId?: string): DocumentImport[];
    readImport(id: string): {
        import: DocumentImport;
        attachment: Attachment;
        downloadPath: string;
        bytes?: Uint8Array;
    } | null;
    submitImport(id: string, sections: ImportSection[], agentDescription: string, warnings?: string[]): Promise<DocumentImport>;
    markImportUnavailable(id: string, reason: string): Promise<DocumentImport>;
    attachDocument(input: {
        boardId: string;
        name: string;
        mime?: string;
        bytes: Uint8Array;
        x?: number;
        y?: number;
    }): {
        attachment: Attachment;
        import: DocumentImport;
        nodeId: string;
    };
    requestImport(id: string, consent: true, trustedHumanToken: string): Promise<DocumentImport>;
    cancelImport(id: string, trustedHumanToken: string): Promise<DocumentImport>;
    commitImport(id: string, trustedHumanToken: string): Promise<{
        import: DocumentImport;
        nodeIds: string[];
    }>;
    createBoard(name: string, category?: string): Promise<CanvasBoard>;
    /** Rename a board and/or file it under a category (`category: null` removes it). */
    updateBoard(id: string, patch: {
        name?: string;
        category?: string | null;
    }): Promise<void>;
    setBoardReadme(id: string, readmeNodeId: string | null): Promise<void>;
    /** Pin a board into the agent's working set (its README and pinned cards reach every brief). */
    pinBoard(id: string, reason?: string): Promise<void>;
    unpinBoard(id: string): Promise<void>;
    createBoardFrom(input: {
        sourceBoardId: string;
        name: string;
        category?: string;
        nodeIds?: string[];
        includeReadme?: boolean;
        includeStructure?: boolean;
        preview?: boolean;
    }): Promise<Record<string, unknown>>;
    searchLibrary(query: string, limit?: number): Promise<Record<string, unknown>>;
    /** Budgeted cross-board brief. Budget is measured in UTF-16 characters. */
    getContextBrief(options?: {
        consumer?: string;
        since?: number;
        budget?: number;
    }): Promise<Record<string, unknown>>;
    /** Open a board, or Home with null. */
    openBoard(id: string | null): Promise<void>;
    deleteBoard(id: string): Promise<void>;
    /** Write a self-contained HTML file of a board (default: the open board). */
    exportBoard(options?: {
        board?: string;
        includeFiles?: boolean;
        includeDerivedText?: boolean;
    }): Promise<{
        path: string;
        url: string;
        bytes: number;
        manifest: ExportManifest;
    }>;
    getBackupStatus(): Promise<BackupStatus>;
    /** Back up every board now; `to` and `keep` default to the configured folder and count. */
    backup(options?: {
        to?: string;
        keep?: number;
    }): Promise<{
        backup: BackupFile;
        removed: string[];
    }>;
    /** Back up on a schedule run by the server; `every: 'off'` stops it. */
    setBackupSchedule(options: {
        every: string;
        to?: string;
        keep?: number;
    }): Promise<BackupStatus>;
    /** Replace every board with a backup file; the current file is kept as `canvas.db.before-restore`. */
    restoreBackup(file: string): Promise<void>;
    /** The context read log: which canvas context each agent read and which pinned nodes reached it. */
    getContextReads(limit?: number): ReturnType<typeof canvasState.getContextReads>;
    /** Per node on a board: when an agent last read its content, who, and the content revision it read. */
    getNodeReadStatus(board?: string): ReturnType<typeof canvasState.getNodeReadStatus>;
    /** A board's latest agent read of any kind (a pinned board's map counts), or null. */
    getBoardLastRead(board?: string): ReturnType<typeof canvasState.getBoardLastRead>;
    listWorkItems(): PmxAxWorkItem[];
    addWorkItem(input: {
        title: string;
        status?: PmxAxWorkItemStatus;
        detail?: string | null;
        nodeIds?: string[];
        agentId?: string | null;
    }, options?: {
        source?: PmxAxSource;
    }): PmxAxWorkItem;
    updateWorkItem(id: string, patch: {
        title?: string;
        status?: PmxAxWorkItemStatus;
        detail?: string | null;
        nodeIds?: string[];
        agentId?: string | null;
    }, options?: {
        source?: PmxAxSource;
    }): PmxAxWorkItem | null;
    listApprovalGates(): PmxAxApprovalGate[];
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
    /** Reopen a resolved (typically auto-held) approval gate with a fresh TTL. */
    reopenApproval(id: string, options?: {
        ttlMs?: number;
        source?: PmxAxSource;
    }): PmxAxApprovalGate | null;
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
    listReviewAnnotations(): PmxAxReviewAnnotation[];
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
    reportHostCapability(input: unknown, options?: {
        source?: PmxAxSource;
    }): PmxAxHostCapability;
    /** Who is writing to this board right now, their phase, and the context budget. */
    getAgentPresence(): AgentPresenceSnapshot;
    /**
     * Update this SDK caller's presence (rail-chrome-v2 phase 2): phase, detail,
     * focus node, cursor, and `attached` (true starts a session, false ends it).
     */
    setAgentPresence(input: {
        agentId?: string | null;
        label?: string;
        phase?: AgentPhase;
        detail?: string | null;
        focusNodeId?: string | null;
        cursor?: {
            x: number;
            y: number;
        } | null;
        attached?: boolean;
    }, options?: {
        source?: PmxAxSource;
    }): AgentPresence;
    listElicitations(): PmxAxElicitation[];
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
    listModeRequests(): PmxAxModeRequest[];
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
    getApproval(id: string): PmxAxApprovalGate | null;
    getElicitation(id: string): PmxAxElicitation | null;
    getModeRequest(id: string): PmxAxModeRequest | null;
    awaitApproval(id: string, options?: {
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<{
        approvalGate: PmxAxApprovalGate | null;
        pending: boolean;
    }>;
    awaitElicitation(id: string, options?: {
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<{
        elicitation: PmxAxElicitation | null;
        pending: boolean;
    }>;
    awaitMode(id: string, options?: {
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<{
        modeRequest: PmxAxModeRequest | null;
        pending: boolean;
    }>;
    getCommandRegistry(): PmxAxCommandDescriptor[];
    invokeCommand(name: string, args?: Record<string, unknown> | null, options?: {
        source?: PmxAxSource;
    }): PmxAxEvent | null;
    getPolicy(): PmxAxPolicy;
    setPolicy(patch: {
        tools?: Partial<PmxAxPolicy['tools']>;
        prompt?: Partial<PmxAxPolicy['prompt']>;
    }, options?: {
        source?: PmxAxSource;
    }): PmxAxPolicy;
    fitView(options?: {
        width?: number;
        height?: number;
        padding?: number;
        maxScale?: number;
        nodeIds?: string[];
    }): ReturnType<typeof fitCanvasView>;
    getLayout(options?: {
        board?: string;
    }): CanvasLayout;
    getNode(id: string, options?: {
        board?: string;
    }): SdkCanvasNode | undefined;
    search(query: string): ReturnType<typeof searchNodes>;
    getSpatialContext(): import("./spatial-analysis.js").SpatialContext;
    undo(): Promise<{
        ok: boolean;
        description?: string;
    }>;
    redo(): Promise<{
        ok: boolean;
        description?: string;
    }>;
    getHistory(): {
        text: string;
        entries: import("./mutation-history.js").MutationSummary[];
        canUndo: boolean;
        canRedo: boolean;
    };
    applyUpdates(updates: Array<{
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
    }>): {
        applied: number;
        skipped: number;
    };
    /** `reason` is kept with newly pinned nodes and shown to the human on hover. */
    setContextPins(nodeIds: string[], mode?: 'set' | 'add' | 'remove', reason?: string): {
        count: number;
        nodeIds: string[];
    };
    listSnapshots(options?: Parameters<typeof listCanvasSnapshots>[0]): import("./canvas-state.js").CanvasSnapshot[];
    saveSnapshot(name: string): import("./canvas-state.js").CanvasSnapshot | null;
    restoreSnapshot(id: string): Promise<{
        ok: boolean;
    }>;
    deleteSnapshot(id: string): {
        ok: boolean;
    };
    gcSnapshots(options?: Parameters<typeof gcCanvasSnapshots>[0]): ReturnType<typeof gcCanvasSnapshots>;
    diffSnapshot(idOrName: string): {
        ok: boolean;
        text?: string;
        diff?: ReturnType<typeof diffLayouts>;
        error?: string;
    };
    getCodeGraph(): {
        text: string;
        summary: import("./code-graph.js").CodeGraphSummary;
    };
    validate(): import("./canvas-validation.js").CanvasValidationResult;
    describeSchema(): {
        ok: true;
        source: "running-server";
        version: string | null;
        nodeTypes: import("./canvas-schema.js").CanvasCreateTypeSchema[];
        jsonRender: {
            rootShape: Record<string, string>;
            components: import("../json-render/catalog.js").JsonRenderComponentDescriptor[];
            directives: Array<{
                name: string;
                usage: string;
            }>;
        };
        graph: {
            graphTypes: ("line" | "bar" | "pie" | "area" | "scatter" | "radar" | "composed" | "sparkline" | "bullet" | "slopegraph" | "stacked-bar" | "dot-plot")[];
        };
        htmlPrimitives: import("./html-primitives.js").HtmlPrimitiveDescriptor[];
        mcp: {
            tools: string[];
            resources: string[];
            nodeTypeRouting: Record<string, string>;
        };
    };
    validateSpec(input: {
        type: 'json-render' | 'graph';
        spec?: unknown;
        graph?: GraphNodeInput;
    }): import("./canvas-schema.js").StructuredValidationResult;
    runBatch(operations: Array<{
        op: string;
        assign?: string;
        args?: Record<string, unknown>;
    }>): Promise<import("./operations/index.js").BatchEnvelope>;
    buildWebArtifact(input: WebArtifactBuildInput & {
        openInCanvas?: boolean;
        includeLogs?: boolean;
    }): Promise<WebArtifactCanvasBuildResult>;
    openMcpApp(input: {
        transport: ExternalMcpTransportConfig;
        toolName: string;
        toolArguments?: Record<string, unknown>;
        nodeId?: string;
        serverName?: string;
        title?: string;
        x?: number;
        y?: number;
        width?: number;
        height?: number;
        timeoutMs?: number;
    }): Promise<OpenMcpAppCoreResult>;
    addDiagram(input: DiagramPresetOpenInput): Promise<OpenMcpAppCoreResult>;
    addJsonRenderNode(input: JsonRenderNodeInput & {
        intentId?: string;
    }): {
        id: string;
        url: string;
        spec: JsonRenderSpec;
    };
    /**
     * Progressively build a json-render node from SpecStream patches. Omit nodeId
     * to create a new streaming node; pass the same nodeId on later calls to
     * append more patches. The server accumulates the spec and the browser
     * reloads the viewer as the specVersion bumps.
     */
    streamJsonRenderNode(input: {
        intentId?: string;
        nodeId?: string;
        title?: string;
        patches?: unknown[];
        done?: boolean;
        x?: number;
        y?: number;
        width?: number;
        height?: number;
        strictSize?: boolean;
    }): {
        id: string;
        url: string;
        applied: number;
        skipped: number;
        specVersion: number;
        elementCount: number;
        streamStatus: 'open' | 'closed';
    };
    addHtmlNode(input: {
        intentId?: string;
        html: string;
        title?: string;
        summary?: string;
        agentSummary?: string;
        description?: string;
        presentation?: boolean;
        slideTitles?: string[];
        embeddedNodeIds?: string[];
        embeddedUrls?: string[];
        x?: number;
        y?: number;
        width?: number;
        height?: number;
        strictSize?: boolean;
        /** Opt this html node into AX interactions (window.PMX_AX.emit). Clamped to
         *  the html capability ceiling server-side; cannot escalate. */
        axCapabilities?: {
            enabled?: boolean;
            allowed?: string[];
        };
    }): SdkCanvasNode;
    addHtmlPrimitive(input: {
        intentId?: string;
        kind: HtmlPrimitiveKind;
        title?: string;
        data?: Record<string, unknown>;
        x?: number;
        y?: number;
        width?: number;
        height?: number;
        strictSize?: boolean;
    }): {
        id: string;
        kind: HtmlPrimitiveKind;
        title: string;
        htmlBytes: number;
    };
    addGraphNode(input: GraphNodeInput & {
        intentId?: string;
    }): {
        id: string;
        url: string;
        spec: JsonRenderSpec;
    };
    get port(): number;
    startAutomationWebView(options?: CanvasAutomationWebViewOptions): Promise<CanvasAutomationWebViewStatus>;
    stopAutomationWebView(): Promise<boolean>;
    getAutomationWebViewStatus(): CanvasAutomationWebViewStatus;
    evaluateAutomationWebView(expression: string): Promise<unknown>;
    resizeAutomationWebView(width: number, height: number): Promise<CanvasAutomationWebViewStatus>;
    screenshotAutomationWebView(options?: Record<string, unknown>): Promise<Uint8Array>;
}
export declare function createCanvas(options?: {
    port?: number;
}): PmxCanvas;
export type { CanvasNodeState, CanvasEdge, CanvasLayout, ViewportState } from './canvas-state.js';
export type { CanvasAutomationWebViewOptions, CanvasAutomationWebViewStatus, PrimaryWorkbenchCanvasPromptRequest, PrimaryWorkbenchIntent, } from './server.js';
export { emitPrimaryWorkbenchEvent, consumePrimaryWorkbenchIntents, setPrimaryWorkbenchAutoOpenEnabled, setPrimaryWorkbenchCanvasPromptHandler, startCanvasServer, stopCanvasServer, getCanvasServerPort, openUrlInExternalBrowser, getCanvasAutomationWebViewStatus, startCanvasAutomationWebView, stopCanvasAutomationWebView, evaluateCanvasAutomationWebView, resizeCanvasAutomationWebView, screenshotCanvasAutomationWebView, } from './server.js';
export { canvasState } from './canvas-state.js';
export type { CanvasBoard } from './canvas-db.js';
export type { BackupFile, BackupStatus } from './backup.js';
export type { ExportManifest } from './board-export.js';
export type { CanvasAnnotation, CanvasSnapshot, CanvasSnapshotGcResult, CanvasSnapshotListOptions, } from './canvas-state.js';
export { findOpenCanvasPosition } from './placement.js';
export { searchNodes, buildSpatialContext, detectClusters, findNeighborhoods } from './spatial-analysis.js';
export type { SpatialCluster, SpatialContext, SpatialNeighbor, NodeSpatialInfo } from './spatial-analysis.js';
export { mutationHistory, diffLayouts, formatDiff } from './mutation-history.js';
export { recomputeCodeGraph, buildCodeGraphSummary, formatCodeGraph } from './code-graph.js';
export { describeCanvasSchema, validateStructuredCanvasPayload } from './canvas-schema.js';
export { buildHtmlPrimitive, getHtmlPrimitiveSemanticMetadata, isHtmlPrimitiveKind, listHtmlPrimitiveDescriptors, } from './html-primitives.js';
export { buildWebArtifactOnCanvas, executeWebArtifactBuild, openWebArtifactInCanvas, resolveWebArtifactScriptPath, resolveWorkspacePath, } from './web-artifacts.js';
export { buildGraphSpec, buildJsonRenderViewerHtml, createJsonRenderNodeData, GRAPH_NODE_SIZE, JSON_RENDER_NODE_SIZE, normalizeAndValidateJsonRenderSpec, } from '../json-render/server.js';
export type { CodeGraphSummary, CodeGraphEdge } from './code-graph.js';
export type { MutationEntry, MutationSummary, SnapshotDiffResult } from './mutation-history.js';
export type { WebArtifactBuildInput, WebArtifactBuildOutput, WebArtifactCanvasBuildResult, WebArtifactCanvasOpenResult, } from './web-artifacts.js';
export type { GraphNodeInput, JsonRenderNodeInput, JsonRenderSpec } from '../json-render/server.js';
export type { HtmlPrimitiveKind, HtmlPrimitiveDescriptor, HtmlPrimitiveInput, HtmlPrimitiveBuildResult, } from './html-primitives.js';
export { traceManager } from './trace-manager.js';
export type { PmxAxApprovalGate, PmxAxApprovalStatus, PmxAxCommandDescriptor, PmxAxContext, PmxAxEvent, PmxAxElicitation, PmxAxElicitationStatus, PmxAxEventKind, PmxAxEvidence, PmxAxEvidenceKind, PmxAxFocusState, PmxAxHostCapability, PmxAxMode, PmxAxModeRequest, PmxAxModeRequestStatus, PmxAxPolicy, PmxAxReviewAnchorType, PmxAxReviewAnnotation, PmxAxReviewKind, PmxAxReviewRegion, PmxAxReviewSeverity, PmxAxReviewStatus, PmxAxSource, PmxAxState, PmxAxSteeringMessage, PmxAxTimelineSummary, PmxAxWorkItem, PmxAxWorkItemStatus, } from './ax-state.js';
export type { AxTimelineQuery } from './canvas-db.js';
