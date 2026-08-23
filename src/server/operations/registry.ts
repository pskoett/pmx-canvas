/**
 * Operation registry: register/get/list plus the ONE execution path
 * (`executeOperation`: validate → run → emit) shared by HTTP, MCP, and CLI.
 *
 * SSE wiring: server.ts injects the workbench event emitter via
 * `setOperationEventEmitter` (same pattern as `setCanvasLayoutUpdateEmitter`).
 * Handlers never emit `canvas-layout-update` themselves for the final state —
 * `mutates: true` is the single source; extra events go through `ctx.emit`.
 */
import { canvasState } from '../canvas-state.js';
import { intentRegistry } from '../intent-registry.js';
import { agentPresence } from '../agent-presence.js';
import { checkScopeFence, checkScopeOwnership } from '../scope-fence.js';
import type { PmxAxIntent, PmxAxIntentKind } from '../../shared/ax-intent.js';
import { OperationError, type Operation, type OperationContext } from './types.js';

const operations = new Map<string, Operation>();

export function registerOperation(op: Operation): void {
  if (operations.has(op.name)) {
    throw new Error(`Operation "${op.name}" is already registered.`);
  }
  operations.set(op.name, op);
}

export function getOperation(name: string): Operation {
  const op = operations.get(name);
  if (!op) throw new OperationError(`Unknown operation "${name}".`, 400);
  return op;
}

export function listOperations(): Operation[] {
  return [...operations.values()];
}

type OperationEventEmitter = (event: string, payload: Record<string, unknown>) => void;

let operationEventEmitter: OperationEventEmitter | null = null;

export function setOperationEventEmitter(emitter: OperationEventEmitter | null): void {
  operationEventEmitter = emitter;
}

// Depth-counted EMIT suppression (same pattern as, but deliberately distinct
// state from, canvasState's recording suppression: batch suppresses SSE emits
// while sub-ops still record history; undo/redo suppresses recording while
// still emitting SSE — merging the two counters would break one or the other).
// While > 0, emitOperationEvent is a no-op so a meta-op (canvas.batch) can run
// many sub-ops without producing per-entry SSE frames, then emit ONE final
// layout frame itself. Both the `mutates` auto-emit and `ctx.emit` route through
// emitOperationEvent, so this covers both. Re-entrant-safe via the depth counter.
let suppressEmitDepth = 0;

function emitOperationEvent(event: string, payload: Record<string, unknown> = {}): void {
  if (suppressEmitDepth > 0) return;
  operationEventEmitter?.(event, payload);
}

/** True while operation SSE emits are being suppressed (inside a meta-op such as
 * canvas.batch). Ops whose effect depends on a live SSE emit firing — e.g.
 * mcpapp.open, whose canvas node is created as a side-effect of `ext-app-open` —
 * use this to reject loudly instead of silently no-op'ing in a suppressed run. */
export function isEmitSuppressed(): boolean {
  return suppressEmitDepth > 0;
}

/** Run `fn` with all operation SSE emits suppressed; restores depth on finally. */
export async function runWithSuppressedEmits<T>(fn: () => Promise<T>): Promise<T> {
  suppressEmitDepth++;
  try {
    return await fn();
  } finally {
    suppressEmitDepth--;
  }
}

const operationContext: OperationContext = { emit: emitOperationEvent };

const INTENT_KINDS_BY_OPERATION: Record<string, readonly PmxAxIntentKind[]> = {
  'node.add': ['create'],
  'jsonrender.add': ['create'],
  'graph.add': ['create'],
  'group.create': ['create'],
  'node.update': ['move', 'edit'],
  'group.add': ['edit'],
  'group.remove': ['edit'],
  'edge.add': ['connect'],
  'node.remove': ['remove'],
};

function linkedIntentId(rawInput: unknown): string | undefined {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) return undefined;
  const record = rawInput as Record<string, unknown>;
  if (record.intentId === undefined) return undefined;
  if (typeof record.intentId !== 'string' || record.intentId.trim().length === 0) {
    throw new OperationError('intentId must be a non-empty string.');
  }
  return record.intentId;
}

function allowedIntentKinds(name: string, rawInput: unknown): readonly PmxAxIntentKind[] | undefined {
  if (name === 'jsonrender.stream') {
    const input =
      rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput) ? (rawInput as Record<string, unknown>) : {};
    return typeof input.nodeId === 'string' && input.nodeId.length > 0 ? ['edit'] : ['create'];
  }
  return INTENT_KINDS_BY_OPERATION[name];
}

