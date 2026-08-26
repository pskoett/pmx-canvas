import type { AxApprovalStatus, AxEventKind, AxWorkItemStatus } from '../../shared/ax-kinds.js';
export type WorkItemStatus = AxWorkItemStatus;
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
    status: AxApprovalStatus;
    nodeIds: string[];
    createdAt: string;
    /** Unattended-approval TTL: when a pending gate auto-holds. */
    expiresAt: string | null;
}
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
    /** Consumer label this steer was addressed to; null/absent = broadcast. */
    target?: string | null;
    /** Who sent it — an agent label, or "browser" for the human's composer. */
    source?: string | null;
    /** Per-agent identity within the host — preferred over `source` for the row's sender. */
    agentId?: string | null;
    /** False until the target (or any consumer, for broadcasts) claims + marks it. */
    delivered?: boolean;
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
export type TimelineEntryKind = AxEventKind | 'evidence' | 'steer' | 'update';
/** Timeline filter chips: a handful of human categories over the many kinds. */
export type TimelineFilter = 'all' | 'update' | 'steer' | 'assistant' | 'event' | 'evidence';
export declare const timelineFilter: import("@preact/signals-core").Signal<TimelineFilter>;
/** Which chip an entry belongs to: board writes / steering-shaped rows / evidence / the rest. */
export declare function timelineCategory(kind: TimelineEntryKind): Exclude<TimelineFilter, 'all'>;
export interface TimelineEntry {
    id: string;
    kind: TimelineEntryKind;
    label: string;
    body: string;
    createdAt: string;
    /** Item 10: this agent edit is the top of the shared undo stack — "↩ undo this edit". */
    undoable?: boolean;
}
/** The entry Ctrl+Z would undo next, from GET /api/canvas/history. */
export declare const historyTop: import("@preact/signals-core").Signal<{
    id: string;
    actor: "human" | "agent";
    description: string;
} | null>;
/** Agent edits undone from the panel this page-life — rendered "undone · steering sent". */
export declare const undoneActivityIds: import("@preact/signals-core").Signal<Set<string>>;
/**
 * One reverse-chronological feed out of the three timeline tables plus the
 * agent's board writes (the presence activity feed), so the panel shows what
 * the agent DID between its tool runs and gates. The newest agent write gets
 * the undo affordance when it is also the top of the shared undo stack.
 */
export declare function mergeTimeline(timeline: AxTimelineView, limit?: number, writes?: Array<{
    id: string;
    at: string;
    op: string;
    summary: string;
}>, top?: {
    actor: 'human' | 'agent';
} | null, filter?: TimelineFilter): TimelineEntry[];
export declare const timelineEntries: import("@preact/signals-core").ReadonlySignal<TimelineEntry[]>;
export declare function refreshTimeline(): Promise<void>;
/**
 * Undo the agent's latest edit through the ONE shared undo stack (the same
 * POST /api/canvas/undo Ctrl+Z uses), then tell the agent: steering feedback
 * goes out through the same path a veto takes.
 */
export declare function undoAgentEdit(entry: TimelineEntry): Promise<boolean>;
/** Ctrl+Z / Ctrl+Shift+Z: whichever op is top of the shared stack, agent or human. */
export declare function undoFromKeyboard(redo?: boolean): Promise<boolean>;
/**
 * Resolve a gate through the existing AX path. A rejection also posts steering
 * feedback so the agent learns WHY its next turn — the same `vetoGhostSteering`
 * contract ghost vetoes use.
 */
export declare function resolveGate(gate: ApprovalGateView, decision: 'approved' | 'rejected'): Promise<boolean>;
/** Reopen an auto-held gate so it can be answered (fresh TTL). */
export declare function reopenGate(gate: ApprovalGateView): Promise<boolean>;
/** Post a steering message the agent reads on its next turn. */
export declare function sendSteering(message: string, target?: string | null): Promise<boolean>;
/** Attach a human-started session; the agent's writes are attributed to it. */
export declare function startSession(): Promise<boolean>;
/** End the attached session (whoever attached it) — the server answers with a receipt. */
export declare function endSession(session: {
    source: string;
    agentId: string | null;
}): Promise<boolean>;
export interface SessionReceipt {
    label: string;
    endedAt: string;
    /** Why it ended — the receipt should answer this, not leave the human asking. */
    endedBy?: 'human' | 'agent' | 'idle-timeout';
    /** The session changed nothing on the board (its pre-session snapshot was dropped). */
    unchanged?: boolean;
    counts: {
        items: number;
        done: number;
        vetoed: number;
    };
    snapshot: {
        id: string;
        name: string;
    } | null;
}
/** The last ended session's receipt (design item 2); client-side, cleared on dismiss. */
export declare const sessionReceipt: import("@preact/signals-core").Signal<SessionReceipt | null>;
export declare function applySessionReceipt(data: Record<string, unknown>): void;
export declare function dismissSessionReceipt(): void;
export declare function resetSessionStore(): void;
