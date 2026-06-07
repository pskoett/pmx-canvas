import { EventEmitter } from 'node:events';
import { canvasState } from './canvas-state.js';
import type { CanvasAnnotation, CanvasNodeState, CanvasEdge, CanvasLayout } from './canvas-state.js';
import { type AxInteractionInput, type AxInteractionPublicResult } from './ax-interaction.js';
import type { PmxAxApprovalGate, PmxAxCommandDescriptor, PmxAxContext, PmxAxElicitation, PmxAxEvent, PmxAxEvidence, PmxAxEvidenceKind, PmxAxFocusState, PmxAxHostCapability, PmxAxMode, PmxAxModeRequest, PmxAxPolicy, PmxAxReviewAnchorType, PmxAxReviewAnnotation, PmxAxReviewKind, PmxAxReviewRegion, PmxAxReviewSeverity, PmxAxReviewStatus, PmxAxSource, PmxAxState, PmxAxSteeringMessage, PmxAxWorkItem, PmxAxWorkItemStatus } from './ax-state.js';
import type { AxTimelineQuery } from './canvas-db.js';
import { searchNodes } from './spatial-analysis.js';
import { diffLayouts } from './mutation-history.js';
import { fitCanvasView, gcCanvasSnapshots, listCanvasSnapshots } from './canvas-operations.js';
import { type SerializedCanvasNode } from './canvas-serialization.js';
import type { HtmlPrimitiveKind } from './html-primitives.js';
import { type WebArtifactBuildInput, type WebArtifactCanvasBuildResult } from './web-artifacts.js';
import { type ExternalMcpTransportConfig } from './mcp-app-runtime.js';
import { type DiagramPresetOpenInput } from './diagram-presets.js';
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
    start(options?: {
        open?: boolean;
        automationWebView?: boolean | CanvasAutomationWebViewOptions;
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
    removeNode(id: string): void;
    addEdge(input: {
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
    }): boolean;
    /** Remove all children from a group (the group node remains). */
    ungroupNodes(groupId: string): boolean;
    clear(): void;
    arrange(layout?: 'grid' | 'column' | 'flow'): void;
    focusNode(id: string, options?: {
        noPan?: boolean;
    }): {
        focused: string;
        panned: boolean;
    } | null;
    getAxState(): PmxAxState;
    getAxContext(): PmxAxContext;
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
    }): PmxAxEvent;
    sendSteering(message: string, options?: {
        source?: PmxAxSource;
    }): PmxAxSteeringMessage;
    markSteeringDelivered(id: string): boolean;
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
    listWorkItems(): PmxAxWorkItem[];
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
    getLayout(): CanvasLayout;
    getNode(id: string): SdkCanvasNode | undefined;
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
        dockPosition?: 'left' | 'right' | null;
    }>): {
        applied: number;
        skipped: number;
    };
    setContextPins(nodeIds: string[], mode?: 'set' | 'add' | 'remove'): {
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
    private findCanvasExtAppNodeId;
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
    }>): Promise<{
        ok: boolean;
        results: Array<Record<string, unknown>>;
        refs: Record<string, unknown>;
        failedIndex?: number;
        error?: string;
    }>;
    buildWebArtifact(input: WebArtifactBuildInput & {
        openInCanvas?: boolean;
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
    }): Promise<{
        ok: true;
        id?: string;
        nodeId: string | null;
        toolCallId: string;
        sessionId: string;
        resourceUri: string;
    }>;
    addDiagram(input: DiagramPresetOpenInput): Promise<{
        ok: true;
        id?: string;
        nodeId: string | null;
        toolCallId: string;
        sessionId: string;
        resourceUri: string;
    }>;
    addJsonRenderNode(input: JsonRenderNodeInput): {
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
    }): SdkCanvasNode;
    addHtmlPrimitive(input: {
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
    addGraphNode(input: GraphNodeInput): {
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
export type { CanvasAnnotation, CanvasSnapshot, CanvasSnapshotGcResult, CanvasSnapshotListOptions } from './canvas-state.js';
export { findOpenCanvasPosition } from './placement.js';
export { searchNodes, buildSpatialContext, detectClusters, findNeighborhoods } from './spatial-analysis.js';
export type { SpatialCluster, SpatialContext, SpatialNeighbor, NodeSpatialInfo } from './spatial-analysis.js';
export { mutationHistory, diffLayouts, formatDiff } from './mutation-history.js';
export { recomputeCodeGraph, buildCodeGraphSummary, formatCodeGraph } from './code-graph.js';
export { describeCanvasSchema, validateStructuredCanvasPayload } from './canvas-schema.js';
export { buildHtmlPrimitive, getHtmlPrimitiveSemanticMetadata, isHtmlPrimitiveKind, listHtmlPrimitiveDescriptors } from './html-primitives.js';
export { buildWebArtifactOnCanvas, executeWebArtifactBuild, openWebArtifactInCanvas, resolveWebArtifactScriptPath, resolveWorkspacePath, } from './web-artifacts.js';
export { buildGraphSpec, buildJsonRenderViewerHtml, createJsonRenderNodeData, GRAPH_NODE_SIZE, JSON_RENDER_NODE_SIZE, normalizeAndValidateJsonRenderSpec, } from '../json-render/server.js';
export type { CodeGraphSummary, CodeGraphEdge } from './code-graph.js';
export type { MutationEntry, MutationSummary, SnapshotDiffResult } from './mutation-history.js';
export type { WebArtifactBuildInput, WebArtifactBuildOutput, WebArtifactCanvasBuildResult, WebArtifactCanvasOpenResult, } from './web-artifacts.js';
export type { GraphNodeInput, JsonRenderNodeInput, JsonRenderSpec } from '../json-render/server.js';
export type { HtmlPrimitiveKind, HtmlPrimitiveDescriptor, HtmlPrimitiveInput, HtmlPrimitiveBuildResult } from './html-primitives.js';
export { traceManager } from './trace-manager.js';
export type { PmxAxApprovalGate, PmxAxApprovalStatus, PmxAxCommandDescriptor, PmxAxContext, PmxAxEvent, PmxAxElicitation, PmxAxElicitationStatus, PmxAxEventKind, PmxAxEvidence, PmxAxEvidenceKind, PmxAxFocusState, PmxAxHostCapability, PmxAxMode, PmxAxModeRequest, PmxAxModeRequestStatus, PmxAxPolicy, PmxAxReviewAnchorType, PmxAxReviewAnnotation, PmxAxReviewKind, PmxAxReviewRegion, PmxAxReviewSeverity, PmxAxReviewStatus, PmxAxSource, PmxAxState, PmxAxSteeringMessage, PmxAxTimelineSummary, PmxAxWorkItem, PmxAxWorkItemStatus, } from './ax-state.js';
export type { AxTimelineQuery } from './canvas-db.js';
