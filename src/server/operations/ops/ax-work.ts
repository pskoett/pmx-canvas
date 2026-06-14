/**
 * Plan-007 Slice B.1 (wave 2) operations: the canvas-bound AX work / review /
 * gate mutators —
 *   ax.work.create / ax.work.update
 *   ax.review.add / ax.review.update
 *   ax.approval.request / ax.approval.resolve
 *   ax.elicitation.request / ax.elicitation.respond
 *   ax.mode.request / ax.mode.resolve
 *
 * Like the wave-1 state ops, none of these change the node/edge layout, so
 * every op is `mutates: false` (no `canvas-layout-update`). They emit the SAME
 * AX SSE frame the legacy handlers emitted — `ax-state-changed` via `ctx.emit`
 * with the same single-key payload (`{ workItem }`, `{ approvalGate }`, …) —
 * and the injected emitter adds the `sessionId`/`timestamp` envelope fields
 * (see server.ts emitPrimaryWorkbenchEvent).
 *
 * Source defaulting matches the legacy surfaces exactly: MCP `buildInput`
 * injects `source: 'mcp'`; the HTTP handlers default an absent source to 'api'.
 *
 * id-from-path ops (update / resolve / respond): the HTTP route carries `:id`;
 * the default readInput merges it into `input.id` (path params win), and the
 * HttpOperationInvoker fills `:id` from input. The handler reads `input.id`.
 *
 * Cross-surface unification (documented; same class as wave 1 / plan-005):
 * the legacy MCP tools for update/resolve/respond returned a SUCCESS-shaped
 * `{ ok: false, <item>: null }` (NOT isError) on a missing/already-resolved
 * target, while the legacy HTTP route returned a 404 `{ ok:false, error }`.
 * One op = one wire body: the op throws `OperationError(..., 404)`, so the HTTP
 * body is byte-identical to the legacy 404 and the MCP tool surfaces it as an
 * `isError` result with the message text (the registry-wide local-vs-remote
 * unification — the SUCCESS shapes the tests assert are preserved exactly).
 *
 * Denial bodies preserved byte-for-byte:
 *  - ax.review.add: node-anchored review with a missing/unknown nodeId → 400
 *    "node-anchored review annotation requires a nodeId that exists on the canvas."
 *  - ax.approval.resolve / ax.mode.resolve: missing or already-resolved gate →
 *    404 "approval gate not found or already resolved." /
 *    "mode request not found or already resolved."
 *  - ax.work.update: missing work item → 404 "work item not found."
 *  - ax.elicitation.respond: not found/already answered → 404
 *    "elicitation not found or already answered."
 *  - ax.review.update: not found → 404 "review annotation not found."
 *  - invalid work-item status (#56) → 400; invalid mode → 400.
 *
 * This module must never import server.ts or index.ts.
 */
import { z } from 'zod';
import { canvasState } from '../../canvas-state.js';
import type {
  PmxAxMode,
  PmxAxReviewAnchorType,
  PmxAxReviewKind,
  PmxAxReviewRegion,
  PmxAxReviewSeverity,
  PmxAxReviewStatus,
  PmxAxWorkItemStatus,
} from '../../ax-state.js';
import { defineOperation, OperationError, type Operation } from '../types.js';
import { isRecord } from './nodes.js';
import { AX_SOURCE_SHAPE, AX_SOURCES, axJsonResult, normalizeAxNodeIds, normalizeAxSource } from './ax-shared.js';

const AX_WORK_ITEM_STATUSES = new Set(['todo', 'in-progress', 'blocked', 'done', 'cancelled']);
function normalizeAxWorkItemStatus(value: unknown): PmxAxWorkItemStatus | undefined {
  return typeof value === 'string' && AX_WORK_ITEM_STATUSES.has(value)
    ? value as PmxAxWorkItemStatus
    : undefined;
}

const AX_REVIEW_KINDS = new Set(['comment', 'finding']);
const AX_REVIEW_SEVERITIES = new Set(['info', 'warning', 'error']);
const AX_REVIEW_STATUSES = new Set(['open', 'resolved', 'dismissed']);
const AX_REVIEW_ANCHORS = new Set(['node', 'file', 'region']);

