/**
 * The context chip (docs/design/ContextChip.dc.html): how big the agent's brief
 * is against its budget, whether it was clipped, and when each pinned board was
 * last read. The brief fetch is a measurement, not a delivery: it says so with
 * `x-pmx-proxied-read`, so it is never booked as an agent read — not even from
 * an `?agent=` tab, whose requests carry no workbench marker. Otherwise the
 * recorded read would announce itself and refetch the chip in a loop.
 */
export interface BriefSize {
    chars: number;
    budget: number;
    clipped: boolean;
}
export interface BoardRead {
    lastReadAt: string;
    lastReadBy: string;
}
export declare const briefSize: import("@preact/signals-core").Signal<BriefSize | null>;
export declare const pinnedBoardReads: import("@preact/signals-core").Signal<Map<string, BoardRead | null>>;
/** ≈ tokens for a character count; the brief budget is UTF-16 characters. */
export declare function approxTokens(chars: number): string;
/** Debounced: pins, reads and board changes arrive in bursts; content edits wait longer. */
export declare function refreshContextChip(delayMs?: number): void;
