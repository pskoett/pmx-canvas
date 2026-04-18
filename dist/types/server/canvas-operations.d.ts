import { type CanvasEdge, type CanvasNodeState, type CanvasNodeUpdate, type CanvasSnapshot } from './canvas-state.js';
import { type GraphNodeInput, type JsonRenderNodeInput, type JsonRenderSpec } from '../json-render/server.js';
export type CanvasArrangeMode = 'grid' | 'column' | 'flow';
export type CanvasPinMode = 'set' | 'add' | 'remove';
interface CanvasAddNodeInput {
    type: CanvasNodeState['type'];
    title?: string;
    content?: string;
    data?: Record<string, unknown>;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    defaultWidth?: number;
    defaultHeight?: number;
    fileMode?: 'path' | 'inline' | 'auto';
}
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
export interface CanvasBatchOperation {
    op: string;
    assign?: string;
    args?: Record<string, unknown>;
}
interface CanvasNodeLookupInput {
    id?: string;
    search?: string;
}
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
export declare function scheduleCodeGraphRecompute(onComplete?: () => void): void;
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
export declare function listCanvasSnapshots(): CanvasSnapshot[];
export declare function saveCanvasSnapshot(name: string): CanvasSnapshot | null;
export declare function restoreCanvasSnapshot(id: string): {
    ok: boolean;
};
export declare function deleteCanvasSnapshot(id: string): {
    ok: boolean;
};
export declare function addCanvasEdge(input: {
    from?: string;
    to?: string;
    fromSearch?: string;
    toSearch?: string;
    type: CanvasEdge['type'];
    label?: string;
    style?: CanvasEdge['style'];
    animated?: boolean;
}): {
    id: string;
    from: string;
    to: string;
};
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
export declare function createCanvasGraphNode(input: GraphNodeInput): {
    id: string;
    url: string;
    spec: JsonRenderSpec;
    node: CanvasNodeState;
};
export declare function executeCanvasBatch(operations: CanvasBatchOperation[]): Promise<{
    ok: boolean;
    results: Array<Record<string, unknown>>;
    refs: Record<string, unknown>;
    failedIndex?: number;
    error?: string;
}>;
export {};
