export type WorkItemStatus = 'todo' | 'in-progress' | 'blocked' | 'done' | 'cancelled';
export interface WorkItemView {
    id: string;
    title: string;
    status: WorkItemStatus;
    detail: string | null;
    nodeIds: string[];
    updatedAt: string;
}
export interface ApprovalGateView {
    id: string;
    title: string;
    detail: string | null;
    status: 'pending' | 'approved' | 'rejected' | 'held';
    nodeIds: string[];
    createdAt: string;
    /** Unattended-approval TTL: when a pending gate auto-holds. */
    expiresAt: string | null;
}
export type AxEventKind = 'prompt' | 'assistant-message' | 'tool-start' | 'tool-result' | 'failure' | 'approval' | 'steering' | 'command' | 'note' | 'policy';
export interface AxEventView {
    id: string;
    kind: AxEventKind;
    summary: string;
    detail: string | null;
    createdAt: string;
}
export interface AxEvidenceView {
    id: string;
    title: string;
    body: string | null;
    createdAt: string;
}
export interface AxSteeringView {
    id: string;
    message: string;
    createdAt: string;
}
/**
 * Session panel data (rail-chrome-v2 phase 4). Nothing here is a second source
 * of truth: work items and gates come from the AX surface snapshot the SSE
 * bridge already refreshes on `ax-state-changed`; the timeline is the bounded
 * AX timeline read, refreshed on `ax-event-created` while a session is
 * attached. Gate decisions go through the existing resolve route.
 */
export interface ScopeFenceView {
    nodeIds: string[];
    padding: number;
}
export declare const sessionWorkItems: import("@preact/signals-core").ReadonlySignal<WorkItemView[]>;
export declare const sessionGates: import("@preact/signals-core").ReadonlySignal<ApprovalGateView[]>;
export declare const pendingGates: import("@preact/signals-core").ReadonlySignal<ApprovalGateView[]>;
/** The scope fence the human granted the session (null = unscoped). */
export declare const scopeFence: import("@preact/signals-core").ReadonlySignal<ScopeFenceView | null>;
/** Grant or clear the fence: writes outside it are refused server-side; reads stay open. */
export declare function setScopeFence(nodeIds: string[] | null): Promise<boolean>;
/** Auto-held gates: the policy said no on the human's behalf; they can be reopened. */
export declare const heldGates: import("@preact/signals-core").ReadonlySignal<ApprovalGateView[]>;
export interface AxTimelineView {
    events: AxEventView[];
    evidence: AxEvidenceView[];
    steering: AxSteeringView[];
}
export declare const axTimeline: import("@preact/signals-core").Signal<AxTimelineView>;
export type TimelineEntryKind = AxEventKind | 'evidence' | 'steer';
export interface TimelineEntry {
    id: string;
    kind: TimelineEntryKind;
    label: string;
    body: string;
    createdAt: string;
}
/** One reverse-chronological feed out of the three timeline tables. */
export declare function mergeTimeline(timeline: AxTimelineView, limit?: number): TimelineEntry[];
export declare const timelineEntries: import("@preact/signals-core").ReadonlySignal<TimelineEntry[]>;
export declare function refreshTimeline(): Promise<void>;
/**
 * Resolve a gate through the existing AX path. A rejection also posts steering
 * feedback so the agent learns WHY its next turn — the same `vetoGhostSteering`
 * contract ghost vetoes use.
 */
export declare function resolveGate(gate: ApprovalGateView, decision: 'approved' | 'rejected'): Promise<boolean>;
/** Reopen an auto-held gate so it can be answered (fresh TTL). */
export declare function reopenGate(gate: ApprovalGateView): Promise<boolean>;
export declare function resetSessionStore(): void;