function normalizeAxReviewKind(value: unknown): PmxAxReviewKind | undefined {
  return typeof value === 'string' && AX_REVIEW_KINDS.has(value) ? value as PmxAxReviewKind : undefined;
}
function normalizeAxReviewSeverity(value: unknown): PmxAxReviewSeverity | undefined {
  return typeof value === 'string' && AX_REVIEW_SEVERITIES.has(value) ? value as PmxAxReviewSeverity : undefined;
}
function normalizeAxReviewStatus(value: unknown): PmxAxReviewStatus | undefined {
  return typeof value === 'string' && AX_REVIEW_STATUSES.has(value) ? value as PmxAxReviewStatus : undefined;
}
function normalizeAxReviewAnchor(value: unknown): PmxAxReviewAnchorType | undefined {
  return typeof value === 'string' && AX_REVIEW_ANCHORS.has(value) ? value as PmxAxReviewAnchorType : undefined;
}
function normalizeAxReviewRegion(value: unknown): PmxAxReviewRegion | undefined {
  if (!isRecord(value)) return undefined;
  return {
    ...(typeof value.line === 'number' ? { line: value.line } : {}),
    ...(typeof value.endLine === 'number' ? { endLine: value.endLine } : {}),
    ...(typeof value.label === 'string' ? { label: value.label } : {}),
  };
}

// ── ax.work.create (canvas_add_work_item) ─────────────────────

const axWorkCreateShape = {
  title: z.unknown().optional().describe('Short title of the work item.'),
  status: z.unknown().optional().describe('Work item status. Defaults to todo.'),
  detail: z.unknown().optional().describe('Optional longer description.'),
  nodeIds: z.unknown().optional().describe('Optional node IDs this work item is tied to.'),
  source: z.unknown().optional().describe('Optional host/source label. Defaults to mcp.'),
};

const axWorkCreateSchema = z.looseObject(axWorkCreateShape);

const axWorkCreateOperation = defineOperation<z.infer<typeof axWorkCreateSchema>, Record<string, unknown>>({
  name: 'ax.work.create',
  mutates: false,
  input: axWorkCreateSchema,
  inputShape: axWorkCreateShape,
  http: {
    method: 'POST',
    path: '/api/canvas/ax/work',
  },
  mcp: {
    toolName: 'canvas_add_work_item',
    description: 'Add a canvas-bound AX work item: a visible task/plan/status tied to nodes and agent work. Work items participate in snapshots and are exposed via canvas://ax-work.',
    extraShape: {
      title: z.string().describe('Short title of the work item.'),
      status: z.enum(['todo', 'in-progress', 'blocked', 'done', 'cancelled'])
        .optional()
        .describe('Work item status. Defaults to todo.'),
      detail: z.string().optional().describe('Optional longer description.'),
      nodeIds: z.array(z.string()).optional().describe('Optional node IDs this work item is tied to.'),
      source: AX_SOURCE_SHAPE,
    },
    buildInput: (input) => ({ ...input, source: normalizeAxSource(input.source, 'mcp') }),
    formatResult: axJsonResult,
  },
  handler: (input, ctx) => {
    if (typeof input.title !== 'string' || !input.title.trim()) {
      throw new OperationError('work item requires a title.');
    }
    // Report #56: reject an unknown status (e.g. "in_progress") instead of
    // silently dropping it — the accepted tokens use hyphens.
    if (input.status !== undefined && !normalizeAxWorkItemStatus(input.status)) {
      throw new OperationError(`invalid work item status "${String(input.status)}"; expected one of: todo, in-progress, blocked, done, cancelled.`);
    }
    const status = normalizeAxWorkItemStatus(input.status);
    const workItem = canvasState.addWorkItem(
      {
        title: input.title,
        ...(status ? { status } : {}),
        ...(typeof input.detail === 'string' ? { detail: input.detail } : {}),
        ...(Array.isArray(input.nodeIds) ? { nodeIds: normalizeAxNodeIds(input.nodeIds) } : {}),
      },
      { source: normalizeAxSource(input.source, 'api') },
    );
    ctx.emit('ax-state-changed', { workItem });
    return { ok: true, workItem } as unknown as Record<string, unknown>;
  },
});

// ── ax.work.update (canvas_update_work_item) ──────────────────

