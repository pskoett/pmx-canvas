import { z } from 'zod';
import { type HumanPresence, type HumanPresenceSnapshot } from '../shared/human-presence.js';
/**
 * Registry of open workbench tabs (rail-chrome-v2 phase 8). Fed by the
 * browser's own `human.presence.set` heartbeats; broadcast as one coalesced
 * `human-presence` SSE frame on every change including expiry, so clients
 * never run their own expiry timers. `lockedNodes()` is the edit lock the
 * operation registry consults for agent writes (user wins).
 */
export declare const HUMAN_PRESENCE_SHAPE: {
    clientId: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
    cursor: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, z.core.$strip>>>;
    grabbingNodeId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    /** Explicit leave (tab closing): drop the presence now. */
    left: z.ZodOptional<z.ZodBoolean>;
};
type Emitter = (event: string, payload: Record<string, unknown>) => void;
export declare class HumanPresenceRegistry {
    private readonly humans;
    private emit;
    private sweepTimer;
    private emitTimer;
    setEmitter(emitter: Emitter | null): void;
    set(raw: unknown, now?: number): HumanPresence | null;
    snapshot(now?: number): HumanPresenceSnapshot;
    /** Nodes a human is holding right now → that human's name. The edit lock. */
    lockedNodes(now?: number): Map<string, string>;
    reset(): void;
    private publicView;
    private sweep;
    private scheduleEmit;
    private ensureSweeper;
    private maybeStopSweeper;
}
export declare const humanPresence: HumanPresenceRegistry;
export {};
