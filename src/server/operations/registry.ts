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

export async function executeOperation(name: string, rawInput: unknown): Promise<unknown> {
  const op = getOperation(name);
  const result = await op.execute(rawInput, operationContext);
  if (op.mutates) {
    emitOperationEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  }
  return result;
}