/**
 * Ops exempt from auto-ghost SYNTHESIS only (explicit intent linking above is
 * unaffected). Stream appends arrive in rapid succession — a fresh ghost per
 * chunk is exactly the high-frequency churn class the batch exemption exists
 * for; the stream's CREATING call (no nodeId yet) still ghosts once.
 */
function autoGhostExempt(name: string, rawInput: unknown): boolean {
  if (name !== 'jsonrender.stream') return false;
  const input =
    rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput) ? (rawInput as Record<string, unknown>) : {};
  return typeof input.nodeId === 'string' && input.nodeId.length > 0;
}

function settledNodeId(result: unknown, intent: PmxAxIntent): string | undefined {
  if (intent.kind === 'connect' || intent.kind === 'remove') return undefined;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined;
  const record = result as Record<string, unknown>;
  if (typeof record.nodeId === 'string') return record.nodeId;
  if (record.node && typeof record.node === 'object' && !Array.isArray(record.node)) {
    const id = (record.node as Record<string, unknown>).id;
    if (typeof id === 'string') return id;
  }
  if (typeof record.groupId === 'string') return record.groupId;
  return typeof record.id === 'string' ? record.id : undefined;
}

/** Verb for the synthesized auto-ghost chip, per intent kind. */
const AUTO_GHOST_VERBS: Record<string, string> = {
  create: 'Adding',
  move: 'Moving',
  edit: 'Updating',
  connect: 'Connecting',
  remove: 'Removing',
};

const AUTO_GHOST_EDGE_TYPES = new Set(['flow', 'depends-on', 'relation', 'references']);

/**
 * Build a valid signal input for a synthesized ghost, or null when the raw
 * input can't satisfy the kind's required fields (e.g. a create with server
 * auto-placement has no position to ghost at) — in that case the mutation
 * simply runs unghosted.
 */
function autoGhostInput(name: string, rawInput: unknown, kind: string): Record<string, unknown> | null {
  const body =
    rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput) ? (rawInput as Record<string, unknown>) : {};
  const subject =
    typeof body.title === 'string' && body.title.trim()
      ? body.title.trim().slice(0, 80)
      : typeof body.type === 'string'
        ? `${body.type} node`
        : typeof body.id === 'string'
          ? body.id
          : name.split('.')[0];
  const base = {
    kind,
    label: `${AUTO_GHOST_VERBS[kind] ?? 'Changing'} ${subject}`,
    ...(typeof body.type === 'string' ? { nodeType: body.type } : {}),
    source: 'auto',
    auto: true,
    ttlMs: 6000,
  };
  const position = typeof body.x === 'number' && typeof body.y === 'number' ? { x: body.x, y: body.y } : undefined;
  switch (kind) {
    case 'create':
      return position ? { ...base, position } : null;
    case 'move':
      return typeof body.id === 'string' && position ? { ...base, nodeId: body.id, position } : null;
    case 'edit':
    case 'remove':
      return typeof body.id === 'string' ? { ...base, nodeId: body.id } : null;
    case 'connect': {
      if (typeof body.from !== 'string' || typeof body.to !== 'string') return null;
      const edgeType = typeof body.type === 'string' && AUTO_GHOST_EDGE_TYPES.has(body.type) ? body.type : 'flow';
      return { ...base, nodeType: undefined, edge: { from: body.from, to: body.to, type: edgeType } };
    }
    default:
      return null;
  }
}

export interface ExecuteOperationMeta {
  /**
   * Skip the synthesized auto-ghost: set by the workbench's own HTTP calls
   * (a human dragging a node is not agent activity) and by canvas.batch for
   * its inner dispatches (batch churn is exempt, matching the skill contract).
   */
  suppressAutoGhost?: boolean;
  /**
   * Who is calling — the presence writer label ('mcp', 'sdk', 'api', …).
   * Defaults to 'api'. Workbench calls (suppressAutoGhost) never touch presence.
   */
  source?: string;
  /**
   * The human's own browser issued this call. Distinct from suppressAutoGhost
   * (which batch also sets for its inner dispatches): the scope fence applies
   * to agents only, and batch inner writes are always agent-originated.
   */
  fromWorkbench?: boolean;
}

/**
 * Agent presence (rail-chrome-v2 phase 2): every agent-originated MUTATION —
 * the same calls that synthesize auto-ghosts — touches the caller's presence
 * as `tooling`. Reads never do (polling an agent's own context is not work).
 * Presence must never break the mutation, so this is fire-and-forget.
 */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The node an operation touched — the agent cursor glides there. */
function touchedNodeId(rawInput: unknown, result: unknown): string | null {
  const input = asRecord(rawInput);
  if (typeof input.id === 'string') return input.id;
  if (typeof input.nodeId === 'string') return input.nodeId;
  const res = asRecord(result);
  if (typeof res.id === 'string') return res.id;
  const node = asRecord(res.node);
  return typeof node.id === 'string' ? node.id : null;
}

