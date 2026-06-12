import { type CanvasLayout, type CanvasNodeState } from '../../canvas-state.js';
import { type Operation } from '../types.js';
export declare const NODE_TYPES: readonly ["markdown", "status", "context", "ledger", "trace", "file", "image", "mcp-app", "webpage", "html", "group"];
/** Per-type default node frame size (formerly copy-pasted ladders). */
export declare function defaultNodeSize(type: string): {
    width: number;
    height: number;
};
export declare function isRecord(value: unknown): value is Record<string, unknown>;
export declare function pickFiniteNumber(record: Record<string, unknown>, key: string): number | undefined;
export declare function getRecord(value: unknown): Record<string, unknown> | undefined;
export declare function pickPositiveNumber(record: Record<string, unknown>, key: string): number | undefined;
export declare function resolveCreateGeometry(body: Record<string, unknown>): {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
};
export declare function setGroupChildrenFromApi(groupId: string, childIds: string[]): boolean;
export declare function nodeAppSessionId(node: CanvasNodeState | undefined): string | null;
export declare function closeNodeAppSession(node: CanvasNodeState | undefined): void;
export declare function buildNodeResponse(node: CanvasNodeState): Record<string, unknown>;
export declare function wantsFullPayload(input?: Record<string, unknown>): boolean;
export declare function compactNodePayload(node: CanvasNodeState | undefined): Record<string, unknown> | null;
export declare function buildSummaryFromLayout(layout: CanvasLayout, pinnedIds: string[]): Record<string, unknown>;
export declare function compactLayoutPayload(layout: CanvasLayout, pinnedIds: string[]): Record<string, unknown>;
export declare function agentSafeFullLayoutPayload(layout: CanvasLayout): Record<string, unknown>;
/**
 * Node-create/update MCP payload: exposes both `id` and a `nodeId` alias so
 * agents using either key (or a cached schema) work — matching the
 * external-app / web-artifact responses that already return both.
 */
export declare function createdNodePayloadFromNode(node: CanvasNodeState, options?: Record<string, unknown>): Record<string, unknown>;
/**
 * Create a basic (non-webpage / non-group / non-primitive) node. Union of the
 * legacy handleCanvasAddNode generic branch; the SDK passes fileMode 'path',
 * the HTTP/MCP operation passes fileMode 'auto'.
 */
export declare function createBasicCanvasNode(body: Record<string, unknown>, options: {
    fileMode: 'auto' | 'path';
}): {
    node: CanvasNodeState;
    needsCodeGraphRecompute: boolean;
};
/**
 * Build a node patch with the full HTTP superset semantics (webpage
 * titleSource, html top-level fields, axCapabilities merge, group children,
 * structured spec/graph updates, trace fields). Throws OperationError on
 * validation failures. The SDK's updateNode delegates here.
 */
export declare function buildNodePatch(existing: CanvasNodeState, body: Record<string, unknown>): {
    patch: Partial<CanvasNodeState>;
    groupChildIds?: string[];
};
/**
 * Remove a node (closing any mcp-app session). Missing id → OperationError 404
 * on ALL surfaces (plan-005 deliberately unifies the old silent local success).
 */
export declare function removeNodeCore(id: string): {
    needsCodeGraphRecompute: boolean;
};
export declare const nodeOperations: Operation[];
