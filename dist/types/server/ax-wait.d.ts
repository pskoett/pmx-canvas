/** Hard ceiling on a single blocking wait, regardless of the requested timeout. */
export declare const AX_WAIT_MAX_MS = 120000;
export interface AxWaitResult<T> {
    /** Latest value, or null if the item does not exist / vanished mid-wait. */
    value: T | null;
    /** True only when the item still exists and is still pending after the wait. */
    pending: boolean;
}
/**
 * Block until a canvas-bound AX item resolves (its status leaves `pending`), the
 * timeout elapses, or the request aborts — the server side of report primitive D
 * ("gates that actually gate"). Resolves immediately when the item is already
 * resolved, missing, or `timeoutMs <= 0` (a plain single read). Subscribes to the
 * `ax` change channel and always disposes the listener + timer.
 */
export declare function waitForAxResolution<T extends {
    status: string;
}>(opts: {
    read: () => T | null;
    isResolved: (value: T) => boolean;
    timeoutMs: number;
    signal?: AbortSignal;
}): Promise<AxWaitResult<T>>;
/**
 * Block until `ready()` turns true after a change on `channel` (default
 * 'ax-timeline'), or the timeout elapses. The steering long-poll: the gate
 * waiter above is item/status-shaped; this one waits on a plain condition —
 * the reactive loop for agent hosts that cannot be woken from outside (their
 * model only runs while their host gives it a turn, so one call parks here
 * instead of burning that turn on tight polling).
 */
export declare function waitForAxCondition(opts: {
    ready: () => boolean;
    timeoutMs: number;
    channel?: string;
}): Promise<void>;
