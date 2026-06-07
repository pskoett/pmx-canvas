/**
 * PMX-AX node interaction core (plan-004 Phase 1).
 *
 * One normalized envelope + capability model for node-originated AX interactions.
 * Eligible nodes emit a validated `PmxAxInteraction`; this module checks the
 * node's capabilities and payload, then maps the interaction onto the EXISTING
 * AX operations (work items, evidence, approvals, review, focus, steering,
 * events). It is host-agnostic and transport-agnostic — the same envelope backs
 * native node events, json-render actions, the sandboxed HTML bridge, MCP apps,
 * and host adapters (later phases).
 *
 * Decoupling: this module never imports the canvas-state singleton at runtime.
 * The dispatcher takes the manager via dependency injection (structural
 * `AxInteractionManager`), so it stays pure and unit-testable and introduces no
 * import cycle (canvas-state → canvas-provenance must not pull this in).
 */
import { z } from 'zod';
import type { CanvasNodeState } from './canvas-state.js';
import type { CanvasNodeType } from './canvas-provenance.js';
import type { PmxAxApprovalGate, PmxAxElicitation, PmxAxEvent, PmxAxEventKind, PmxAxEvidence, PmxAxEvidenceKind, PmxAxFocusState, PmxAxMode, PmxAxModeRequest, PmxAxReviewAnchorType, PmxAxReviewAnnotation, PmxAxReviewKind, PmxAxReviewRegion, PmxAxReviewSeverity, PmxAxSource, PmxAxSteeringMessage, PmxAxWorkItem, PmxAxWorkItemStatus } from './ax-state.js';
export declare const AX_INTERACTION_TYPES: readonly ["ax.event.record", "ax.steer", "ax.work.create", "ax.work.update", "ax.evidence.add", "ax.approval.request", "ax.approval.resolve", "ax.review.add", "ax.focus.set", "ax.command.invoke", "ax.elicitation.request", "ax.mode.request"];
export type AxInteractionType = (typeof AX_INTERACTION_TYPES)[number];
export type AxDeliveryMode = 'record-only' | 'notify-agent' | 'send-to-agent';
export interface NodeAxCapabilities {
    enabled: boolean;
    /** Interaction types this node may emit. Also the per-node override ceiling. */
    allowed: AxInteractionType[];
    /** Subset of `allowed` that should route through an approval gate (later phases). */
    requiresApproval: AxInteractionType[];
    delivery: AxDeliveryMode;
}
/**
 * Server-side default (and per-node ceiling) capabilities per node type, from the
 * plan's node capability matrix. `html`/`html-primitive`, `mcp-app`, and the
 * internal `prompt`/`response` types default to disabled (opt-in / later phases);
 * a node can anchor AX state but only eligible types may EMIT interactions.
 */
export declare const DEFAULT_NODE_AX_CAPABILITIES: Record<CanvasNodeType, NodeAxCapabilities>;
/** Validate caller-supplied per-node `data.axCapabilities` into a partial override. */
export declare function normalizeNodeAxCapabilities(value: unknown): Partial<NodeAxCapabilities> | null;
/**
 * Effective capabilities for a node: the type default merged with the node's own
 * `data.axCapabilities`. A per-node override can toggle `enabled` and NARROW
 * `allowed`, but never grant a type beyond the type's ceiling (security: a
 * pasted/generated node cannot escalate itself).
 */
export declare function resolveNodeAxCapabilities(node: CanvasNodeState): NodeAxCapabilities;
declare const InteractionEnvelopeSchema: z.ZodObject<{
    type: z.ZodEnum<{
        "ax.event.record": "ax.event.record";
        "ax.steer": "ax.steer";
        "ax.work.create": "ax.work.create";
        "ax.work.update": "ax.work.update";
        "ax.evidence.add": "ax.evidence.add";
        "ax.approval.request": "ax.approval.request";
        "ax.approval.resolve": "ax.approval.resolve";
        "ax.review.add": "ax.review.add";
        "ax.focus.set": "ax.focus.set";
        "ax.command.invoke": "ax.command.invoke";
        "ax.elicitation.request": "ax.elicitation.request";
        "ax.mode.request": "ax.mode.request";
    }>;
    sourceNodeId: z.ZodString;
    sourceSurface: z.ZodOptional<z.ZodEnum<{
        "mcp-app": "mcp-app";
        "json-render": "json-render";
        "native-node": "native-node";
        "html-node": "html-node";
        adapter: "adapter";
    }>>;
    actor: z.ZodOptional<z.ZodObject<{
        kind: z.ZodEnum<{
            agent: "agent";
            system: "system";
            human: "human";
        }>;
        id: z.ZodOptional<z.ZodString>;
        displayName: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    payload: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    correlationId: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type PmxAxInteraction = z.infer<typeof InteractionEnvelopeSchema>;
/** Caller-facing interaction input (payload optional; validated on apply). */
export interface AxInteractionInput {
    type: AxInteractionType;
    sourceNodeId: string;
    sourceSurface?: PmxAxInteraction['sourceSurface'];
    actor?: PmxAxInteraction['actor'];
    payload?: Record<string, unknown>;
    correlationId?: string;
    metadata?: Record<string, unknown>;
}
/**
 * Structural subset of CanvasStateManager that interaction dispatch needs.
 * Injected so this module stays free of a runtime canvas-state import.
 */
export interface AxInteractionManager {
    getNode(id: string): CanvasNodeState | undefined;
    recordAxEvent(input: {
        kind: PmxAxEventKind;
        summary: string;
        detail?: string | null;
        nodeIds?: string[];
        data?: Record<string, unknown> | null;
    }, options?: {
        source?: PmxAxSource;
    }): PmxAxEvent;
    recordSteeringMessage(message: string, options?: {
        source?: PmxAxSource;
    }): PmxAxSteeringMessage;
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
    setAxFocus(nodeIds: string[], options?: {
        source?: PmxAxSource;
    }): PmxAxFocusState;
    requestElicitation(input: {
        prompt: string;
        fields?: string[];
        nodeIds?: string[];
    }, options?: {
        source?: PmxAxSource;
    }): PmxAxElicitation;
    requestMode(input: {
        mode: PmxAxMode;
        reason?: string | null;
        nodeIds?: string[];
    }, options?: {
        source?: PmxAxSource;
    }): PmxAxModeRequest;
    invokeCommand(name: string, args?: Record<string, unknown> | null, options?: {
        source?: PmxAxSource;
    }): PmxAxEvent | null;
}
export interface AxInteractionEvent {
    event: string;
    payload: Record<string, unknown>;
}
export type AxInteractionPublicResult = {
    ok: true;
    type: AxInteractionType;
    sourceNodeId: string;
    primitive: unknown;
} | {
    ok: false;
    status: number;
    code: string;
    error: string;
};
export interface AxInteractionResult {
    result: AxInteractionPublicResult;
    events: AxInteractionEvent[];
}
/**
 * Validate + execute a node-originated AX interaction. Returns the public result
 * plus the SSE events the caller should emit (accepted/rejected outcome + the
 * underlying AX state event). Never throws on bad input — returns an `ok: false`
 * result with an appropriate HTTP-ish status.
 */
export declare function applyAxInteraction(manager: AxInteractionManager, rawBody: unknown, source: PmxAxSource): AxInteractionResult;
export {};
