/**
 * The context chip (docs/design/ContextChip.dc.html): what the agent's brief
 * costs in tokens, and when each pinned board was last read. The brief fetch is a measurement, not a delivery: it says so with
 * `x-pmx-proxied-read`, so it is never booked as an agent read — not even from
 * an `?agent=` tab, whose requests carry no workbench marker. Otherwise the
 * recorded read would announce itself and refetch the chip in a loop.
 */
export interface BriefSize {
    chars: number;
}
export interface BoardRead {
    lastReadAt: string;
    lastReadBy: string;
}
export declare const briefSize: import("@preact/signals-core").Signal<BriefSize | null>;
export declare const pinnedBoardReads: import("@preact/signals-core").Signal<Map<string, BoardRead | null>>;
/** A token count for display: 873, 1.1k. */
export declare function formatTokens(tokens: number): string;
/** ≈ tokens for a character count (about four characters per token). */
export declare function approxTokens(chars: number): string;
/** Debounced: pins, reads and board changes arrive in bursts; content edits wait longer. */
export declare function refreshContextChip(delayMs?: number): void;