const axWorkUpdateShape = {
  id: z.string().optional().catch(undefined).describe('Work item ID to update.'),
  title: z.unknown().optional().describe('New title.'),
  status: z.unknown().optional().describe('New status.'),
  detail: z.unknown().optional().describe('New detail text.'),
  nodeIds: z.unknown().optional().describe('Replacement node IDs.'),
  source: z.unknown().optional().describe('Optional host/source label. Defaults to mcp.'),
};

const axWorkUpdateSchema = z.looseObject(axWorkUpdateShape);

const axWorkUpdateOperation = defineOperation<z.infer<typeof axWorkUpdateSchema>, Record<string, unknown>>({
  name: 'ax.work.update',
  mutates: false,
  input: axWorkUpdateSchema,
  inputShape: axWorkUpdateShape,
  http: {
    method: 'PATCH',
    path: '/api/canvas/ax/work/:id',
  },
  mcp: {
    toolName: 'canvas_update_work_item',
    description: 'Update a canvas-bound AX work item by ID (title/status/detail/nodeIds). Returns null if the work item does not exist.',
    extraShape: {
      id: z.string().describe('Work item ID to update.'),
      title: z.string().optional().describe('New title.'),
      status: z.enum(['todo', 'in-progress', 'blocked', 'done', 'cancelled'])
        .optional()
        .describe('New status.'),
      detail: z.string().optional().describe('New detail text.'),
      nodeIds: z.array(z.string()).optional().describe('Replacement node IDs.'),
      source: AX_SOURCE_SHAPE,
    },
    buildInput: (input) => ({ ...input, source: normalizeAxSource(input.source, 'mcp') }),
    formatResult: axJsonResult,
  },
  handler: (input, ctx) => {
    const id = typeof input.id === 'string' ? input.id : '';
    // Report #56: reject an unknown status instead of returning ok:true + no-op.
    if (input.status !== undefined && !normalizeAxWorkItemStatus(input.status)) {
      throw new OperationError(`invalid work item status "${String(input.status)}"; expected one of: todo, in-progress, blocked, done, cancelled.`);
    }
    const status = normalizeAxWorkItemStatus(input.status);
    const workItem = canvasState.updateWorkItem(
      id,
      {
        ...(typeof input.title === 'string' ? { title: input.title } : {}),
        ...(status ? { status } : {}),
        ...(typeof input.detail === 'string' || input.detail === null ? { detail: input.detail as string | null } : {}),
        ...(Array.isArray(input.nodeIds) ? { nodeIds: normalizeAxNodeIds(input.nodeIds) } : {}),
      },
      { source: normalizeAxSource(input.source, 'api') },
    );
    if (!workItem) throw new OperationError('work item not found.', 404);
    ctx.emit('ax-state-changed', { workItem });
    return { ok: true, workItem } as unknown as Record<string, unknown>;
  },
});

// ── ax.review.add (canvas_add_review_annotation) ──────────────

const axReviewAddShape = {
  body: z.unknown().optional().describe('Annotation body text.'),
  kind: z.unknown().optional().describe('Annotation kind. Default comment.'),
  severity: z.unknown().optional().describe('Severity. Default info.'),
  anchorType: z.unknown().optional().describe('Anchor type. Default node.'),
  nodeId: z.unknown().optional().describe('Node ID when anchorType is node.'),
  file: z.unknown().optional().describe('File path when anchorType is file.'),
  region: z.unknown().optional().describe('Region descriptor when anchorType is region.'),
  author: z.unknown().optional().describe('Optional author label.'),
  source: z.unknown().optional().describe('Optional host/source label. Defaults to mcp.'),
};

const axReviewAddSchema = z.looseObject(axReviewAddShape);

