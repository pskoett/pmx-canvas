/**
 * AX read + wire-compat operations (plan-009 C1 slice 2): the GET read
 * surface (`ax/work`, `ax/approval`, `ax/review`, `ax/elicitation`,
 * `ax/mode`, `ax/command`, `ax/policy`, `ax/host-capability`, `ax/context`,
 * `ax/surface-snapshot`, `pinned-context`, `code-graph`) plus the three
 * remaining AX writes (`ax/activity` ingest, `ax/interaction` submit, and
 * the legacy `PATCH /api/canvas/ax` focus shape). Wire envelopes are
 * byte-identical to the legacy server.ts handlers they replace. HTTP-only:
 * the MCP read surface stays the composites/resources — no new tools, the
 * frozen 27-tool surface is untouched.
 *
 * This module must never import server.ts or index.ts.
 */
import { z } from 'zod';
import { buildAgentContextPreamble, serializeNodeForAgentContext } from '../../agent-context.js';
import { buildCanvasAxContext, buildCanvasAxSurfaceSnapshot } from '../../ax-context.js';
import { applyAxInteraction } from '../../ax-interaction.js';
import {
  isAxActivityKind,
  isAxEvidenceKind,
  type PmxAxEvidenceKind,
  type PmxAxReviewAnchorType,
  type PmxAxReviewKind,
  type PmxAxReviewSeverity,
  type PmxAxWorkItemStatus,
} from '../../ax-state.js';
import { canvasState, type CanvasNodeState } from '../../canvas-state.js';
import { buildCodeGraphSummary } from '../../code-graph.js';
import { defineOperation, OperationError, type Operation, type OperationContext } from '../types.js';
import { normalizeAxNodeIds, normalizeAxSource } from './ax-shared.js';
import { isRecord } from './nodes.js';

// ── Activity-reaction validation (moved from server.ts) ───────

const AX_WORK_STATUSES = new Set(['todo', 'in-progress', 'blocked', 'done', 'cancelled']);

function normalizeAxWorkItemStatus(value: unknown): PmxAxWorkItemStatus | undefined {
  return typeof value === 'string' && AX_WORK_STATUSES.has(value) ? (value as PmxAxWorkItemStatus) : undefined;
}

function isReviewSeverity(v: unknown): v is PmxAxReviewSeverity {
  return v === 'info' || v === 'warning' || v === 'error';
}
function isReviewKind(v: unknown): v is PmxAxReviewKind {
  return v === 'comment' || v === 'finding';
}
function isReviewAnchor(v: unknown): v is PmxAxReviewAnchorType {
  return v === 'node' || v === 'file' || v === 'region';
}

// Validate untrusted activity `reactions` from an HTTP body into the typed override
// shape ingestActivity expects. `false` suppresses a default reaction; an object
// overrides its fields (invalid fields are dropped, not stored raw).
function normalizeActivityReactions(input: Record<string, unknown>): {
  workItem?: false | { status?: PmxAxWorkItemStatus; detail?: string | null };
  evidence?: false | { kind?: PmxAxEvidenceKind; body?: string | null };
  review?:
    | false
    | {
        severity?: PmxAxReviewSeverity;
        kind?: PmxAxReviewKind;
        anchorType?: PmxAxReviewAnchorType;
        nodeId?: string | null;
      };
} {
  const out: ReturnType<typeof normalizeActivityReactions> = {};
  if (input.workItem === false) out.workItem = false;
  else if (isRecord(input.workItem)) {
    const status = normalizeAxWorkItemStatus(input.workItem.status);
    out.workItem = {
      ...(status ? { status } : {}),
      ...(typeof input.workItem.detail === 'string' ? { detail: input.workItem.detail } : {}),
    };
  }
  if (input.evidence === false) out.evidence = false;
  else if (isRecord(input.evidence)) {
    out.evidence = {
      ...(isAxEvidenceKind(input.evidence.kind) ? { kind: input.evidence.kind } : {}),
      ...(typeof input.evidence.body === 'string' ? { body: input.evidence.body } : {}),
    };
  }
  if (input.review === false) out.review = false;
  else if (isRecord(input.review)) {
    out.review = {
      ...(isReviewSeverity(input.review.severity) ? { severity: input.review.severity } : {}),
      ...(isReviewKind(input.review.kind) ? { kind: input.review.kind } : {}),
      ...(isReviewAnchor(input.review.anchorType) ? { anchorType: input.review.anchorType } : {}),
      ...(typeof input.review.nodeId === 'string' ? { nodeId: input.review.nodeId } : {}),
    };
  }
  return out;
}

// ── GET list/read factory ─────────────────────────────────────

const emptyShape = {};
const emptySchema = z.looseObject(emptyShape);

/** A no-input GET whose body is `{ ok: true, ...read() }` (legacy list shape). */
function defineAxListOperation(name: string, path: string, read: () => Record<string, unknown>): Operation {
  return defineOperation<z.infer<typeof emptySchema>, Record<string, unknown>>({
    name,
    mutates: false,
    input: emptySchema,
    inputShape: emptyShape,
    http: {
      method: 'GET',
      path,
    },
    handler: () => ({ ok: true, ...read() }),
  });
}

