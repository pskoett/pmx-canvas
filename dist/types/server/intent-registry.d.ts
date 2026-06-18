import { type PmxAxIntent, type PmxAxIntentKind } from '../shared/ax-intent.js';
type IntentEmitter = (event: string, payload: Record<string, unknown>) => void;
export declare class IntentRegistry {
    private readonly intents;
    private readonly vetoedIntentIds;
    private readonly committingIntentIds;
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
    /**
     * Gate one real mutation behind a live, non-vetoed intent. The claim is
     * synchronous: once this method has accepted the intent, a later veto cannot
     * race in between the check and the mutation.
     */
    beginCommit(id: string, allowedKinds: readonly PmxAxIntentKind[]): PmxAxIntent;
    completeCommit(id: string, settledNodeId?: string): void;
    abortCommit(id: string): void;
    runCommit<T>(id: string, allowedKinds: readonly PmxAxIntentKind[], mutate: () => T | Promise<T>, settledNodeId: (result: T, intent: PmxAxIntent) => string | undefined): Promise<T>;
    /** Drop every live intent without per-id SSE (used on hard resets). */
    reset(): void;
    private rememberVeto;
    private pruneVetoTombstones;
    private evictOverflow;
    private sweep;
    private ensureSweeper;
    private maybeStopSweeper;
}
/** Process-wide singleton, shared across HTTP handlers, MCP ops, and the SDK. */
export declare const intentRegistry: IntentRegistry;
export {};