const axReviewAddOperation = defineOperation<z.infer<typeof axReviewAddSchema>, Record<string, unknown>>({
  name: 'ax.review.add',
  mutates: false,
  input: axReviewAddSchema,
  inputShape: axReviewAddShape,
  http: {
    method: 'POST',
    path: '/api/canvas/ax/review',
  },
  mcp: {
    toolName: 'canvas_add_review_annotation',
    description: 'Add a canvas-bound review annotation: a comment or finding anchored to a node, file, or region. Review annotations participate in snapshots and are exposed via canvas://ax-work.',
    extraShape: {
      body: z.string().describe('Annotation body text.'),
      kind: z.enum(['comment', 'finding']).optional().describe('Annotation kind. Default comment.'),
      severity: z.enum(['info', 'warning', 'error']).optional().describe('Severity. Default info.'),
      anchorType: z.enum(['node', 'file', 'region']).optional().describe('Anchor type. Default node.'),
      nodeId: z.string().optional().describe('Node ID when anchorType is node.'),
      file: z.string().optional().describe('File path when anchorType is file.'),
      region: z.object({
        line: z.number().optional(),
        endLine: z.number().optional(),
        label: z.string().optional(),
      }).optional().describe('Region descriptor when anchorType is region.'),
      author: z.string().optional().describe('Optional author label.'),
      source: AX_SOURCE_SHAPE,
    },
    buildInput: (input) => ({ ...input, source: normalizeAxSource(input.source, 'mcp') }),
    formatResult: axJsonResult,
  },
  handler: (input, ctx) => {
    if (typeof input.body !== 'string' || !input.body.trim()) {
      throw new OperationError('review annotation requires a body.');
    }
    const kind = normalizeAxReviewKind(input.kind);
    const severity = normalizeAxReviewSeverity(input.severity);
    const anchorType = normalizeAxReviewAnchor(input.anchorType);
    const region = normalizeAxReviewRegion(input.region);
    const reviewAnnotation = canvasState.addReviewAnnotation(
      {
        body: input.body,
        ...(kind ? { kind } : {}),
        ...(severity ? { severity } : {}),
        ...(anchorType ? { anchorType } : {}),
        ...(typeof input.nodeId === 'string' ? { nodeId: input.nodeId } : {}),
        ...(typeof input.file === 'string' ? { file: input.file } : {}),
        ...(region ? { region } : {}),
        ...(typeof input.author === 'string' ? { author: input.author } : {}),
      },
      { source: normalizeAxSource(input.source, 'api') },
    );
    if (!reviewAnnotation) {
      // Denial body preserved byte-for-byte; legacy HTTP status was 400.
      throw new OperationError('node-anchored review annotation requires a nodeId that exists on the canvas.', 400);
    }
    ctx.emit('ax-state-changed', { reviewAnnotation });
    return { ok: true, reviewAnnotation } as unknown as Record<string, unknown>;
  },
});

// ── ax.review.update (HTTP only — no MCP tool) ────────────────

const axReviewUpdateShape = {
  id: z.string().optional().catch(undefined).describe('Review annotation ID to update.'),
  body: z.unknown().optional(),
  status: z.unknown().optional(),
  severity: z.unknown().optional(),
  kind: z.unknown().optional(),
  source: z.unknown().optional(),
};

const axReviewUpdateSchema = z.looseObject(axReviewUpdateShape);

const axReviewUpdateOperation = defineOperation<z.infer<typeof axReviewUpdateSchema>, Record<string, unknown>>({
  name: 'ax.review.update',
  mutates: false,
  input: axReviewUpdateSchema,
  inputShape: axReviewUpdateShape,
  http: {
    method: 'PATCH',
    path: '/api/canvas/ax/review/:id',
  },
  // HTTP-only: the legacy surface had no MCP tool for review update.
  handler: (input, ctx) => {
    const id = typeof input.id === 'string' ? input.id : '';
    const status = normalizeAxReviewStatus(input.status);
    const severity = normalizeAxReviewSeverity(input.severity);
    const kind = normalizeAxReviewKind(input.kind);
    const reviewAnnotation = canvasState.updateReviewAnnotation(
      id,
      {
        ...(typeof input.body === 'string' ? { body: input.body } : {}),
        ...(status ? { status } : {}),
        ...(severity ? { severity } : {}),
        ...(kind ? { kind } : {}),
      },
      { source: normalizeAxSource(input.source, 'api') },
    );
    if (!reviewAnnotation) throw new OperationError('review annotation not found.', 404);
    ctx.emit('ax-state-changed', { reviewAnnotation });
    return { ok: true, reviewAnnotation } as unknown as Record<string, unknown>;
  },
});

// ── ax.approval.request (canvas_request_approval) ─────────────

