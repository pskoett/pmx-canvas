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
    status: 'pending' | 'approved' | 'rejected';
    nodeIds: string[];
    createdAt: string;
}
export type AxEventKind = 'prompt' | 'assistant-message' | 'tool-start' | 'tool-result' | 'failure' | 'approval' | 'steering' | 'command' | 'note';
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
export declare const sessionWorkItems: import("@preact/signals-core").ReadonlySignal<WorkItemView[]>;
export declare const sessionGates: import("@preact/signals-core").ReadonlySignal<ApprovalGateView[]>;
export declare const pendingGates: import("@preact/signals-core").ReadonlySignal<ApprovalGateView[]>;
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
export declare function resetSessionStore(): void;
