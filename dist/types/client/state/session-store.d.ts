import type { AxApprovalStatus, AxEventKind, AxWorkItemStatus } from '../../shared/ax-kinds.js';
/** Explicit panel expansion, shared by the panel handle and the agent popover. */
export declare const sessionPanelOpened: import("@preact/signals-core").Signal<boolean>;
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
    resolvedBy?: {
        actor: 'human' | 'agent' | 'system' | 'unknown';
        source: string;
        agentId?: string;
    } | null;
    selfAnswer?: boolean;
}
export interface AxEventView {
    id: string;
    kind: AxEventKind;
    summary: string;
    detail: string | null;
    createdAt: string;
    /** Who recorded it — host/source label and per-agent identity. */
    source?: string | null;
    agentId?: string | null;
}
export interface AxEvidenceView {
    id: string;
    title: string;
    body: string | null;
    createdAt: string;
    source?: string | null;
    agentId?: string | null;
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
export declare const resolvedGates: import("@preact/signals-core").ReadonlySignal<ApprovalGateView[]>;
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
    /** Writer key for the row (agentId, else non-transport source; 'browser' = the human).
     * With several assistants on one board, a row without this is unanswerable:
     * "Assistant · 23:11" from WHOM? Null when only a bare transport is known. */
    who?: string | null;
    /** Item 10: this agent edit is the top of the shared undo stack — "↩ undo this edit". */
    undoable?: boolean;
}
/** The row's writer key: per-agent identity first, else a non-transport source. */
export declare function writerKeyFor(agentId?: string | null, source?: string | null): string | null;
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
    sessionId?: string;
    label?: string;
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
    /** Distinct labels of the sessions on this card (one unless merged). */
    labels: string[];
    /** Endings folded into this card (see applySessionReceipt). */
    sessions: number;
    /** When the session attached (the receipt's "This session · start–end"); null if unknown. */
    startedAt: string | null;
    endedAt: string;
    /** Why it ended — the receipt should answer this, not leave the human asking. */
    endedBy?: 'human' | 'agent' | 'idle-timeout';
    /** Cancelled (withdrawn items), rejected (human's explicit no on a gate), and
     * held (TTL expired unanswered) are three different outcomes — never one
     * "vetoed" pile. */
    counts: {
        items: number;
        done: number;
        cancelled: number;
        rejected: number;
        held: number;
    };
    /** The pre-session snapshot; null when the board was empty at attach, or on a
     * merged receipt (each session's snapshot is in History). */
    snapshot: {
        id: string;
        name: string;
        boardId: string | null;
    } | null;
    /** What the session did with context (docs/design/AgentContext.dc.html receipt). */
    context: SessionContextActivity;
}
export interface ReceiptNode {
    id: string;
    title: string;
    /** The board where this touch was recorded, for reopening a change's card. */
    boardId?: string;
    reason?: string;
    /** Edited cards: what the edit did ("rewrote the second paragraph"). */
    change?: string;
    /** Edited cards: the text before and at the session's end, cut around the first difference. */
    before?: string;
    after?: string;
}
/** Card ids are local to a board; receipts can remain open across board switches. */
export declare const receiptNodeKey: (node: ReceiptNode) => string;
export interface SessionContextActivity {
    read: ReceiptNode[];
    pinned: ReceiptNode[];
    created: ReceiptNode[];
    edited: ReceiptNode[];
    changedSinceRead: ReceiptNode[];
}
/**
 * The agent-activity lens: while on, nodes the last session did not touch
 * (read, pin, create, edit) are dimmed. Null when off.
 */
/**
 * The activity lens ("Dim untouched nodes"): off, one live session's touches
 * (the chip that was pressed), or the receipt's. A live lens hands over to the
 * receipt when that session ends, and switches off if its ending has none.
 */
export type ActivityLens = {
    kind: 'live';
    sessionId: string;
} | {
    kind: 'receipt';
} | null;
export declare const activityLens: import("@preact/signals-core").Signal<ActivityLens>;
export declare const activityLensNodeIds: import("@preact/signals-core").ReadonlySignal<Set<string> | null>;
/** Cards an agent edited in a live session or in the receipt's session: they carry the violet bar. */
export declare const sessionEditedIds: import("@preact/signals-core").ReadonlySignal<Set<string>>;
/** Turn the lens on for a live session (from its chip) or the receipt, or off. */
export declare function setActivityLens(on: boolean, live?: {
    sessionId: string;
}): void;
/** The last ended session's receipt (design item 2); client-side, cleared on dismiss. */
export declare const sessionReceipt: import("@preact/signals-core").Signal<SessionReceipt | null>;
/**
 * The receipt rule: a pop-up only for a top-level session that changed the
 * board or read/pinned context. `unchanged` endings and worker endings
 * (`parentAgentId` set — their orchestrator's receipt covers the board since
 * it attached) stay in the timeline and History only, and never replace or
 * extend an open receipt. Qualifying endings while one is up merge into it.
 */
export declare function applySessionReceipt(data: Record<string, unknown>): void;
/**
 * Undo on the receipt's Edited row (AgentContext.dc.html): each card back to
 * its content in the pre-session snapshot — the rest of the board stays.
 */
export declare function undoSessionEdits(snapshotId: string, edits: ReceiptNode[]): Promise<{
    ok: boolean;
    restored: string[];
}>;
export declare function dismissSessionReceipt(): void;
export declare function resetSessionStore(): void;
