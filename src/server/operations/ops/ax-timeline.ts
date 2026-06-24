/**
 * Plan-007 Slice B (wave 3) operations: the AX timeline writes, the timeline
 * read, the adapterless delivery surface, and the allowlist-gated command
 * invoke —
 *   ax.event.record   / canvas_record_ax_event
 *   ax.evidence.add   / canvas_add_evidence
 *   ax.steer          / canvas_send_steering
 *   ax.timeline.get   / canvas_get_ax_timeline
 *   ax.delivery.pending / canvas_claim_ax_delivery
 *   ax.delivery.mark  / canvas_mark_ax_delivery
 *   ax.command.invoke / canvas_invoke_command
 *
 * Like the wave-1/2 AX ops, none of these change the node/edge layout, so every
 * op is `mutates: false` (no `canvas-layout-update`).
 *
 * SSE differs from waves 1–2: the TIMELINE ops do NOT emit `ax-state-changed`.
 * Confirmed against the legacy server.ts handlers + mcp/server.ts tools:
 *  - record / evidence / steer / command → `ax-event-created` with the same
 *    single-key payload the legacy handlers broadcast (`{ event }`, `{ evidence }`,
 *    `{ steering }`, `{ event }`). The injected emitter adds the sessionId/timestamp
 *    envelope (see server.ts emitPrimaryWorkbenchEvent).
 *  - delivery.mark → `ax-event-created` with `{ steeringDelivered: id }`, but ONLY
 *    when the message was actually marked delivered (legacy handleAxDeliveryMark).
 *  - reads (timeline.get, delivery.pending) emit nothing.
 *
 * Source defaulting matches the legacy surfaces exactly: MCP `buildInput`
 * injects `source: 'mcp'`; the HTTP handlers default an absent source to 'api'.
 * `delivery.pending` is the exception — its `consumer` is NOT a source label and
 * is never defaulted (loop-safety scoping is opt-in, byte-stable with legacy).
 *
 * Wire-body reconciliation (one op = one wire body; documented, same class as
 * the wave-1 `ax.get` aggregate broadening):
 *  - ax.delivery.pending: the legacy HTTP route served only `{ ok, pending }`,
 *    while the legacy `canvas_claim_ax_delivery` MCP tool served
 *    `{ ok, pending, pendingActivity }`. `formatResult` receives the SERIALIZED
 *    wire body, so the handler must return the full aggregate (including
 *    `pendingActivity`) and there is NO serialize override — the HTTP body now
 *    also carries `pendingActivity`. (No HTTP test asserted the slim body; the
 *    server-api delivery test only reads `body.pending`.)
 *
 * Allowlist gate preserved byte-for-byte:
 *  - ax.command.invoke: canvasState.invokeCommand returns null for an unknown
 *    command name → OperationError("Unknown command \"<name>\".", 400), matching
 *    the legacy HTTP 400 body. (The MCP tool surfaces it as an isError result.)
 *
 * This module must never import server.ts or index.ts.
 */
import { z } from 'zod';
import { canvasState } from '../../canvas-state.js';
import { buildPendingAxActivity, isAxEventKind, isAxEvidenceKind } from '../../ax-state.js';
import type { PmxAxEventKind, PmxAxEvidenceKind } from '../../ax-state.js';
import { defineOperation, OperationError, type Operation } from '../types.js';
import { isRecord } from './nodes.js';
import { AX_SOURCE_SHAPE, axJsonResult, normalizeAxNodeIds, normalizeAxSource } from './ax-shared.js';

const AX_EVENT_KINDS = ['prompt', 'assistant-message', 'tool-start', 'tool-result', 'failure', 'approval', 'steering'] as const;
const AX_EVIDENCE_KINDS = ['logs', 'tool-result', 'screenshot', 'file', 'diff', 'test-output'] as const;

// ── ax.event.record (canvas_record_ax_event) ──────────────────

const axEventRecordShape = {
  kind: z.unknown().optional().describe('Normalized event kind.'),
  summary: z.unknown().optional().describe('Short human-readable summary of the event.'),
  detail: z.unknown().optional().describe('Optional longer detail or payload text.'),
  nodeIds: z.unknown().optional().describe('Optional node IDs this event relates to.'),
  data: z.unknown().optional().describe('Optional structured data payload.'),
  source: z.unknown().optional().describe('Optional host/source label. Defaults to mcp.'),
};

const axEventRecordSchema = z.looseObject(axEventRecordShape);