const axApprovalRequestShape = {
  title: z.unknown().optional().describe('Short title of what needs approval.'),
  detail: z.unknown().optional().describe('Optional explanation of the action and its impact.'),
  action: z.unknown().optional().describe('Optional machine-readable action identifier the approval gates.'),
  nodeIds: z.unknown().optional().describe('Optional node IDs this approval relates to.'),
  source: z.unknown().optional().describe('Optional host/source label. Defaults to mcp.'),
};

const axApprovalRequestSchema = z.looseObject(axApprovalRequestShape);

const axApprovalRequestOperation = defineOperation<z.infer<typeof axApprovalRequestSchema>, Record<string, unknown>>({
  name: 'ax.approval.request',
  mutates: false,
  input: axApprovalRequestSchema,
  inputShape: axApprovalRequestShape,
  http: {
    method: 'POST',
    path: '/api/canvas/ax/approval',
  },
  mcp: {
    toolName: 'canvas_request_approval',
    description: 'Request human approval before a high-impact AX action: creates a pending approval gate tied to nodes. Canvas-bound and snapshotted; exposed via canvas://ax-work.',
    extraShape: {
      title: z.string().describe('Short title of what needs approval.'),
      detail: z.string().optional().describe('Optional explanation of the action and its impact.'),
      action: z.string().optional().describe('Optional machine-readable action identifier the approval gates.'),
      nodeIds: z.array(z.string()).optional().describe('Optional node IDs this approval relates to.'),
      source: AX_SOURCE_SHAPE,
    },
    buildInput: (input) => ({ ...input, source: normalizeAxSource(input.source, 'mcp') }),
    formatResult: axJsonResult,
  },
  handler: (input, ctx) => {
    if (typeof input.title !== 'string' || !input.title.trim()) {
      throw new OperationError('approval request requires a title.');
    }
    const approvalGate = canvasState.requestApproval(
      {
        title: input.title,
        ...(typeof input.detail === 'string' ? { detail: input.detail } : {}),
        ...(typeof input.action === 'string' ? { action: input.action } : {}),
        ...(Array.isArray(input.nodeIds) ? { nodeIds: normalizeAxNodeIds(input.nodeIds) } : {}),
      },
      { source: normalizeAxSource(input.source, 'api') },
    );
    ctx.emit('ax-state-changed', { approvalGate });
    return { ok: true, approvalGate } as unknown as Record<string, unknown>;
  },
});

// ── ax.approval.resolve (canvas_resolve_approval) ─────────────

const axApprovalResolveShape = {
  id: z.string().optional().catch(undefined).describe('Approval gate ID to resolve.'),
  decision: z.unknown().optional().describe('Approval decision.'),
  resolution: z.unknown().optional().describe('Optional human-readable resolution note.'),
  source: z.unknown().optional().describe('Optional host/source label. Defaults to mcp.'),
};

const axApprovalResolveSchema = z.looseObject(axApprovalResolveShape);

const axApprovalResolveOperation = defineOperation<z.infer<typeof axApprovalResolveSchema>, Record<string, unknown>>({
  name: 'ax.approval.resolve',
  mutates: false,
  input: axApprovalResolveSchema,
  inputShape: axApprovalResolveShape,
  http: {
    method: 'POST',
    path: '/api/canvas/ax/approval/:id/resolve',
  },
  mcp: {
    toolName: 'canvas_resolve_approval',
    description: 'Resolve a pending approval gate by ID with approved or rejected. Returns null if the gate does not exist or is already resolved.',
    extraShape: {
      id: z.string().describe('Approval gate ID to resolve.'),
      decision: z.enum(['approved', 'rejected']).describe('Approval decision.'),
      resolution: z.string().optional().describe('Optional human-readable resolution note.'),
      source: AX_SOURCE_SHAPE,
    },
    buildInput: (input) => ({ ...input, source: normalizeAxSource(input.source, 'mcp') }),
    formatResult: axJsonResult,
  },
  handler: (input, ctx) => {
    const id = typeof input.id === 'string' ? input.id : '';
    if (input.decision !== 'approved' && input.decision !== 'rejected') {
      throw new OperationError('resolve requires decision approved or rejected.');
    }
    const approvalGate = canvasState.resolveApproval(
      id,
      input.decision,
      {
        ...(typeof input.resolution === 'string' ? { resolution: input.resolution } : {}),
        source: normalizeAxSource(input.source, 'api'),
      },
    );
    if (!approvalGate) throw new OperationError('approval gate not found or already resolved.', 404);
    ctx.emit('ax-state-changed', { approvalGate });
    return { ok: true, approvalGate } as unknown as Record<string, unknown>;
  },
});

