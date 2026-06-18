import { type PmxAxIntent } from '../shared/ax-intent.js';
type IntentEmitter = (event: string, payload: Record<string, unknown>) => void;
export declare class IntentRegistry {
    private readonly intents;
    private emit;
    private sweepTimer;
    /** Inject the workbench SSE emitter (server.ts wires this at module load). */
    setEmitter(emitter: IntentEmitter | null): void;
    list(): PmxAxIntent[];
    /** Signal a new (or replace an existing) intent. Returns the stored envelope. */
    signal(raw: unknown): PmxAxIntent;
    /** Patch a live intent (position/label/reason/confidence/seq) and bump its TTL. */
    update(id: string, raw: unknown): PmxAxIntent;
    /**
     * Clear an intent. `settledNodeId` resolves it INTO a real node (the settle
     * morph); `vetoed` marks a human pre-emptive veto. Either way the ghost
     * dissolves. Returns true when an intent was actually removed.
     */
    clear(id: string, opts?: {
        settledNodeId?: string;
        vetoed?: boolean;
    }): boolean;
    /** Drop every live intent without per-id SSE (used on hard resets). */
    reset(): void;
    private evictOverflow;
    private sweep;
    private ensureSweeper;
    private maybeStopSweeper;
}
/** Process-wide singleton, shared across HTTP handlers, MCP ops, and the SDK. */
export declare const intentRegistry: IntentRegistry;
export {};
