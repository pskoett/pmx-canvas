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
import type {
  PmxAxApprovalGate,
  PmxAxElicitation,
  PmxAxEvent,
  PmxAxEventKind,
  PmxAxEvidence,
  PmxAxEvidenceKind,
  PmxAxFocusState,
  PmxAxMode,
  PmxAxModeRequest,
  PmxAxReviewAnchorType,
  PmxAxReviewAnnotation,
  PmxAxReviewKind,
  PmxAxReviewRegion,
  PmxAxReviewSeverity,
  PmxAxSource,
  PmxAxSteeringMessage,
  PmxAxWorkItem,
  PmxAxWorkItemStatus,
} from './ax-state.js';

// ── Interaction types ──────────────────────────────────────────

export const AX_INTERACTION_TYPES = [
  'ax.event.record',
  'ax.steer',
  'ax.work.create',
  'ax.work.update',
  'ax.evidence.add',
  'ax.approval.request',
  'ax.approval.resolve',
  'ax.review.add',
  'ax.focus.set',
  'ax.command.invoke',
  'ax.elicitation.request',
  'ax.mode.request',
] as const;

export type AxInteractionType = (typeof AX_INTERACTION_TYPES)[number];

// ── Node capability model ──────────────────────────────────────

export type AxDeliveryMode = 'record-only' | 'notify-agent' | 'send-to-agent';

export interface NodeAxCapabilities {
  enabled: boolean;
  /** Interaction types this node may emit. Also the per-node override ceiling. */
  allowed: AxInteractionType[];
  /** Subset of `allowed` that should route through an approval gate (later phases). */
  requiresApproval: AxInteractionType[];
  delivery: AxDeliveryMode;
}

function caps(
  enabled: boolean,
  allowed: AxInteractionType[],
  delivery: AxDeliveryMode = 'record-only',
): NodeAxCapabilities {
  return { enabled, allowed, requiresApproval: [], delivery };
}

/**
 * Server-side default (and per-node ceiling) capabilities per node type, from the
 * plan's node capability matrix. `html`/`html-primitive`, `mcp-app`, and the
 * internal `prompt`/`response` types default to disabled (opt-in / later phases);
 * a node can anchor AX state but only eligible types may EMIT interactions.
 */
export const DEFAULT_NODE_AX_CAPABILITIES: Record<CanvasNodeType, NodeAxCapabilities> = {
  markdown: caps(true, ['ax.steer', 'ax.work.create', 'ax.evidence.add', 'ax.command.invoke', 'ax.event.record'], 'notify-agent'),
  context: caps(true, ['ax.focus.set', 'ax.steer', 'ax.evidence.add', 'ax.command.invoke', 'ax.event.record'], 'notify-agent'),
  status: caps(true, ['ax.work.create', 'ax.work.update', 'ax.approval.request', 'ax.mode.request', 'ax.event.record'], 'notify-agent'),
  file: caps(true, ['ax.evidence.add', 'ax.review.add', 'ax.focus.set', 'ax.event.record']),
  'json-render': caps(true, ['ax.work.create', 'ax.work.update', 'ax.evidence.add', 'ax.elicitation.request', 'ax.event.record']),
  graph: caps(true, ['ax.evidence.add', 'ax.focus.set', 'ax.event.record']),
  ledger: caps(true, ['ax.evidence.add', 'ax.event.record']),
  trace: caps(true, ['ax.evidence.add', 'ax.event.record']),
  image: caps(true, ['ax.evidence.add', 'ax.review.add']),
  webpage: caps(true, ['ax.evidence.add', 'ax.review.add', 'ax.focus.set', 'ax.event.record']),
  group: caps(true, ['ax.focus.set', 'ax.work.create', 'ax.command.invoke', 'ax.event.record']),
  // Opt-in: arbitrary/sandboxed author content. Ceiling is broad but disabled
  // until a node explicitly sets data.axCapabilities.enabled = true.
  html: caps(
    false,
    [
      'ax.work.create',
      'ax.work.update',
      'ax.steer',
      'ax.approval.request',
      'ax.review.add',
      'ax.evidence.add',
      'ax.focus.set',
      'ax.elicitation.request',
      'ax.mode.request',
      'ax.command.invoke',
      'ax.event.record',
    ],
    'notify-agent',
  ),
  // Opt-in ext-app bridge (Phase 6). Disabled by default; when a node enables it,
  // interactions are still node-scoped (sourceSurface 'mcp-app') and server-validated.
  // Ceiling covers the work-tracking surface a trusted app reasonably drives:
  // record diagnostics + evidence, create/update its own work item, set focus to
  // itself, and request human input. Excludes higher-trust types (steer, approval,
  // review, command, mode) which stay native-control / adapter only.
  'mcp-app': caps(false, [
    'ax.event.record', 'ax.evidence.add', 'ax.work.create', 'ax.work.update',
    'ax.focus.set', 'ax.elicitation.request',
  ]),
  // Internal thread nodes — anchor only, no human-facing emission by default.
  prompt: caps(false, ['ax.event.record']),
  response: caps(false, ['ax.event.record']),
};

