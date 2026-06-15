import { canvasState, type CanvasEdge, type CanvasNodeState, type CanvasNodeUpdate, type CanvasSnapshot } from './canvas-state.js';
import { type GraphNodeInput, type JsonRenderNodeInput, type JsonRenderSpec } from '../json-render/server.js';
export type CanvasArrangeMode = 'grid' | 'column' | 'flow';
export type CanvasPinMode = 'set' | 'add' | 'remove';
export declare function setCanvasLayoutUpdateEmitter(emitter: (() => void) | null): void;
export interface CanvasFitViewOptions {
    width?: number;
    height?: number;
    padding?: number;
    maxScale?: number;
    nodeIds?: string[];
}
export interface CanvasFitViewResult {
    ok: true;
    viewport: {
        x: number;
        y: number;
        scale: number;
    };
    nodeCount: number;
    bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    } | null;
}
export interface CanvasGraphNodeUpdateInput extends Partial<GraphNodeInput> {
    spec?: unknown;
    type?: string;
}
export interface CanvasStructuredNodeUpdateInput extends Omit<CanvasGraphNodeUpdateInput, 'data'> {
    content?: unknown;
    data?: unknown;
    arrangeLocked?: unknown;
    strictSize?: boolean;
    chartHeight?: unknown;
}
interface CanvasAddNodeInput {
    type: CanvasNodeState['type'];
    title?: string;
    content?: string;
    data?: Record<string, unknown>;
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
    defaultWidth?: number;
    defaultHeight?: number;
    fileMode?: 'path' | 'inline' | 'auto';
    strictSize?: boolean;
}
export declare const MARKDOWN_NODE_DEFAULT_SIZE: {
    width: number;
    height: number;
};
export declare const MCP_APP_NODE_DEFAULT_SIZE: {
    width: number;
    height: number;
};
export declare const IMAGE_NODE_DEFAULT_SIZE: {
    width: number;
    height: number;
};
export declare const LEDGER_NODE_DEFAULT_SIZE: {
    width: number;
    height: number;
};
interface CanvasCreateGroupInput {
    title?: string;
    childIds?: string[];
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    color?: string;
    childLayout?: CanvasArrangeMode;
}
interface CanvasNodeLookupInput {
    id?: string;
    search?: string;
}
export declare function hasStructuredNodeUpdateFields(input: Record<string, unknown>): boolean;
export declare function buildStructuredNodeUpdate(node: CanvasNodeState, input: CanvasStructuredNodeUpdateInput): {
    data: Record<string, unknown>;
};
export declare function buildJsonRenderNodeUpdate(node: CanvasNodeState, input: {
    title?: string;
    spec: unknown;
}): {
    data: Record<string, unknown>;
    spec: JsonRenderSpec;
};
export declare function buildGraphNodeUpdate(node: CanvasNodeState, input: CanvasGraphNodeUpdateInput): {
    data: Record<string, unknown>;
    spec: JsonRenderSpec;
    graphConfig: Record<string, unknown>;
};
export declare function primeCanvasRuntimeBackends(options?: {
    forceRehydrateExtApps?: boolean;
}): {
    targetIds: string[];
};
export declare function syncCanvasRuntimeBackends(options?: {
    forceRehydrateExtApps?: boolean;
    alreadyPrimed?: boolean;
}): Promise<{
    rehydrated: number;
    failed: number;
}>;
export declare function validateCanvasNodePatch(patch: {
    position?: {
        x: number;
        y: number;
    };
    size?: {
        width: number;
        height: number;
    };
}): string | null;
export declare function mergeTraceNodeDataFields(base: Record<string, unknown>, input: Record<string, unknown>): Record<string, unknown>;
export declare function hasTraceNodeDataFields(input: Record<string, unknown>): boolean;
export declare function scheduleCodeGraphRecompute(onComplete?: () => void): void;
/**
 * Resolve an html-node `html` field that may be a path to a local .html/.htm file.
 *
 * If the string looks like a bare filesystem path to an existing HTML file
 * (no markup, no newlines, short, ends in .html/.htm, exists on disk), read the
 * file and return its contents. Otherwise return the string unchanged as raw HTML.
 * On read failure, fall back to the raw string and warn — never throw.
 *
 * This is a local dev tool, so reading a user-pointed-at local file is acceptable;
 * the markup/newline guards prevent misclassifying genuine HTML as a path.
 */
