/**
 * AX state manager.
 *
 * Owns the agent-experience (AX) state that previously lived inline in
 * `CanvasStateManager`. Splits cleanly into the three documented partitions
 * (see `docs/ax-state-contract.md`):
 *
 *   • Canvas-bound (`_axState`): focus, work items, approval gates, review
 *     annotations, elicitations, mode requests, policy. Snapshotted, cleared by
 *     `canvas_clear`, replaced by `restore`. Mutators record undo/redo history
 *     (via the injected `recordMutation` / `suppressed` callbacks).
 *   • Timeline (audit-only): agent events, evidence, steering. DB-direct, NOT in
 *     `_axState`, NOT history-recorded, NOT snapshotted, retention-bounded.
 *   • Host/session: a single host-capability row in its own table.
 *
 * `CanvasStateManager` holds one of these and DELEGATES its public AX methods to
 * it, so the SDK/HTTP/MCP surface is byte-stable. The manager takes injected
 * callbacks for everything it does not own: a node-id-validity provider (used by
 * normalization on write), the live DB handle, `scheduleSave`, `notifyChange`,
 * `recordMutation`, and a `suppressed` wrapper for history closures.
 */
import { type AxTimelineQuery } from './canvas-db.js';
import { type PmxAxActivityKind, type PmxAxElicitation, type PmxAxModeRequest, type PmxAxMode, type PmxAxCommandDescriptor, type PmxAxPolicy, type PmxAxFocusState, type PmxAxSource, type PmxAxState, type PmxAxWorkItem, type PmxAxWorkItemStatus, type PmxAxApprovalGate, type PmxAxReviewAnnotation, type PmxAxReviewKind, type PmxAxReviewSeverity, type PmxAxReviewStatus, type PmxAxReviewAnchorType, type PmxAxReviewRegion, type PmxAxEvent, type PmxAxEventKind, type PmxAxEvidence, type PmxAxEvidenceKind, type PmxAxSteeringMessage, type PmxAxHostCapability, type PmxAxTimelineSummary } from './ax-state.js';
import type { CanvasChangeType, MutationRecordInfo } from './canvas-state.js';
type Database = import('bun:sqlite').Database;
/** Host-environment hooks the AX manager needs from its owner (CanvasStateManager). */
export interface AxStateManagerDeps {
    /** Current valid node-id set — used by normalization on write to prune dangling refs. */
    getNodeIds(): Set<string>;
    /** Live DB handle for the timeline tables / host-capability table (null when no workspace). */
    getDb(): Database | null;
    /** Debounced save of the canvas-bound blob (timeline ops do NOT trigger this — they are DB-direct). */
    scheduleSave(): void;
    /** Emit a change notification (drives MCP resource notifications + blocking-wait endpoints). */
    notifyChange(type: CanvasChangeType): void;
    /** Record an undo/redo history entry. */
    recordMutation(info: MutationRecordInfo): void;
    /** Wrap a closure so it runs with mutation recording suppressed (for undo/redo replay). */
    suppressed(fn: () => void): () => void;
}
export declare class AxStateManager {
    private readonly deps;
    private _axState;
    private _axHostCapability;
    constructor(deps: AxStateManagerDeps);
    private normalizeForCurrentNodes;
    private applyAxState;
    /** Reset the canvas-bound partition to empty (used by clear() and applyPersistedState()). */
    resetCanvasBound(): void;
    /** Replace the canvas-bound partition from a persisted/restored blob, normalized against current nodes. */
    applyPersistedAx(ax: unknown): void;
    /** Load the host-capability row from its own table (own partition; not snapshotted). */
    loadHostCapabilityFromDb(): void;
    /**
     * Re-normalize the canvas-bound partition against the current node set after a
     * node was removed, and report what the removal orphaned. Work items / approval
     * gates / elicitations / mode requests keep the item but strip the dangling node
     * id ("re-anchored"); node-anchored review annotations are dropped ("removed").
     * Returns the affected ids so the owner can record one audit timeline event.
     */
    revalidateAfterNodeRemoval(removedNodeId: string): {
        reanchoredIds: string[];
        removedReviewIds: string[];
        reanchoredFocus: boolean;
    };
    getAxState(): PmxAxState;
    getAxFocus(): PmxAxFocusState;
    setAxFocus(nodeIds: string[], options?: {
        source?: PmxAxSource;
        recordHistory?: boolean;
    }): PmxAxFocusState;
    clearAxFocus(): PmxAxFocusState;
    getWorkItems(): PmxAxWorkItem[];
    addWorkItem(input: {
        title: string;
        status?: PmxAxWorkItemStatus;
        detail?: string | null;
        nodeIds?: string[];
    }, options?: {
        source?: PmxAxSource;
    }): PmxAxWorkItem;
    updateWorkItem(id: string, patch: {
        title?: string;
        status?: PmxAxWorkItemStatus;
        detail?: string | null;
        nodeIds?: string[];
    }, options?: {
        source?: PmxAxSource;
    }): PmxAxWorkItem | null;
    getApprovalGates(): PmxAxApprovalGate[];
    requestApproval(input: {
        title: string;
        detail?: string | null;
        action?: string | null;
        nodeIds?: string[];
    }, options?: {
        source?: PmxAxSource;
    }): PmxAxApprovalGate;
    resolveApproval(id: string, decision: 'approved' | 'rejected', options?: {
        resolution?: string;
        source?: PmxAxSource;
    }): PmxAxApprovalGate | null;
    getReviewAnnotations(): PmxAxReviewAnnotation[];
    addReviewAnnotation(input: {
        body: string;
        kind?: PmxAxReviewKind;
        severity?: PmxAxReviewSeverity;
        anchorType?: PmxAxReviewAnchorType;
        nodeId?: string | null;
        file?: string | null;
        region?: PmxAxReviewRegion | null;
        author?: string | null;
    }, options?: {
        source?: PmxAxSource;
    }): PmxAxReviewAnnotation | null;
    updateReviewAnnotation(id: string, patch: {
        body?: string;
        status?: PmxAxReviewStatus;
        severity?: PmxAxReviewSeverity;
        kind?: PmxAxReviewKind;
    }, options?: {
        source?: PmxAxSource;
    }): PmxAxReviewAnnotation | null;
    getHostCapability(): PmxAxHostCapability | null;
    getElicitations(): PmxAxElicitation[];
    requestElicitation(input: {
        prompt: string;
        fields?: string[];
        nodeIds?: string[];
    }, options?: {
        source?: PmxAxSource;
    }): PmxAxElicitation;
    respondElicitation(id: string, response: Record<string, unknown>, options?: {
        source?: PmxAxSource;
    }): PmxAxElicitation | null;
    getModeRequests(): PmxAxModeRequest[];
    requestMode(input: {
        mode: PmxAxMode;
        reason?: string | null;
        nodeIds?: string[];
    }, options?: {
        source?: PmxAxSource;
    }): PmxAxModeRequest;
    resolveModeRequest(id: string, decision: 'approved' | 'rejected', options?: {
        resolution?: string;
        source?: PmxAxSource;
    }): PmxAxModeRequest | null;
    getApproval(id: string): PmxAxApprovalGate | null;
    getElicitation(id: string): PmxAxElicitation | null;
    getModeRequest(id: string): PmxAxModeRequest | null;
    getCommandRegistry(): PmxAxCommandDescriptor[];
    /** Invoke a registry-gated PMX command intent — records a timeline event (no execution). */
    invokeCommand(name: string, args?: Record<string, unknown> | null, options?: {
        source?: PmxAxSource;
    }): PmxAxEvent | null;
    getPolicy(): PmxAxPolicy;
    /** Merge a declarative tool/prompt policy patch (canvas-bound, snapshotted). */
    setPolicy(patch: {
        tools?: Partial<PmxAxPolicy['tools']>;
        prompt?: Partial<PmxAxPolicy['prompt']>;
    }, _options?: {
        source?: PmxAxSource;
    }): PmxAxPolicy;
    setHostCapability(input: unknown, _options?: {
        source?: PmxAxSource;
    }): PmxAxHostCapability;
    recordAxEvent(input: {
        kind: PmxAxEventKind;
        summary: string;
        detail?: string | null;
        nodeIds?: string[];
        data?: Record<string, unknown> | null;
    }, options?: {
        source?: PmxAxSource;
    }): PmxAxEvent;
    addEvidence(input: {
        kind: PmxAxEvidenceKind;
        title: string;
        body?: string | null;
        ref?: string | null;
        nodeIds?: string[];
        data?: Record<string, unknown> | null;
    }, options?: {
        source?: PmxAxSource;
    }): PmxAxEvidence;
    recordSteeringMessage(message: string, options?: {
        source?: PmxAxSource;
    }): PmxAxSteeringMessage;
    markSteeringDelivered(id: string): boolean;
    /**
     * Ingest a normalized agent activity (a tool/session event a harness forwards)
     * and apply kind-driven board reactions, so the agent's real work flows back into
     * the board without it remembering to push each item (report primitive A — makes
     * AX bidirectional). Always records a timeline event; then, unless the caller
     * overrides/suppresses via `reactions`, applies defaults by kind/outcome:
     *   • failure | error | outcome==='failure' → work item (blocked) + review
     *     (finding/error, anchored to a valid nodeId else the `ref` file) + evidence (logs)
     *   • tool-result + outcome==='success'      → evidence (tool-result)
     *   • everything else (tool-start, session-*, command, note) → event only
     * A reaction value of `false` suppresses it; an object overrides its fields/forces it on.
     */
    ingestActivity(input: {
        kind: PmxAxActivityKind;
        title: string;
        summary?: string | null;
        outcome?: 'success' | 'failure';
        ref?: string | null;
        nodeIds?: string[];
        data?: Record<string, unknown> | null;
        reactions?: {
            workItem?: false | {
                status?: PmxAxWorkItemStatus;
                detail?: string | null;
            };
            evidence?: false | {
                kind?: PmxAxEvidenceKind;
                body?: string | null;
            };
            review?: false | {
                severity?: PmxAxReviewSeverity;
                kind?: PmxAxReviewKind;
                anchorType?: PmxAxReviewAnchorType;
                nodeId?: string | null;
            };
        };
    }, options?: {
        source?: PmxAxSource;
    }): {
        event: PmxAxEvent;
        workItem: PmxAxWorkItem | null;
        evidence: PmxAxEvidence | null;
        review: PmxAxReviewAnnotation | null;
    };
    getAxEvents(q?: AxTimelineQuery): PmxAxEvent[];
    getAxEvidence(q?: AxTimelineQuery): PmxAxEvidence[];
    getAxSteering(q?: AxTimelineQuery & {
        onlyPending?: boolean;
    }): PmxAxSteeringMessage[];
    /**
     * Undelivered steering for a consumer (Phase 4 delivery). Excludes messages
     * whose source equals the consumer to prevent delivery loops (e.g. Copilot
     * should not be handed back steering it originated).
     */
    getPendingSteering(options?: {
        consumer?: string;
        limit?: number;
    }): PmxAxSteeringMessage[];
    /**
     * NEWEST undelivered steering first, for the compact AX context lead block (report
     * #57) — so a fresh steer is visible even behind a long backlog. Loop-safe like
     * getPendingSteering, but ordered DESC instead of the FIFO ASC delivery queue.
     */
    getPendingSteeringForContext(options?: {
        consumer?: string;
        limit?: number;
    }): PmxAxSteeringMessage[];
    /** Total undelivered steering for a consumer (loop-safe), for the context backlog counts. */
    getPendingSteeringCount(consumer?: string): number;
    getAxTimelineSummary(): PmxAxTimelineSummary;
    getAxTimeline(q?: AxTimelineQuery): {
        events: PmxAxEvent[];
        evidence: PmxAxEvidence[];
        steering: PmxAxSteeringMessage[];
        summary: PmxAxTimelineSummary;
    };
}
export {};