// ── ax.context.get / ax.surface-snapshot.get ──────────────────

const axContextShape = {
  consumer: z.unknown().optional().describe('Optional consumer label filtering the pending-delivery lead block'),
};
const axContextSchema = z.looseObject(axContextShape);

const axContextGetOperation = defineOperation<z.infer<typeof axContextSchema>, Record<string, unknown>>({
  name: 'ax.context.get',
  mutates: false,
  input: axContextSchema,
  inputShape: axContextShape,
  http: {
    method: 'GET',
    path: '/api/canvas/ax/context',
  },
  // Optional ?consumer= filters the compact `delivery` lead block (loop-safe — a
  // consumer never sees steering/activity it originated), so a host adapter can
  // inject its own un-truncated pending block per turn (report #54 hardening).
  handler: (input) => {
    const consumer = typeof input.consumer === 'string' ? input.consumer : undefined;
    return buildCanvasAxContext(consumer) as unknown as Record<string, unknown>;
  },
});

const axSurfaceSnapshotOperation = defineOperation<z.infer<typeof emptySchema>, Record<string, unknown>>({
  name: 'ax.surface-snapshot.get',
  mutates: false,
  input: emptySchema,
  inputShape: emptyShape,
  http: {
    method: 'GET',
    path: '/api/canvas/ax/surface-snapshot',
  },
  // Compact AX state for surfaces (the same shape seeded into AX-enabled iframes).
  // The client fetches this and pushes it to surfaces over the ax-update channel.
  handler: () => buildCanvasAxSurfaceSnapshot() as unknown as Record<string, unknown>,
});

// ── pinned-context.get ────────────────────────────────────────

const pinnedContextOperation = defineOperation<z.infer<typeof emptySchema>, Record<string, unknown>>({
  name: 'pinned-context.get',
  mutates: false,
  input: emptySchema,
  inputShape: emptyShape,
  http: {
    method: 'GET',
    path: '/api/canvas/pinned-context',
  },
  handler: () => {
    const pinnedIds = Array.from(canvasState.contextPinnedNodeIds);
    const nodes = pinnedIds
      .map((id) => canvasState.getNode(id))
      .filter((node): node is CanvasNodeState => node !== undefined);
    const preamble =
      pinnedIds.length > 0 ? buildAgentContextPreamble(nodes, { defaultTextLength: 700, webpageTextLength: 1600 }) : '';
    const serialized = nodes.map((node) =>
      serializeNodeForAgentContext(node, {
        defaultTextLength: 700,
        webpageTextLength: 1600,
        includePosition: true,
      }),
    );
    return { preamble, nodeIds: pinnedIds, count: pinnedIds.length, nodes: serialized };
  },
});

// ── code-graph.get ────────────────────────────────────────────

const codeGraphOperation = defineOperation<z.infer<typeof emptySchema>, Record<string, unknown>>({
  name: 'code-graph.get',
  mutates: false,
  input: emptySchema,
  inputShape: emptyShape,
  http: {
    method: 'GET',
    path: '/api/canvas/code-graph',
  },
  handler: () => buildCodeGraphSummary() as unknown as Record<string, unknown>,
});

// ── ax.activity.ingest ────────────────────────────────────────

const activityShape = {
  kind: z
    .unknown()
    .optional()
    .describe('Activity kind: tool-start, tool-result, failure, error, session-start, session-end, command, note'),
  title: z.unknown().optional().describe('Activity title'),
  summary: z.unknown().optional(),
  outcome: z.unknown().optional().describe('success or failure'),
  ref: z.unknown().optional().describe('File path, URL, or commit the activity refers to'),
  nodeIds: z.unknown().optional(),
  data: z.unknown().optional(),
  reactions: z.unknown().optional().describe('Override or suppress the kind-driven default reactions'),
  source: z.unknown().optional(),
};
const activitySchema = z.looseObject(activityShape);

