import { type Operation } from './types.js';
export declare function registerOperation(op: Operation): void;
export declare function getOperation(name: string): Operation;
export declare function listOperations(): Operation[];
type OperationEventEmitter = (event: string, payload: Record<string, unknown>) => void;
export declare function setOperationEventEmitter(emitter: OperationEventEmitter | null): void;
/** Run `fn` with all operation SSE emits suppressed; restores depth on finally. */
export declare function runWithSuppressedEmits<T>(fn: () => Promise<T>): Promise<T>;
export declare function executeOperation(name: string, rawInput: unknown): Promise<unknown>;
export {};