const axEventRecordOperation = defineOperation<z.infer<typeof axEventRecordSchema>, Record<string, unknown>>({
  name: 'ax.event.record',
  mutates: false,
  input: axEventRecordSchema,
  inputShape: axEventRecordShape,
  http: {
    method: 'POST',
    path: '/api/canvas/ax/event',
  },
  mcp: {
    toolName: 'canvas_record_ax_event',
    description: 'Record a normalized AX timeline event (prompt/assistant-message/tool-start/tool-result/failure/approval/steering). Timeline events persist for diagnostics and continuity but are not restored by snapshots.',
    extraShape: {
      kind: z.enum(AX_EVENT_KINDS).describe('Normalized event kind.'),
      summary: z.string().describe('Short human-readable summary of the event.'),
      detail: z.string().optional().describe('Optional longer detail or payload text.'),
      nodeIds: z.array(z.string()).optional().describe('Optional node IDs this event relates to.'),
      data: z.record(z.string(), z.unknown()).optional().describe('Optional structured data payload.'),
      source: AX_SOURCE_SHAPE,
    },
    buildInput: (input) => ({ ...input, source: normalizeAxSource(input.source, 'mcp') }),
    formatResult: axJsonResult,
  },
  handler: (input, ctx) => {
    if (!isAxEventKind(input.kind) || typeof input.summary !== 'string') {
      throw new OperationError('event requires kind and summary.');
    }
    const event = canvasState.recordAxEvent(
      {
        kind: input.kind as PmxAxEventKind,
        summary: input.summary,
        detail: typeof input.detail === 'string' ? input.detail : null,
        nodeIds: normalizeAxNodeIds(input.nodeIds),
        data: isRecord(input.data) ? input.data : null,
      },
      { source: normalizeAxSource(input.source, 'api') },
    );
    ctx.emit('ax-event-created', { event });
    return { ok: true, event } as unknown as Record<string, unknown>;
  },
});

// ── ax.evidence.add (canvas_add_evidence) ─────────────────────

const axEvidenceAddShape = {
  kind: z.unknown().optional().describe('Evidence kind.'),
  title: z.unknown().optional().describe('Short human-readable title for the evidence.'),
  body: z.unknown().optional().describe('Optional inline body/content.'),
  ref: z.unknown().optional().describe('Optional reference (path, URL, or external locator).'),
  nodeIds: z.unknown().optional().describe('Optional node IDs this evidence relates to.'),
  data: z.unknown().optional().describe('Optional structured data payload.'),
  source: z.unknown().optional().describe('Optional host/source label. Defaults to mcp.'),
};

const axEvidenceAddSchema = z.looseObject(axEvidenceAddShape);

const axEvidenceAddOperation = defineOperation<z.infer<typeof axEvidenceAddSchema>, Record<string, unknown>>({
  name: 'ax.evidence.add',
  mutates: false,
  input: axEvidenceAddSchema,
  inputShape: axEvidenceAddShape,
  http: {
    method: 'POST',
    path: '/api/canvas/ax/evidence',
  },
  mcp: {
    toolName: 'canvas_add_evidence',
    description: 'Record an AX evidence item (logs/tool-result/screenshot/file/diff/test-output) on the timeline. Evidence persists for diagnostics and continuity but is not restored by snapshots; exposed via canvas://ax-timeline.',
    extraShape: {
      kind: z.enum(AX_EVIDENCE_KINDS).describe('Evidence kind.'),
      title: z.string().describe('Short human-readable title for the evidence.'),
      body: z.string().optional().describe('Optional inline body/content.'),
      ref: z.string().optional().describe('Optional reference (path, URL, or external locator).'),
      nodeIds: z.array(z.string()).optional().describe('Optional node IDs this evidence relates to.'),
      data: z.record(z.string(), z.unknown()).optional().describe('Optional structured data payload.'),
      source: AX_SOURCE_SHAPE,
    },
    buildInput: (input) => ({ ...input, source: normalizeAxSource(input.source, 'mcp') }),
    formatResult: axJsonResult,
  },
  handler: (input, ctx) => {
    if (!isAxEvidenceKind(input.kind) || typeof input.title !== 'string' || !input.title.trim()) {
      throw new OperationError('evidence requires kind and title.');
    }
    const evidence = canvasState.addEvidence(
      {
        kind: input.kind as PmxAxEvidenceKind,
        title: input.title,
        body: typeof input.body === 'string' ? input.body : null,
        ref: typeof input.ref === 'string' ? input.ref : null,
        nodeIds: normalizeAxNodeIds(input.nodeIds),
        data: isRecord(input.data) ? input.data : null,
      },
      { source: normalizeAxSource(input.source, 'api') },
    );
    ctx.emit('ax-event-created', { evidence });
    return { ok: true, evidence } as unknown as Record<string, unknown>;
  },
});

// ── ax.steer (canvas_send_steering) ───────────────────────────

const axSteerShape = {
  message: z.unknown().optional().describe('The steering instruction to deliver to the active agent session.'),
  source: z.unknown().optional().describe('Optional host/source label. Defaults to mcp.'),
};

const axSteerSchema = z.looseObject(axSteerShape);