// Report primitive A: ingest a harness-forwarded agent activity; the board auto-reacts.
const activityIngestOperation = defineOperation<z.infer<typeof activitySchema>, Record<string, unknown>>({
  name: 'ax.activity.ingest',
  mutates: false,
  input: activitySchema,
  inputShape: activityShape,
  http: {
    method: 'POST',
    path: '/api/canvas/ax/activity',
  },
  handler: (input, ctx: OperationContext) => {
    const body: Record<string, unknown> = input;
    if (!isAxActivityKind(body.kind)) {
      throw new OperationError(
        "activity requires a valid 'kind': one of tool-start, tool-result, failure, error, session-start, session-end, command, note.",
      );
    }
    if (typeof body.title !== 'string' || !body.title.trim()) {
      throw new OperationError('activity requires a title.');
    }
    const result = canvasState.ingestActivity(
      {
        kind: body.kind,
        title: body.title,
        ...(typeof body.summary === 'string' ? { summary: body.summary } : {}),
        ...(body.outcome === 'success' || body.outcome === 'failure' ? { outcome: body.outcome } : {}),
        ...(typeof body.ref === 'string' ? { ref: body.ref } : {}),
        ...(Array.isArray(body.nodeIds) ? { nodeIds: normalizeAxNodeIds(body.nodeIds) } : {}),
        ...(isRecord(body.data) ? { data: body.data } : {}),
        ...(isRecord(body.reactions) ? { reactions: normalizeActivityReactions(body.reactions) } : {}),
      },
      { source: normalizeAxSource(body.source, 'api') },
    );
    ctx.emit('ax-event-created', { event: result.event });
    if (result.workItem) ctx.emit('ax-state-changed', { workItem: result.workItem });
    if (result.evidence) ctx.emit('ax-event-created', { evidence: result.evidence });
    if (result.review) ctx.emit('ax-state-changed', { reviewAnnotation: result.review });
    return { ok: true, ...result };
  },
});

// ── ax.interaction.submit ─────────────────────────────────────

const interactionShape = {
  type: z.unknown().optional().describe('Interaction type, e.g. ax.work.create'),
  sourceNodeId: z.unknown().optional(),
  payload: z.unknown().optional(),
  sourceSurface: z.unknown().optional(),
  correlationId: z.unknown().optional(),
  source: z.unknown().optional(),
};
const interactionSchema = z.looseObject(interactionShape);

const interactionOperation = defineOperation<z.infer<typeof interactionSchema>, Record<string, unknown>>({
  name: 'ax.interaction.submit',
  mutates: false,
  input: interactionSchema,
  inputShape: interactionShape,
  http: {
    method: 'POST',
    path: '/api/canvas/ax/interaction',
    // Legacy wire: 200 when accepted, the envelope's own status when refused.
    status: (result) =>
      isRecord(result) && result.ok !== true && typeof result.status === 'number' ? result.status : 200,
  },
  handler: (input, ctx: OperationContext) => {
    const body: Record<string, unknown> = input;
    const { result, events } = applyAxInteraction(canvasState, body, normalizeAxSource(body.source, 'api'));
    for (const e of events) {
      ctx.emit(e.event, e.payload);
    }
    return result as unknown as Record<string, unknown>;
  },
});

// ── ax.state.patch (legacy PATCH /api/canvas/ax focus shape) ──

const statePatchShape = {
  focus: z.unknown().optional().describe('Focus object: { nodeIds, source? }'),
};
const statePatchSchema = z.looseObject(statePatchShape);

const statePatchOperation = defineOperation<z.infer<typeof statePatchSchema>, Record<string, unknown>>({
  name: 'ax.state.patch',
  mutates: false,
  input: statePatchSchema,
  inputShape: statePatchShape,
  http: {
    method: 'PATCH',
    path: '/api/canvas/ax',
  },
  handler: (input, ctx: OperationContext) => {
    const body: Record<string, unknown> = input;
    if (!body.focus || typeof body.focus !== 'object' || Array.isArray(body.focus)) {
      throw new OperationError('PATCH /api/canvas/ax currently requires a focus object.');
    }
    const focusInput = body.focus as Record<string, unknown>;
    const focus = canvasState.setAxFocus(normalizeAxNodeIds(focusInput.nodeIds), {
      source: normalizeAxSource(focusInput.source, 'api'),
    });
    ctx.emit('ax-state-changed', { focus });
    return { ok: true, state: canvasState.getAxState() };
  },
});

export const axReadOperations: Operation[] = [
  defineAxListOperation('ax.work.list', '/api/canvas/ax/work', () => ({ workItems: canvasState.getWorkItems() })),
  defineAxListOperation('ax.approval.list', '/api/canvas/ax/approval', () => ({
    approvalGates: canvasState.getApprovalGates(),
  })),
  defineAxListOperation('ax.review.list', '/api/canvas/ax/review', () => ({
    reviewAnnotations: canvasState.getReviewAnnotations(),
  })),
  defineAxListOperation('ax.elicitation.list', '/api/canvas/ax/elicitation', () => ({
    elicitations: canvasState.getElicitations(),
  })),
  defineAxListOperation('ax.mode.list', '/api/canvas/ax/mode', () => ({
    modeRequests: canvasState.getModeRequests(),
  })),
  defineAxListOperation('ax.command.list', '/api/canvas/ax/command', () => ({
    commands: canvasState.getCommandRegistry(),
  })),
  defineAxListOperation('ax.policy.get', '/api/canvas/ax/policy', () => ({ policy: canvasState.getPolicy() })),
  defineAxListOperation('ax.host-capability.get', '/api/canvas/ax/host-capability', () => ({
    host: canvasState.getHostCapability(),
  })),
  axContextGetOperation,
  axSurfaceSnapshotOperation,
  pinnedContextOperation,
  codeGraphOperation,
  activityIngestOperation,
  interactionOperation,
  statePatchOperation,
];
