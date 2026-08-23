type GateEmitter = (event: string, payload: Record<string, unknown>) => void;
/** Hold every pending gate whose TTL has elapsed. Returns the gates it held. */
export declare function sweepExpiredGates(now?: number): string[];
export declare function startGateTtlSweeper(emitter: GateEmitter): void;
export declare function stopGateTtlSweeper(): void;
export {};