const axSteerOperation = defineOperation<z.infer<typeof axSteerSchema>, Record<string, unknown>>({
  name: 'ax.steer',
  mutates: false,
  input: axSteerSchema,
  inputShape: axSteerShape,
  http: {
    method: 'POST',
    path: '/api/canvas/ax/steer',
  },
  mcp: {
    toolName: 'canvas_send_steering',
    description: 'Record a steering message: a user instruction from the surface to the active agent session. Persisted on the AX timeline and exposed via canvas://ax-timeline.',
    extraShape: {
      message: z.string().describe('The steering instruction to deliver to the active agent session.'),
      source: AX_SOURCE_SHAPE,
    },
    buildInput: (input) => ({ ...input, source: normalizeAxSource(input.source, 'mcp') }),
    formatResult: axJsonResult,
  },
  handler: (input, ctx) => {
    if (typeof input.message !== 'string' || !input.message.trim()) {
      throw new OperationError('steer requires a non-empty message.');
    }
    const steering = canvasState.recordSteeringMessage(input.message, {
      source: normalizeAxSource(input.source, 'api'),
    });
    ctx.emit('ax-event-created', { steering });
    return { ok: true, steering } as unknown as Record<string, unknown>;
  },
});

// ── ax.timeline.get (canvas_get_ax_timeline) ──────────────────

const axTimelineGetShape = {
  limit: z.unknown().optional().describe('Max rows per timeline table (default 50, max 200).'),
};

const axTimelineGetSchema = z.looseObject(axTimelineGetShape);

const axTimelineGetOperation = defineOperation<z.infer<typeof axTimelineGetSchema>, Record<string, unknown>>({
  name: 'ax.timeline.get',
  mutates: false,
  input: axTimelineGetSchema,
  inputShape: axTimelineGetShape,
  http: {
    method: 'GET',
    path: '/api/canvas/ax/timeline',
  },
  mcp: {
    toolName: 'canvas_get_ax_timeline',
    description: 'Read the bounded AX timeline: recent agent-events, evidence, and steering messages plus counts. Use this for diagnostics and session continuity.',
    extraShape: {
      limit: z.number().optional().describe('Max rows per timeline table (default 50, max 200).'),
    },
    formatResult: axJsonResult,
  },
  handler: (input) => {
    // `limit` arrives as a number over MCP or a string over the HTTP query;
    // Number() normalizes both. Only a finite positive limit is forwarded.
    const limit = Number(input.limit ?? '');
    const timeline = canvasState.getAxTimeline(
      Number.isFinite(limit) && limit > 0 ? { limit } : {},
    );
    return { ok: true, ...timeline } as unknown as Record<string, unknown>;
  },
});

// ── ax.delivery.pending (canvas_claim_ax_delivery) ────────────

const axDeliveryPendingShape = {
  consumer: z.unknown().optional().describe('Consumer/source label to exclude from results (e.g. copilot, mcp).'),
  limit: z.unknown().optional().describe('Max steering messages to return.'),
  order: z.unknown().optional().describe('"oldest" (FIFO, default) or "newest" first.'),
};

const axDeliveryPendingSchema = z.looseObject(axDeliveryPendingShape);

const axDeliveryPendingOperation = defineOperation<z.infer<typeof axDeliveryPendingSchema>, Record<string, unknown>>({
  name: 'ax.delivery.pending',
  mutates: false,
  input: axDeliveryPendingSchema,
  inputShape: axDeliveryPendingShape,
  http: {
    method: 'GET',
    path: '/api/canvas/ax/delivery/pending',
  },
  mcp: {
    toolName: 'canvas_claim_ax_delivery',
    description: 'Claim pending PMX AX deliveries for a consumer (adapterless delivery). Returns `pending` undelivered steering (mark each with canvas_mark_ax_delivery after acting) AND `pendingActivity`: open canvas-bound AX items awaiting the agent (open work items, pending approval gates / elicitations / mode requests) — typically created by the human in the browser. Both exclude items the consumer itself originated (loop prevention). `pending` defaults to oldest-first (FIFO, for ordered processing); pass `order:"newest"` to surface the human\'s LATEST in-canvas steering first when a small `limit` would otherwise bury it behind a stale backlog (report #68). pendingActivity is read-only here: resolve each via its own tool (canvas_resolve_approval / canvas_respond_elicitation / canvas_resolve_mode / canvas_update_work_item), not canvas_mark_ax_delivery.',
    extraShape: {
      consumer: z.string().optional().describe('Consumer/source label to exclude from results (e.g. copilot, mcp).'),
      limit: z.number().optional().describe('Max steering messages to return.'),
      order: z.enum(['newest', 'oldest']).optional().describe('Order of returned steering: "oldest" (FIFO, default) for ordered processing, or "newest" first to see the latest browser action when limited.'),
    },
    // `consumer` is a loop-safety scope, not a source label — never defaulted.
    formatResult: axJsonResult,
  },
  handler: (input) => {
    const consumer = typeof input.consumer === 'string' ? input.consumer : undefined;
    const limitRaw = Number(input.limit ?? '');
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;
    // #68: default FIFO (oldest-first) for ordered processing; `order:"newest"`
    // surfaces the latest browser-originated steering first so a small `limit`
    // can't bury the human's current action behind stale undelivered rows. Both
    // queries apply the same loop-safe consumer filter before the limit.
    const newest = input.order === 'newest';
    const scope = { ...(consumer ? { consumer } : {}), ...(limit ? { limit } : {}) };
    const pending = newest
      ? canvasState.getPendingSteeringForContext(scope)
      : canvasState.getPendingSteering(scope);
    // The MCP tool aggregated pendingActivity; one wire body now serves it over
    // HTTP too (documented broadening). Loop-safe: consumer scopes both queries.
    const pendingActivity = buildPendingAxActivity(canvasState.getAxState(), consumer);
    return { ok: true, pending, pendingActivity } as unknown as Record<string, unknown>;
  },
});

