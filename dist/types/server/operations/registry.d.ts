import { type Operation } from './types.js';
export declare function registerOperation(op: Operation): void;
export declare function getOperation(name: string): Operation;
export declare function listOperations(): Operation[];
type OperationEventEmitter = (event: string, payload: Record<string, unknown>) => void;
export declare function setOperationEventEmitter(emitter: OperationEventEmitter | null): void;
export declare function executeOperation(name: string, rawInput: unknown): Promise<unknown>;
export {};
