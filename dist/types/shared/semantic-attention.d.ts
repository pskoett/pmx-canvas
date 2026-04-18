import type { CanvasEdge, CanvasLayout, CanvasNodeState } from '../client/types.js';
import { type SpatialContext } from '../server/spatial-analysis.js';
export type SemanticWatchEventType = 'context-pin' | 'connect' | 'remove' | 'group' | 'move-end';
export declare const ALL_SEMANTIC_WATCH_EVENT_TYPES: SemanticWatchEventType[];
export interface SemanticWatchNodeSummary {
    id: string;
    title: string | null;
    nodeType: CanvasNodeState['type'];
}
export interface SemanticWatchEdgeSummary {
    id: string;
    edgeType: CanvasEdge['type'];
    fromId: string;
    toId: string;
    fromTitle: string | null;
    toTitle: string | null;
}
export interface ContextPinWatchEvent {
    type: 'context-pin';
    timestamp?: string;
    sessionId?: string;
    added: SemanticWatchNodeSummary[];
    removed: SemanticWatchNodeSummary[];
}
export interface ConnectWatchEvent {
    type: 'connect';
    timestamp?: string;
    sessionId?: string;
    edges: SemanticWatchEdgeSummary[];
}
export interface RemoveWatchEvent {
    type: 'remove';
    timestamp?: string;
    sessionId?: string;
    nodes: SemanticWatchNodeSummary[];
    edges: SemanticWatchEdgeSummary[];
}
export interface GroupCreatedSummary {
    id: string;
    title: string | null;
    childCount: number;
}
export interface GroupUpdatedSummary {
    id: string;
    title: string | null;
    addedChildIds: string[];
    removedChildIds: string[];
    childCount: number;
}
export interface GroupWatchEvent {
    type: 'group';
    timestamp?: string;
    sessionId?: string;
    created: GroupCreatedSummary[];
    updated: GroupUpdatedSummary[];
}
export interface MoveEndNodeSummary extends SemanticWatchNodeSummary {
    reasons: string[];
}
export interface MoveEndWatchEvent {
    type: 'move-end';
    timestamp?: string;
    sessionId?: string;
    nodes: MoveEndNodeSummary[];
}
export type SemanticWatchEvent = ContextPinWatchEvent | ConnectWatchEvent | RemoveWatchEvent | GroupWatchEvent | MoveEndWatchEvent;
export interface SseMessage {
    event: string;
    data: unknown;
    id?: string;
}
export interface SemanticAttentionRegion {
    id: string;
    primaryNodeId: string;
    nodeIds: string[];
}
export interface SemanticAttentionSnapshot {
    layout: CanvasLayout | null;
    pinnedNodeIds: string[];
    primaryFocusNodeIds: string[];
    secondaryFocusNodeIds: string[];
    regions: SemanticAttentionRegion[];
    spatial: SpatialContext | null;
}
export declare function formatCompactWatchEvent(event: SemanticWatchEvent): string;
export declare class SemanticWatchReducer {
    private currentLayout;
    private currentPins;
    private previousSpatial;
    setInitialPins(nodeIds: string[]): void;
    getAttentionSnapshot(): SemanticAttentionSnapshot;
    handleMessage(message: SseMessage): SemanticWatchEvent[];
    private handleContextPinsChanged;
    private handleLayoutUpdate;
    private buildGroupEvent;
    private buildMoveEndEvent;
}
