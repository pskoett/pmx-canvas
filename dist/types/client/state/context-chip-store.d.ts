/**
 * The context chip (docs/design/ContextChip.dc.html): how big the agent's brief
 * is against its budget, whether it was clipped, and when each pinned board was
 * last read. The workbench's own brief fetch carries the workbench marker, so it
 * is never booked as an agent read.
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
/** Debounced: pins, reads and board changes arrive in bursts. */
export declare function refreshContextChip(): void;