// ── ax.elicitation.request (canvas_request_elicitation) ───────

const axElicitationRequestShape = {
  prompt: z.unknown().optional().describe('The question or instruction for the human.'),
  fields: z.unknown().optional().describe('Optional field names to request (a simple structured form).'),
  nodeIds: z.unknown().optional(),
  source: z.unknown().optional(),
};

const axElicitationRequestSchema = z.looseObject(axElicitationRequestShape);

const axElicitationRequestOperation = defineOperation<z.infer<typeof axElicitationRequestSchema>, Record<string, unknown>>({
  name: 'ax.elicitation.request',
  mutates: false,
  input: axElicitationRequestSchema,
  inputShape: axElicitationRequestShape,
  http: {
    method: 'POST',
    path: '/api/canvas/ax/elicitation',
  },
  mcp: {
    toolName: 'canvas_request_elicitation',
    description: 'Request structured human input (an elicitation): a pending question/form tied to nodes. Canvas-bound and snapshotted; exposed via canvas://ax-work. Answer it with canvas_respond_elicitation.',
    extraShape: {
      prompt: z.string().describe('The question or instruction for the human.'),
      fields: z.array(z.string()).optional().describe('Optional field names to request (a simple structured form).'),
      nodeIds: z.array(z.string()).optional(),
      source: z.enum(AX_SOURCES).optional(),
    },
    buildInput: (input) => ({ ...input, source: normalizeAxSource(input.source, 'mcp') }),
    formatResult: axJsonResult,
  },
  handler: (input, ctx) => {
    if (typeof input.prompt !== 'string' || !input.prompt.trim()) {
      throw new OperationError('elicitation requires a prompt.');
    }
    const elicitation = canvasState.requestElicitation(
      {
        prompt: input.prompt,
        ...(Array.isArray(input.fields) ? { fields: input.fields.filter((f): f is string => typeof f === 'string') } : {}),
        ...(Array.isArray(input.nodeIds) ? { nodeIds: normalizeAxNodeIds(input.nodeIds) } : {}),
      },
      { source: normalizeAxSource(input.source, 'api') },
    );
    ctx.emit('ax-state-changed', { elicitation });
    return { ok: true, elicitation } as unknown as Record<string, unknown>;
  },
});

// ── ax.elicitation.respond (canvas_respond_elicitation) ───────

const axElicitationRespondShape = {
  id: z.string().optional().catch(undefined).describe('The elicitation id.'),
  response: z.unknown().optional().describe('The structured answer.'),
  source: z.unknown().optional(),
};

const axElicitationRespondSchema = z.looseObject(axElicitationRespondShape);

const axElicitationRespondOperation = defineOperation<z.infer<typeof axElicitationRespondSchema>, Record<string, unknown>>({
  name: 'ax.elicitation.respond',
  mutates: false,
  input: axElicitationRespondSchema,
  inputShape: axElicitationRespondShape,
  http: {
    method: 'POST',
    path: '/api/canvas/ax/elicitation/:id/respond',
  },
  mcp: {
    toolName: 'canvas_respond_elicitation',
    description: 'Answer a pending elicitation with a structured response.',
    extraShape: {
      id: z.string().describe('The elicitation id.'),
      response: z.record(z.string(), z.unknown()).describe('The structured answer.'),
      source: z.enum(AX_SOURCES).optional(),
    },
    buildInput: (input) => ({ ...input, source: normalizeAxSource(input.source, 'mcp') }),
    formatResult: axJsonResult,
  },
  handler: (input, ctx) => {
    const id = typeof input.id === 'string' ? input.id : '';
    const response = isRecord(input.response) ? input.response : {};
    const elicitation = canvasState.respondElicitation(id, response, { source: normalizeAxSource(input.source, 'api') });
    if (!elicitation) throw new OperationError('elicitation not found or already answered.', 404);
    ctx.emit('ax-state-changed', { elicitation });
    return { ok: true, elicitation } as unknown as Record<string, unknown>;
  },
});

// ── ax.mode.request (canvas_request_mode) ─────────────────────