// ── ax.delivery.mark (canvas_mark_ax_delivery) ────────────────

const axDeliveryMarkShape = {
  id: z.string().optional().catch(undefined).describe('The steering message id to mark delivered.'),
};

const axDeliveryMarkSchema = z.looseObject(axDeliveryMarkShape);

const axDeliveryMarkOperation = defineOperation<z.infer<typeof axDeliveryMarkSchema>, Record<string, unknown>>({
  name: 'ax.delivery.mark',
  mutates: false,
  input: axDeliveryMarkSchema,
  inputShape: axDeliveryMarkShape,
  http: {
    method: 'POST',
    path: '/api/canvas/ax/delivery/:id/mark',
  },
  mcp: {
    toolName: 'canvas_mark_ax_delivery',
    description: 'Mark a PMX AX steering message as delivered so it is not handed out again.',
    extraShape: {
      id: z.string().describe('The steering message id to mark delivered.'),
    },
    formatResult: axJsonResult,
  },
  handler: (input, ctx) => {
    const id = typeof input.id === 'string' ? input.id : '';
    const delivered = canvasState.markSteeringDelivered(id);
    // Legacy handleAxDeliveryMark only broadcasts when a message was marked.
    if (delivered) {
      ctx.emit('ax-event-created', { steeringDelivered: id });
    }
    return { ok: true, delivered } as unknown as Record<string, unknown>;
  },
});

// ── ax.command.invoke (canvas_invoke_command) ─────────────────

const axCommandInvokeShape = {
  name: z.unknown().optional().describe('A command name from the PMX command registry.'),
  args: z.unknown().optional(),
  source: z.unknown().optional().describe('Optional host/source label. Defaults to mcp.'),
};

const axCommandInvokeSchema = z.looseObject(axCommandInvokeShape);

const axCommandInvokeOperation = defineOperation<z.infer<typeof axCommandInvokeSchema>, Record<string, unknown>>({
  name: 'ax.command.invoke',
  mutates: false,
  input: axCommandInvokeSchema,
  inputShape: axCommandInvokeShape,
  http: {
    method: 'POST',
    path: '/api/canvas/ax/command',
  },
  mcp: {
    toolName: 'canvas_invoke_command',
    description: 'Invoke a registry-gated PMX command intent (pmx.plan | pmx.execute | pmx.promote-context | pmx.summarize | pmx.review). Records a timeline event a host/agent can observe — NOT arbitrary execution; unknown names are rejected.',
    extraShape: {
      name: z.string().describe('A command name from the PMX command registry.'),
      args: z.record(z.string(), z.unknown()).optional(),
      source: AX_SOURCE_SHAPE,
    },
    buildInput: (input) => ({ ...input, source: normalizeAxSource(input.source, 'mcp') }),
    formatResult: axJsonResult,
  },
  handler: (input, ctx) => {
    if (typeof input.name !== 'string') {
      throw new OperationError('command requires a name.');
    }
    const event = canvasState.invokeCommand(
      input.name,
      isRecord(input.args) ? input.args : null,
      { source: normalizeAxSource(input.source, 'api') },
    );
    // Allowlist gate: invokeCommand returns null for an unknown command name.
    if (!event) throw new OperationError(`Unknown command "${input.name}".`, 400);
    ctx.emit('ax-event-created', { event });
    return { ok: true, event } as unknown as Record<string, unknown>;
  },
});

export const axTimelineOperations: Operation[] = [
  axEventRecordOperation,
  axEvidenceAddOperation,
  axSteerOperation,
  axTimelineGetOperation,
  axDeliveryPendingOperation,
  axDeliveryMarkOperation,
  axCommandInvokeOperation,
];