const FALLBACK_CAPABILITIES: NodeAxCapabilities = caps(false, []);

/** Validate caller-supplied per-node `data.axCapabilities` into a partial override. */
export function normalizeNodeAxCapabilities(value: unknown): Partial<NodeAxCapabilities> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const out: Partial<NodeAxCapabilities> = {};
  if (typeof v.enabled === 'boolean') out.enabled = v.enabled;
  if (Array.isArray(v.allowed)) {
    out.allowed = v.allowed.filter((a): a is AxInteractionType =>
      AX_INTERACTION_TYPES.includes(a as AxInteractionType));
  }
  if (Array.isArray(v.requiresApproval)) {
    out.requiresApproval = v.requiresApproval.filter((a): a is AxInteractionType =>
      AX_INTERACTION_TYPES.includes(a as AxInteractionType));
  }
  if (v.delivery === 'record-only' || v.delivery === 'notify-agent' || v.delivery === 'send-to-agent') {
    out.delivery = v.delivery;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Effective capabilities for a node: the type default merged with the node's own
 * `data.axCapabilities`. A per-node override can toggle `enabled` and NARROW
 * `allowed`, but never grant a type beyond the type's ceiling (security: a
 * pasted/generated node cannot escalate itself).
 */
export function resolveNodeAxCapabilities(node: CanvasNodeState): NodeAxCapabilities {
  const base = DEFAULT_NODE_AX_CAPABILITIES[node.type as CanvasNodeType] ?? FALLBACK_CAPABILITIES;
  const override = normalizeNodeAxCapabilities((node.data as Record<string, unknown>).axCapabilities);
  if (!override) return { ...base, allowed: [...base.allowed], requiresApproval: [...base.requiresApproval] };
  const enabled = override.enabled ?? base.enabled;
  const allowed = (override.allowed ?? base.allowed).filter((a) => base.allowed.includes(a));
  const requiresApproval = (override.requiresApproval ?? base.requiresApproval).filter((a) => allowed.includes(a));
  const delivery = override.delivery ?? base.delivery;
  return { enabled, allowed, requiresApproval, delivery };
}

// ── Envelope + payload validation ──────────────────────────────

const EVENT_KINDS = ['prompt', 'assistant-message', 'tool-start', 'tool-result', 'failure', 'approval', 'steering'] as const;
const EVIDENCE_KINDS = ['logs', 'tool-result', 'screenshot', 'file', 'diff', 'test-output'] as const;
const WORK_STATUSES = ['todo', 'in-progress', 'blocked', 'done', 'cancelled'] as const;
const REVIEW_KINDS = ['comment', 'finding'] as const;
const REVIEW_SEVERITIES = ['info', 'warning', 'error'] as const;
const REVIEW_ANCHORS = ['node', 'file', 'region'] as const;