/**
 * Ops that are writes for PRESENCE purposes but must not touch it themselves:
 * the presence endpoint (it IS the explicit phase — a derived `tooling` touch
 * would clobber it) and activity ingest (observeActivity already mapped it,
 * and re-touching after a `session-end` would resurrect the writer).
 */
const PRESENCE_EXEMPT_OPS = new Set(['ax.presence.set', 'ax.presence.get', 'ax.activity.ingest']);

/** Layout mutations AND non-GET AX writes (work items, gates, evidence, steering) are agent activity. */
function isPresenceWrite(op: Operation): boolean {
  if (PRESENCE_EXEMPT_OPS.has(op.name)) return false;
  return op.mutates || (op.http != null && op.http.method !== 'GET');
}

function notePresence(
  name: string,
  rawInput: unknown,
  meta: ExecuteOperationMeta,
  op: Operation,
  result: unknown,
): void {
  if (!isPresenceWrite(op) || meta.suppressAutoGhost) return;
  const input = asRecord(rawInput);
  try {
    const focusNodeId = touchedNodeId(rawInput, result);
    agentPresence.touch({
      source: meta.source ?? 'api',
      agentId: typeof input.agentId === 'string' ? input.agentId : null,
      phase: 'tooling',
      detail: name,
      ...(focusNodeId ? { focusNodeId } : {}),
      op: true,
    });
  } catch {
    // never let presence bookkeeping fail a mutation
  }
}

export async function executeOperation(
  name: string,
  rawInput: unknown,
  meta: ExecuteOperationMeta = {},
): Promise<unknown> {
  const op = getOperation(name);
  // Scope fence (design item 4): an attached agent's writes must stay inside
  // the fence the human granted. Reads and the human's own writes pass, and
  // the fence itself is the human's to set — an agent cannot clear or widen it.
  if (!meta.fromWorkbench) {
    const refusal = op.mutates
      ? checkScopeFence(op, rawInput)
      : name === 'ax.policy.set'
        ? checkScopeOwnership(rawInput)
        : null;
    if (refusal) throw new OperationError(`Outside the agent scope: ${refusal}`, 403);
  }
  const intentId = linkedIntentId(rawInput);
  const allowedKinds = intentId ? allowedIntentKinds(name, rawInput) : undefined;
  if (intentId && !allowedKinds) {
    throw new OperationError(`Operation "${name}" cannot be committed through a ghost intent.`);
  }
  if (intentId) {
    return intentRegistry.runCommit(
      intentId,
      allowedKinds!,
      async () => {
        const result = await op.execute(rawInput, operationContext);
        if (op.mutates) {
          emitOperationEvent('canvas-layout-update', { layout: canvasState.getLayout() });
        }
        notePresence(name, rawInput, meta, op, result);
        return result;
      },
      settledNodeId,
    );
  }

  // Auto-ghost: an agent-originated visible mutation with NO explicit intent
  // still shows its move on the canvas — a server-synthesized ghost that
  // settles the moment the mutation lands (the client's minimum-dwell keeps
  // the flash perceptible). Explicit canvas_intent signalling stays the
  // richer path (labels, reasons, a real veto window before the mutation).
  const autoKinds = allowedIntentKinds(name, rawInput);
  if (
    autoKinds &&
    !meta.suppressAutoGhost &&
    !autoGhostExempt(name, rawInput) &&
    process.env.PMX_CANVAS_AUTO_INTENT !== '0'
  ) {
    // Ghost synthesis must NEVER break the mutation: skip silently when the
    // input can't satisfy a kind's required fields or signalling throws.
    let ghost: PmxAxIntent | null = null;
    try {
      for (const kind of autoKinds) {
        const input = autoGhostInput(name, rawInput, kind);
        if (input) {
          ghost = intentRegistry.signal(input);
          break;
        }
      }
    } catch {
      ghost = null;
    }
    if (ghost) {
      const ghostId = ghost.id;
      try {
        const result = await op.execute(rawInput, operationContext);
        if (op.mutates) emitOperationEvent('canvas-layout-update', { layout: canvasState.getLayout() });
        intentRegistry.clear(ghostId, { settledNodeId: settledNodeId(result, ghost) ?? undefined });
        notePresence(name, rawInput, meta, op, result);
        return result;
      } catch (error) {
        intentRegistry.clear(ghostId);
        throw error;
      }
    }
  }

  const result = await op.execute(rawInput, operationContext);
  if (op.mutates) emitOperationEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  notePresence(name, rawInput, meta, op, result);
  return result;
}