const axModeRequestShape = {
  mode: z.unknown().optional().describe('Requested target mode.'),
  reason: z.unknown().optional(),
  nodeIds: z.unknown().optional(),
  source: z.unknown().optional(),
};

const axModeRequestSchema = z.looseObject(axModeRequestShape);

const axModeRequestOperation = defineOperation<z.infer<typeof axModeRequestSchema>, Record<string, unknown>>({
  name: 'ax.mode.request',
  mutates: false,
  input: axModeRequestSchema,
  inputShape: axModeRequestShape,
  http: {
    method: 'POST',
    path: '/api/canvas/ax/mode',
  },
  mcp: {
    toolName: 'canvas_request_mode',
    description: 'Request a workflow mode transition (plan/execute/autonomous): a pending mode request tied to nodes. Canvas-bound and snapshotted; exposed via canvas://ax-work. Resolve with canvas_resolve_mode.',
    extraShape: {
      mode: z.enum(['plan', 'execute', 'autonomous']).describe('Requested target mode.'),
      reason: z.string().optional(),
      nodeIds: z.array(z.string()).optional(),
      source: z.enum(AX_SOURCES).optional(),
    },
    buildInput: (input) => ({ ...input, source: normalizeAxSource(input.source, 'mcp') }),
    formatResult: axJsonResult,
  },
  handler: (input, ctx) => {
    if (input.mode !== 'plan' && input.mode !== 'execute' && input.mode !== 'autonomous') {
      throw new OperationError('mode request requires mode plan|execute|autonomous.');
    }
    const modeRequest = canvasState.requestMode(
      {
        mode: input.mode as PmxAxMode,
        ...(typeof input.reason === 'string' ? { reason: input.reason } : {}),
        ...(Array.isArray(input.nodeIds) ? { nodeIds: normalizeAxNodeIds(input.nodeIds) } : {}),
      },
      { source: normalizeAxSource(input.source, 'api') },
    );
    ctx.emit('ax-state-changed', { modeRequest });
    return { ok: true, modeRequest } as unknown as Record<string, unknown>;
  },
});

// ── ax.mode.resolve (canvas_resolve_mode) ─────────────────────

const axModeResolveShape = {
  id: z.string().optional().catch(undefined),
  decision: z.unknown().optional(),
  resolution: z.unknown().optional(),
  source: z.unknown().optional(),
};

const axModeResolveSchema = z.looseObject(axModeResolveShape);

const axModeResolveOperation = defineOperation<z.infer<typeof axModeResolveSchema>, Record<string, unknown>>({
  name: 'ax.mode.resolve',
  mutates: false,
  input: axModeResolveSchema,
  inputShape: axModeResolveShape,
  http: {
    method: 'POST',
    path: '/api/canvas/ax/mode/:id/resolve',
  },
  mcp: {
    toolName: 'canvas_resolve_mode',
    description: 'Resolve a pending mode request (approved or rejected).',
    extraShape: {
      id: z.string(),
      decision: z.enum(['approved', 'rejected']),
      resolution: z.string().optional(),
      source: z.enum(AX_SOURCES).optional(),
    },
    buildInput: (input) => ({ ...input, source: normalizeAxSource(input.source, 'mcp') }),
    formatResult: axJsonResult,
  },
  handler: (input, ctx) => {
    const id = typeof input.id === 'string' ? input.id : '';
    if (input.decision !== 'approved' && input.decision !== 'rejected') {
      throw new OperationError('resolve requires decision approved or rejected.');
    }
    const modeRequest = canvasState.resolveModeRequest(id, input.decision, {
      ...(typeof input.resolution === 'string' ? { resolution: input.resolution } : {}),
      source: normalizeAxSource(input.source, 'api'),
    });
    if (!modeRequest) throw new OperationError('mode request not found or already resolved.', 404);
    ctx.emit('ax-state-changed', { modeRequest });
    return { ok: true, modeRequest } as unknown as Record<string, unknown>;
  },
});

export const axWorkOperations: Operation[] = [
  axWorkCreateOperation,
  axWorkUpdateOperation,
  axReviewAddOperation,
  axReviewUpdateOperation,
  axApprovalRequestOperation,
  axApprovalResolveOperation,
  axElicitationRequestOperation,
  axElicitationRespondOperation,
  axModeRequestOperation,
  axModeResolveOperation,
];
