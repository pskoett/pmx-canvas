import { EventEmitter } from 'node:events';
import type { CanvasNodeState, CanvasEdge, CanvasLayout } from './canvas-state.js';
import { searchNodes } from './spatial-analysis.js';
import { diffLayouts } from './mutation-history.js';
import { type WebArtifactBuildInput, type WebArtifactCanvasBuildResult } from './web-artifacts.js';
import { type ExternalMcpTransportConfig } from './mcp-app-runtime.js';
import { type DiagramPresetOpenInput } from './diagram-presets.js';
import { type GraphNodeInput, type JsonRenderNodeInput, type JsonRenderSpec } from '../json-render/server.js';
import type { CanvasAutomationWebViewOptions, CanvasAutomationWebViewStatus } from './server.js';
export declare class PmxCanvas extends EventEmitter {
    private _port;
    private _server;
    constructor(options?: {
        port?: number;
    });
    start(options?: {
        open?: boolean;
        automationWebView?: boolean | CanvasAutomationWebViewOptions;
    }): Promise<void>;
    stop(): void;
    addNode(input: {
        type: CanvasNodeState['type'];
        title?: string;
        content?: string;
        x?: number;
        y?: number;
        width?: number;
        height?: number;
    }): string;
    addWebpageNode(input: {
        title?: string;
        url: string;
        x?: number;
        y?: number;
        width?: number;
        height?: number;
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
    updateNode(id: string, patch: Partial<CanvasNodeState>): void;
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
    focusNode(id: string): void;
    getLayout(): CanvasLayout;
    getNode(id: string): CanvasNodeState | undefined;
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
    listSnapshots(): import("./canvas-state.js").CanvasSnapshot[];
    saveSnapshot(name: string): import("./canvas-state.js").CanvasSnapshot | null;
    restoreSnapshot(id: string): Promise<{
        ok: boolean;
    }>;
    deleteSnapshot(id: string): {
        ok: boolean;
    };
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
        };
        graph: {
            graphTypes: ("line" | "bar" | "pie" | "area" | "scatter" | "radar" | "composed" | "stacked-bar")[];
        };
        mcp: {
            tools: string[];
            resources: string[];
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
        serverName?: string;
        title?: string;
        x?: number;
        y?: number;
        width?: number;
        height?: number;
    }): Promise<{
        ok: true;
        toolCallId: string;
        sessionId: string;
        resourceUri: string;
    }>;
    addDiagram(input: DiagramPresetOpenInput): Promise<{
        ok: true;
        toolCallId: string;
        sessionId: string;
        resourceUri: string;
    }>;
    addJsonRenderNode(input: JsonRenderNodeInput): {
        id: string;
        url: string;
        spec: JsonRenderSpec;
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
export type { CanvasSnapshot } from './canvas-state.js';
export { findOpenCanvasPosition } from './placement.js';
export { searchNodes, buildSpatialContext, detectClusters, findNeighborhoods } from './spatial-analysis.js';
export type { SpatialCluster, SpatialContext, SpatialNeighbor, NodeSpatialInfo } from './spatial-analysis.js';
export { mutationHistory, diffLayouts, formatDiff } from './mutation-history.js';
export { recomputeCodeGraph, buildCodeGraphSummary, formatCodeGraph } from './code-graph.js';
export { describeCanvasSchema, validateStructuredCanvasPayload } from './canvas-schema.js';
export { buildWebArtifactOnCanvas, executeWebArtifactBuild, openWebArtifactInCanvas, resolveWebArtifactScriptPath, resolveWorkspacePath, } from './web-artifacts.js';
export { buildGraphSpec, buildJsonRenderViewerHtml, createJsonRenderNodeData, GRAPH_NODE_SIZE, JSON_RENDER_NODE_SIZE, normalizeAndValidateJsonRenderSpec, } from '../json-render/server.js';
export type { CodeGraphSummary, CodeGraphEdge } from './code-graph.js';
export type { MutationEntry, MutationSummary, SnapshotDiffResult } from './mutation-history.js';
export type { WebArtifactBuildInput, WebArtifactBuildOutput, WebArtifactCanvasBuildResult, WebArtifactCanvasOpenResult, } from './web-artifacts.js';
export type { GraphNodeInput, JsonRenderNodeInput, JsonRenderSpec } from '../json-render/server.js';
export { traceManager } from './trace-manager.js';
