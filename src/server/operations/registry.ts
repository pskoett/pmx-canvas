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

function emitOperationEvent(event: string, payload: Record<string, unknown> = {}): void {
  operationEventEmitter?.(event, payload);
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