export declare function resolveHtmlContent(html: string): string;
export declare function addCanvasNode(input: CanvasAddNodeInput): {
    id: string;
    node: CanvasNodeState;
    needsCodeGraphRecompute: boolean;
};
export declare function resolveCanvasNode(nodeRef: CanvasNodeLookupInput): {
    ok: true;
    node: CanvasNodeState;
} | {
    ok: false;
    error: string;
};
export declare function refreshCanvasWebpageNode(id: string, options?: {
    url?: string;
}): Promise<{
    ok: boolean;
    id: string;
    error?: string;
}>;
export declare function removeCanvasNode(id: string): {
    removed: boolean;
    needsCodeGraphRecompute: boolean;
};
export declare function arrangeCanvasNodes(layout: CanvasArrangeMode): {
    arranged: number;
    layout: CanvasArrangeMode;
};
export declare function applyCanvasNodeUpdates(updates: CanvasNodeUpdate[]): {
    applied: number;
    skipped: number;
};
export declare function setCanvasContextPins(nodeIds: string[], mode?: CanvasPinMode): {
    count: number;
    nodeIds: string[];
};
export declare function listCanvasSnapshots(options?: Parameters<typeof canvasState.listSnapshots>[0]): CanvasSnapshot[];
export declare function saveCanvasSnapshot(name: string): CanvasSnapshot | null;
export declare function restoreCanvasSnapshot(idOrName: string): Promise<{
    ok: boolean;
}>;
export declare function deleteCanvasSnapshot(id: string): {
    ok: boolean;
};
export declare function gcCanvasSnapshots(options?: Parameters<typeof canvasState.gcSnapshots>[0]): ReturnType<typeof canvasState.gcSnapshots>;
export declare function addCanvasEdge(input: {
    from?: string;
    to?: string;
    fromSearch?: string;
    toSearch?: string;
    type: CanvasEdge['type'];
    label?: string;
    style?: CanvasEdge['style'];
    animated?: boolean;
}): CanvasEdge;
export declare function removeCanvasEdge(id: string): {
    removed: boolean;
};
export declare function createCanvasGroup(input: CanvasCreateGroupInput): {
    id: string;
    node: CanvasNodeState;
};
export declare function groupCanvasNodes(groupId: string, childIds: string[], options?: {
    childLayout?: CanvasArrangeMode;
}): {
    ok: boolean;
};
export declare function ungroupCanvasNodes(groupId: string): {
    ok: boolean;
};
export declare function clearCanvas(): {
    ok: boolean;
};
export declare function createCanvasJsonRenderNode(input: JsonRenderNodeInput): {
    id: string;
    url: string;
    spec: JsonRenderSpec;
    node: CanvasNodeState;
};
/**
 * Create an empty streaming json-render node. Unlike createCanvasJsonRenderNode
 * this does NOT validate a complete spec — the node starts blank and is filled
 * in by appendCanvasJsonRenderStream as SpecStream patches arrive.
 */
export declare function createCanvasStreamingJsonRenderNode(input: {
    title?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    strictSize?: boolean;
}): {
    id: string;
    url: string;
    spec: JsonRenderSpec;
    node: CanvasNodeState;
};
/**
 * Apply a batch of SpecStream patches to an existing json-render node, bumping
 * its specVersion so the browser reloads the viewer with the accumulated spec.
 */
export declare function appendCanvasJsonRenderStream(nodeId: string, patches: unknown[], done: boolean): {
    ok: true;
    applied: number;
    skipped: number;
    specVersion: number;
    elementCount: number;
    streamStatus: 'open' | 'closed';
} | {
    ok: false;
    error: string;
};
export declare function createCanvasGraphNode(input: GraphNodeInput): {
    id: string;
    url: string;
    spec: JsonRenderSpec;
    node: CanvasNodeState;
};
export declare function fitCanvasView(options?: CanvasFitViewOptions): CanvasFitViewResult;
export {};
