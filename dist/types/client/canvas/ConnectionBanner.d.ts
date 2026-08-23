/**
 * Degraded connection states (rail-chrome-v2 phase 7, design item 14), mapped
 * onto the transport the bridge already runs:
 * - reconnecting: the stream (SSE or the polling fallback) is down and the
 *   bridge is backing off. Edits still go over HTTP; the board may be stale.
 * - resyncing: a transport came back after a drop and the full `connected`
 *   snapshot is being applied — the seq cursor was dropped, the board reloads
 *   from the server's snapshot without touching local edits.
 * Neither shows on first boot; the top-bar dot carries the same state.
 */
export type DegradedState = 'reconnecting' | 'resyncing' | null;
export declare const degradedState: import("@preact/signals-core").ReadonlySignal<DegradedState>;
export declare function ConnectionBanner(): import("preact/src").JSX.Element | null;
