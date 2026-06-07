import type { CanvasLayout, CanvasNodeState } from './canvas-state.js';
import type { AgentContextNode } from './agent-context.js';
export type PmxAxSource = 'agent' | 'api' | 'browser' | 'cli' | 'codex' | 'copilot' | 'mcp' | 'sdk' | 'system';
export interface PmxAxFocusState {
    nodeIds: string[];
    primaryNodeId: string | null;
    updatedAt: string | null;
    source: PmxAxSource | null;
}
export type PmxAxEventKind = 'prompt' | 'assistant-message' | 'tool-start' | 'tool-result' | 'failure' | 'approval' | 'steering';
export type PmxAxEvidenceKind = 'logs' | 'tool-result' | 'screenshot' | 'file' | 'diff' | 'test-output';
export type PmxAxWorkItemStatus = 'todo' | 'in-progress' | 'blocked' | 'done' | 'cancelled';
export type PmxAxApprovalStatus = 'pending' | 'approved' | 'rejected';
export type PmxAxReviewKind = 'comment' | 'finding';
export type PmxAxReviewSeverity = 'info' | 'warning' | 'error';
export type PmxAxReviewStatus = 'open' | 'resolved' | 'dismissed';
export type PmxAxReviewAnchorType = 'node' | 'file' | 'region';
export interface PmxAxWorkItem {
    id: string;
    title: string;
    status: PmxAxWorkItemStatus;
    detail: string | null;
    nodeIds: string[];
    createdAt: string;
    updatedAt: string;
    source: PmxAxSource | null;
}
export interface PmxAxApprovalGate {
    id: string;
    title: string;
    detail: string | null;
    action: string | null;
    status: PmxAxApprovalStatus;
    nodeIds: string[];
    createdAt: string;
    resolvedAt: string | null;
    resolution: string | null;
    source: PmxAxSource | null;
}
export interface PmxAxReviewRegion {
    line?: number;
    endLine?: number;
    label?: string;
}
export interface PmxAxReviewAnnotation {
    id: string;
    kind: PmxAxReviewKind;
    body: string;
    severity: PmxAxReviewSeverity;
    status: PmxAxReviewStatus;
    anchorType: PmxAxReviewAnchorType;
    nodeId: string | null;
    file: string | null;
    region: PmxAxReviewRegion | null;
    author: string | null;
    createdAt: string;
    updatedAt: string;
    source: PmxAxSource | null;
}
export interface PmxAxEvent {
    id: string;
    seq: number;
    kind: PmxAxEventKind;
    summary: string;
    detail: string | null;
    nodeIds: string[];
    data: Record<string, unknown> | null;
    createdAt: string;
    source: PmxAxSource | null;
}
export interface PmxAxEvidence {
    id: string;
    seq: number;
    kind: PmxAxEvidenceKind;
    title: string;
    body: string | null;
    ref: string | null;
    nodeIds: string[];
    data: Record<string, unknown> | null;
    createdAt: string;
    source: PmxAxSource | null;
}
export interface PmxAxSteeringMessage {
    id: string;
    seq: number;
    message: string;
    delivered: boolean;
    createdAt: string;
    source: PmxAxSource | null;
}
export interface PmxAxHostCapability {
    host: string | null;
    canvas: boolean;
    hooks: boolean;
    tools: boolean;
    sessionMessaging: boolean;
    permissions: boolean;
    files: boolean;
    uiPrompts: boolean;
    reportedAt: string | null;
    raw: Record<string, unknown> | null;
}
export interface PmxAxTimelineSummary {
    recentEvents: PmxAxEvent[];
    recentEvidence: PmxAxEvidence[];
    pendingSteering: PmxAxSteeringMessage[];
    counts: {
        events: number;
        evidence: number;
        steering: number;
    };
}
export declare const AX_TIMELINE_RETENTION = 500;
export declare const AX_TIMELINE_DEFAULT_LIMIT = 50;
export declare const AX_TIMELINE_MAX_LIMIT = 200;
export declare const AX_CONTEXT_EVENT_LIMIT = 20;
export declare const AX_CONTEXT_EVIDENCE_LIMIT = 10;
export declare const AX_CONTEXT_STEERING_LIMIT = 10;
export interface PmxAxState {
    version: 1;
    focus: PmxAxFocusState;
    workItems: PmxAxWorkItem[];
    approvalGates: PmxAxApprovalGate[];
    reviewAnnotations: PmxAxReviewAnnotation[];
    elicitations: PmxAxElicitation[];
    modeRequests: PmxAxModeRequest[];
}
export interface PmxAxPinnedContext {
    preamble: string;
    nodeIds: string[];
    count: number;
    nodes: AgentContextNode[];
}
export interface PmxAxFocusContext extends PmxAxFocusState {
    nodes: AgentContextNode[];
}
export interface PmxAxContext {
    version: 1;
    generatedAt: string;
    surface: {
        nodeCount: number;
        edgeCount: number;
    };
    pinned: PmxAxPinnedContext;
    focus: PmxAxFocusContext;
    workItems: PmxAxWorkItem[];
    approvalGates: PmxAxApprovalGate[];
    reviewAnnotations: PmxAxReviewAnnotation[];
    elicitations: PmxAxElicitation[];
    modeRequests: PmxAxModeRequest[];
    timeline: PmxAxTimelineSummary;
    host: PmxAxHostCapability | null;
}
export declare function isAxEventKind(value: unknown): value is PmxAxEventKind;
export declare function isAxEvidenceKind(value: unknown): value is PmxAxEvidenceKind;
export declare function createEmptyAxFocusState(): PmxAxFocusState;
export type PmxAxElicitationStatus = 'pending' | 'answered' | 'cancelled';
export interface PmxAxElicitation {
    id: string;
    prompt: string;
    fields: string[];
    status: PmxAxElicitationStatus;
    response: Record<string, unknown> | null;
    nodeIds: string[];
    createdAt: string;
    resolvedAt: string | null;
    source: PmxAxSource | null;
}
export declare function normalizeAxElicitation(input: unknown, validNodeIds?: Set<string>): PmxAxElicitation | null;
export declare function createAxElicitation(input: {
    prompt: string;
    fields?: string[];
    nodeIds?: string[];
}, source: PmxAxSource | null, validNodeIds?: Set<string>): PmxAxElicitation;
export type PmxAxMode = 'plan' | 'execute' | 'autonomous';
export type PmxAxModeRequestStatus = 'pending' | 'approved' | 'rejected';
export interface PmxAxModeRequest {
    id: string;
    mode: PmxAxMode;
    reason: string | null;
    status: PmxAxModeRequestStatus;
    nodeIds: string[];
    createdAt: string;
    resolvedAt: string | null;
    resolution: string | null;
    source: PmxAxSource | null;
}
export declare function normalizeAxModeRequest(input: unknown, validNodeIds?: Set<string>): PmxAxModeRequest | null;
export declare function createAxModeRequest(input: {
    mode: PmxAxMode;
    reason?: string | null;
    nodeIds?: string[];
}, source: PmxAxSource | null, validNodeIds?: Set<string>): PmxAxModeRequest;
export declare function createEmptyAxState(): PmxAxState;
export declare function createEmptyAxHostCapability(): PmxAxHostCapability;
export declare function normalizeAxFocusState(input: unknown, validNodeIds?: Set<string>): PmxAxFocusState;
export declare function normalizeAxWorkItem(input: unknown, validNodeIds?: Set<string>): PmxAxWorkItem | null;
export declare function normalizeAxApprovalGate(input: unknown, validNodeIds?: Set<string>): PmxAxApprovalGate | null;
export declare function normalizeAxReviewAnnotation(input: unknown, validNodeIds?: Set<string>): PmxAxReviewAnnotation | null;
export declare function normalizeAxHostCapability(input: unknown): PmxAxHostCapability | null;
export declare function normalizeAxEvent(input: unknown): PmxAxEvent | null;
export declare function normalizeAxEvidence(input: unknown): PmxAxEvidence | null;
export declare function normalizeAxSteeringMessage(input: unknown): PmxAxSteeringMessage | null;
export declare function createAxWorkItem(input: {
    title: string;
    status?: PmxAxWorkItemStatus;
    detail?: string | null;
    nodeIds?: string[];
}, source: PmxAxSource | null, validNodeIds?: Set<string>): PmxAxWorkItem;
export declare function createAxApprovalGate(input: {
    title: string;
    detail?: string | null;
    action?: string | null;
    nodeIds?: string[];
}, source: PmxAxSource | null, validNodeIds?: Set<string>): PmxAxApprovalGate;
export declare function createAxReviewAnnotation(input: {
    body: string;
    kind?: PmxAxReviewKind;
    severity?: PmxAxReviewSeverity;
    anchorType?: PmxAxReviewAnchorType;
    nodeId?: string | null;
    file?: string | null;
    region?: PmxAxReviewRegion | null;
    author?: string | null;
}, source: PmxAxSource | null): PmxAxReviewAnnotation;
export declare function createAxEvent(input: {
    kind: PmxAxEventKind;
    summary: string;
    detail?: string | null;
    nodeIds?: string[];
    data?: Record<string, unknown> | null;
}, source: PmxAxSource | null): Omit<PmxAxEvent, 'seq'>;
export declare function createAxEvidence(input: {
    kind: PmxAxEvidenceKind;
    title: string;
    body?: string | null;
    ref?: string | null;
    nodeIds?: string[];
    data?: Record<string, unknown> | null;
}, source: PmxAxSource | null): Omit<PmxAxEvidence, 'seq'>;
export declare function createAxSteeringMessage(message: string, source: PmxAxSource | null): Omit<PmxAxSteeringMessage, 'seq'>;
export declare function normalizeAxState(input: unknown, validNodeIds?: Set<string>): PmxAxState;
export declare function buildAxContext(input: {
    layout: CanvasLayout;
    pinned: PmxAxPinnedContext;
    focus: PmxAxFocusState;
    focusNodes: AgentContextNode[];
    workItems: PmxAxWorkItem[];
    approvalGates: PmxAxApprovalGate[];
    reviewAnnotations: PmxAxReviewAnnotation[];
    elicitations: PmxAxElicitation[];
    modeRequests: PmxAxModeRequest[];
    timeline: PmxAxTimelineSummary;
    host: PmxAxHostCapability | null;
}): PmxAxContext;
export declare function nodeSetFromLayout(nodes: CanvasNodeState[]): Set<string>;
