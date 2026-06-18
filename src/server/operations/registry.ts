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

// Depth-counted emit suppression (mirrors canvasState._suppressRecordingDepth).
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
    const input = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
      ? rawInput as Record<string, unknown>
      : {};
    return typeof input.nodeId === 'string' && input.nodeId.length > 0 ? ['edit'] : ['create'];
  }
  return INTENT_KINDS_BY_OPERATION[name];
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

export async function executeOperation(name: string, rawInput: unknown): Promise<unknown> {
  const op = getOperation(name);
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
        return result;
      },
      settledNodeId,
    );
  }

  const result = await op.execute(rawInput, operationContext);
  if (op.mutates) emitOperationEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  return result;
}