const InteractionEnvelopeSchema = z.object({
  type: z.enum(AX_INTERACTION_TYPES),
  sourceNodeId: z.string().min(1, 'sourceNodeId is required'),
  sourceSurface: z.enum(['native-node', 'json-render', 'html-node', 'mcp-app', 'adapter']).optional(),
  actor: z
    .object({
      kind: z.enum(['human', 'agent', 'system']),
      id: z.string().optional(),
      displayName: z.string().optional(),
    })
    .optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  correlationId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

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

const PAYLOAD_SCHEMAS: Record<string, z.ZodType> = {
  'ax.event.record': z.object({
    kind: z.enum(EVENT_KINDS),
    summary: z.string().min(1),
    detail: z.string().nullish(),
    nodeIds: z.array(z.string()).optional(),
    data: z.record(z.string(), z.unknown()).nullish(),
  }),
  'ax.steer': z.object({ message: z.string().min(1) }),
  'ax.work.create': z.object({
    title: z.string().min(1),
    status: z.enum(WORK_STATUSES).optional(),
    detail: z.string().nullish(),
    nodeIds: z.array(z.string()).optional(),
  }),
  'ax.work.update': z.object({
    id: z.string().min(1),
    title: z.string().optional(),
    status: z.enum(WORK_STATUSES).optional(),
    detail: z.string().nullish(),
    nodeIds: z.array(z.string()).optional(),
  }),
  'ax.evidence.add': z.object({
    kind: z.enum(EVIDENCE_KINDS),
    title: z.string().min(1),
    body: z.string().nullish(),
    ref: z.string().nullish(),
    nodeIds: z.array(z.string()).optional(),
    data: z.record(z.string(), z.unknown()).nullish(),
  }),
  'ax.approval.request': z.object({
    title: z.string().min(1),
    detail: z.string().nullish(),
    action: z.string().nullish(),
    nodeIds: z.array(z.string()).optional(),
  }),
  'ax.approval.resolve': z.object({
    id: z.string().min(1),
    decision: z.enum(['approved', 'rejected']),
    resolution: z.string().optional(),
  }),
  'ax.review.add': z.object({
    body: z.string().min(1),
    kind: z.enum(REVIEW_KINDS).optional(),
    severity: z.enum(REVIEW_SEVERITIES).optional(),
    anchorType: z.enum(REVIEW_ANCHORS).optional(),
    nodeId: z.string().optional(),
    file: z.string().optional(),
    author: z.string().optional(),
  }),
  'ax.focus.set': z.object({ nodeIds: z.array(z.string()).optional() }),
  'ax.elicitation.request': z.object({
    prompt: z.string().min(1),
    fields: z.array(z.string()).optional(),
    nodeIds: z.array(z.string()).optional(),
  }),
  'ax.mode.request': z.object({
    mode: z.enum(['plan', 'execute', 'autonomous']),
    reason: z.string().nullish(),
    nodeIds: z.array(z.string()).optional(),
  }),
  'ax.command.invoke': z.object({
    name: z.string().min(1),
    args: z.record(z.string(), z.unknown()).optional(),
  }),
};

// ── Dispatch ───────────────────────────────────────────────────

/**
 * Structural subset of CanvasStateManager that interaction dispatch needs.
 * Injected so this module stays free of a runtime canvas-state import.
 */
export interface AxInteractionManager {
  getNode(id: string): CanvasNodeState | undefined;
  recordAxEvent(
    input: { kind: PmxAxEventKind; summary: string; detail?: string | null; nodeIds?: string[]; data?: Record<string, unknown> | null },
    options?: { source?: PmxAxSource },
  ): PmxAxEvent;
  recordSteeringMessage(message: string, options?: { source?: PmxAxSource }): PmxAxSteeringMessage;
  addWorkItem(
    input: { title: string; status?: PmxAxWorkItemStatus; detail?: string | null; nodeIds?: string[] },
    options?: { source?: PmxAxSource },
  ): PmxAxWorkItem;
  updateWorkItem(
    id: string,
    patch: { title?: string; status?: PmxAxWorkItemStatus; detail?: string | null; nodeIds?: string[] },
    options?: { source?: PmxAxSource },
  ): PmxAxWorkItem | null;
  addEvidence(
    input: { kind: PmxAxEvidenceKind; title: string; body?: string | null; ref?: string | null; nodeIds?: string[]; data?: Record<string, unknown> | null },
    options?: { source?: PmxAxSource },
  ): PmxAxEvidence;
  requestApproval(
    input: { title: string; detail?: string | null; action?: string | null; nodeIds?: string[] },
    options?: { source?: PmxAxSource },
  ): PmxAxApprovalGate;
  resolveApproval(
    id: string,
    decision: 'approved' | 'rejected',
    options?: { resolution?: string; source?: PmxAxSource },
  ): PmxAxApprovalGate | null;
  addReviewAnnotation(
    input: {
      body: string;
      kind?: PmxAxReviewKind;
      severity?: PmxAxReviewSeverity;
      anchorType?: PmxAxReviewAnchorType;
      nodeId?: string | null;
      file?: string | null;
      region?: PmxAxReviewRegion | null;
      author?: string | null;
    },
    options?: { source?: PmxAxSource },
  ): PmxAxReviewAnnotation | null;
  setAxFocus(nodeIds: string[], options?: { source?: PmxAxSource }): PmxAxFocusState;
  requestElicitation(
    input: { prompt: string; fields?: string[]; nodeIds?: string[] },
    options?: { source?: PmxAxSource },
  ): PmxAxElicitation;
  requestMode(
    input: { mode: PmxAxMode; reason?: string | null; nodeIds?: string[] },
    options?: { source?: PmxAxSource },
  ): PmxAxModeRequest;
  invokeCommand(name: string, args?: Record<string, unknown> | null, options?: { source?: PmxAxSource }): PmxAxEvent | null;
}

export interface AxInteractionEvent {
  event: string;
  payload: Record<string, unknown>;
}

export type AxInteractionPublicResult =
  | { ok: true; type: AxInteractionType; sourceNodeId: string; primitive: unknown }
  | { ok: false; status: number; code: string; error: string };

export interface AxInteractionResult {
  result: AxInteractionPublicResult;
  events: AxInteractionEvent[];
}

function outcomeEvent(extra: Record<string, unknown>): AxInteractionEvent {
  return { event: 'ax-interaction', payload: extra };
}

function reject(
  type: string,
  sourceNodeId: string,
  status: number,
  code: string,
  error: string,
): AxInteractionResult {
  return {
    result: { ok: false, status, code, error },
    events: [outcomeEvent({ ok: false, type, sourceNodeId, code, error })],
  };
}

function accept(
  type: AxInteractionType,
  sourceNodeId: string,
  primitive: unknown,
  stateEvent: string,
  statePayload: Record<string, unknown>,
): AxInteractionResult {
  return {
    result: { ok: true, type, sourceNodeId, primitive },
    events: [
      outcomeEvent({ ok: true, type, sourceNodeId }),
      { event: stateEvent, payload: statePayload },
    ],
  };
}

/**
 * Validate + execute a node-originated AX interaction. Returns the public result
 * plus the SSE events the caller should emit (accepted/rejected outcome + the
 * underlying AX state event). Never throws on bad input — returns an `ok: false`
 * result with an appropriate HTTP-ish status.
 */
export function applyAxInteraction(
  manager: AxInteractionManager,
  rawBody: unknown,
  source: PmxAxSource,
): AxInteractionResult {
  const parsed = InteractionEnvelopeSchema.safeParse(rawBody);
  if (!parsed.success) {
    const error = parsed.error.issues.map((i) => `${i.path.join('.') || 'envelope'}: ${i.message}`).join('; ');
    const type = typeof (rawBody as { type?: unknown })?.type === 'string' ? String((rawBody as { type?: unknown }).type) : 'unknown';
    const sourceNodeId = typeof (rawBody as { sourceNodeId?: unknown })?.sourceNodeId === 'string'
      ? String((rawBody as { sourceNodeId?: unknown }).sourceNodeId)
      : '';
    return reject(type, sourceNodeId, 400, 'invalid-envelope', error);
  }
  const interaction = parsed.data;
  const { type, sourceNodeId, payload } = interaction;

  const node = manager.getNode(sourceNodeId);
  if (!node) return reject(type, sourceNodeId, 404, 'unknown-node', `Source node "${sourceNodeId}" not found.`);

  const capabilities = resolveNodeAxCapabilities(node);
  if (!capabilities.enabled) {
    return reject(type, sourceNodeId, 403, 'ax-disabled', `AX interactions are not enabled for node "${sourceNodeId}".`);
  }
  if (!capabilities.allowed.includes(type)) {
    return reject(type, sourceNodeId, 403, 'not-allowed', `Node type "${node.type}" cannot emit "${type}".`);
  }
  // Fail closed: approval-gated interaction types are rejected until approval
  // routing lands, rather than dispatched without the gate they require.
  if (capabilities.requiresApproval.includes(type)) {
    return reject(type, sourceNodeId, 403, 'requires-approval', `"${type}" requires approval routing, which is not yet available.`);
  }

  const schema = PAYLOAD_SCHEMAS[type];
  const payloadParsed = schema.safeParse(payload);
  if (!payloadParsed.success) {
    const error = payloadParsed.error.issues.map((i) => `${i.path.join('.') || 'payload'}: ${i.message}`).join('; ');
    return reject(type, sourceNodeId, 400, 'invalid-payload', error);
  }
  const opts = { source };

  // Sandboxed/semi-trusted surfaces — sandboxed HTML, MCP apps, and the
  // json-render/graph viewer (all opaque-origin iframes rendering author-controlled
  // content) — may only emit interactions scoped to their OWN node: caller-supplied
  // nodeIds are clamped to the source node so a spec/app cannot anchor AX state on
  // arbitrary canvas nodes. Trusted surfaces (native node controls, host adapters)
  // may pass explicit nodeIds. Note: the clamp covers node *re-association*; target
  // ids for ax.work.update / ax.approval.resolve remain addressable across surfaces
  // (ids are non-secret — surfaced in canvas://ax-work), which is accepted under the
  // single-workspace local-trust model.
  const scoped =
    interaction.sourceSurface === 'html-node' ||
    interaction.sourceSurface === 'mcp-app' ||
    interaction.sourceSurface === 'json-render';
  const scopedNodeIds = (requested?: string[]): string[] => (scoped ? [sourceNodeId] : (requested ?? [sourceNodeId]));

  switch (type) {
    case 'ax.event.record': {
      const p = payloadParsed.data as { kind: PmxAxEventKind; summary: string; detail?: string | null; nodeIds?: string[]; data?: Record<string, unknown> | null };
      const event = manager.recordAxEvent(
        { kind: p.kind, summary: p.summary, detail: p.detail ?? null, nodeIds: scopedNodeIds(p.nodeIds), data: p.data ?? null },
        opts,
      );
      return accept(type, sourceNodeId, event, 'ax-event-created', { event });
    }
    case 'ax.steer': {
      const p = payloadParsed.data as { message: string };
      const steering = manager.recordSteeringMessage(p.message, opts);
      return accept(type, sourceNodeId, steering, 'ax-event-created', { steering });
    }
    case 'ax.work.create': {
      const p = payloadParsed.data as { title: string; status?: PmxAxWorkItemStatus; detail?: string | null; nodeIds?: string[] };
      const workItem = manager.addWorkItem(
        { title: p.title, ...(p.status ? { status: p.status } : {}), ...(p.detail !== undefined ? { detail: p.detail } : {}), nodeIds: scopedNodeIds(p.nodeIds) },
        opts,
      );
      return accept(type, sourceNodeId, workItem, 'ax-state-changed', { workItem });
    }
    case 'ax.work.update': {
      const p = payloadParsed.data as { id: string; title?: string; status?: PmxAxWorkItemStatus; detail?: string | null; nodeIds?: string[] };
      const { id, ...patch } = p;
      if (scoped && patch.nodeIds !== undefined) patch.nodeIds = [sourceNodeId];
      const workItem = manager.updateWorkItem(id, patch, opts);
      if (!workItem) return reject(type, sourceNodeId, 404, 'work-item-not-found', `Work item "${id}" not found.`);
      return accept(type, sourceNodeId, workItem, 'ax-state-changed', { workItem });
    }
    case 'ax.evidence.add': {
      const p = payloadParsed.data as { kind: PmxAxEvidenceKind; title: string; body?: string | null; ref?: string | null; nodeIds?: string[]; data?: Record<string, unknown> | null };
      const evidence = manager.addEvidence(
        { kind: p.kind, title: p.title, body: p.body ?? null, ref: p.ref ?? null, nodeIds: scopedNodeIds(p.nodeIds), data: p.data ?? null },
        opts,
      );
      return accept(type, sourceNodeId, evidence, 'ax-event-created', { evidence });
    }
    case 'ax.approval.request': {
      const p = payloadParsed.data as { title: string; detail?: string | null; action?: string | null; nodeIds?: string[] };
      const approvalGate = manager.requestApproval(
        { title: p.title, ...(p.detail !== undefined ? { detail: p.detail } : {}), ...(p.action !== undefined ? { action: p.action } : {}), nodeIds: scopedNodeIds(p.nodeIds) },
        opts,
      );
      return accept(type, sourceNodeId, approvalGate, 'ax-state-changed', { approvalGate });
    }
    case 'ax.approval.resolve': {
      const p = payloadParsed.data as { id: string; decision: 'approved' | 'rejected'; resolution?: string };
      const approvalGate = manager.resolveApproval(p.id, p.decision, { ...(p.resolution !== undefined ? { resolution: p.resolution } : {}), source });
      if (!approvalGate) return reject(type, sourceNodeId, 404, 'approval-not-found', `Approval "${p.id}" not found or already resolved.`);
      return accept(type, sourceNodeId, approvalGate, 'ax-state-changed', { approvalGate });
    }
    case 'ax.review.add': {
      const p = payloadParsed.data as { body: string; kind?: PmxAxReviewKind; severity?: PmxAxReviewSeverity; anchorType?: PmxAxReviewAnchorType; nodeId?: string; file?: string; author?: string };
      // Sandboxed surfaces may only review their own node; trusted surfaces may
      // anchor to a file/region or another node.
      const anchorType: PmxAxReviewAnchorType = scoped ? 'node' : (p.anchorType ?? 'node');
      const reviewAnnotation = manager.addReviewAnnotation(
        {
          body: p.body,
          ...(p.kind ? { kind: p.kind } : {}),
          ...(p.severity ? { severity: p.severity } : {}),
          anchorType,
          nodeId: scoped ? sourceNodeId : (anchorType === 'node' ? (p.nodeId ?? sourceNodeId) : (p.nodeId ?? null)),
          ...(!scoped && p.file !== undefined ? { file: p.file } : {}),
          ...(p.author !== undefined ? { author: p.author } : {}),
        },
        opts,
      );
      if (!reviewAnnotation) return reject(type, sourceNodeId, 400, 'invalid-review-anchor', 'Node-anchored review requires a nodeId that exists on the canvas.');
      return accept(type, sourceNodeId, reviewAnnotation, 'ax-state-changed', { reviewAnnotation });
    }
    case 'ax.focus.set': {
      const p = payloadParsed.data as { nodeIds?: string[] };
      const focus = manager.setAxFocus(scopedNodeIds(p.nodeIds), opts);
      return accept(type, sourceNodeId, focus, 'ax-state-changed', { focus });
    }
    case 'ax.elicitation.request': {
      const p = payloadParsed.data as { prompt: string; fields?: string[]; nodeIds?: string[] };
      const elicitation = manager.requestElicitation(
        { prompt: p.prompt, ...(p.fields ? { fields: p.fields } : {}), nodeIds: scopedNodeIds(p.nodeIds) },
        opts,
      );
      return accept(type, sourceNodeId, elicitation, 'ax-state-changed', { elicitation });
    }
    case 'ax.mode.request': {
      const p = payloadParsed.data as { mode: PmxAxMode; reason?: string | null; nodeIds?: string[] };
      const modeRequest = manager.requestMode(
        { mode: p.mode, ...(p.reason !== undefined ? { reason: p.reason } : {}), nodeIds: scopedNodeIds(p.nodeIds) },
        opts,
      );
      return accept(type, sourceNodeId, modeRequest, 'ax-state-changed', { modeRequest });
    }
    case 'ax.command.invoke': {
      const p = payloadParsed.data as { name: string; args?: Record<string, unknown> };
      const event = manager.invokeCommand(p.name, p.args ?? null, opts);
      if (!event) return reject(type, sourceNodeId, 400, 'unknown-command', `Unknown command "${p.name}".`);
      return accept(type, sourceNodeId, event, 'ax-event-created', { event });
    }
    default:
      return reject(type, sourceNodeId, 501, 'not-executable', `"${type}" is recognized but not yet executable.`);
  }
}
