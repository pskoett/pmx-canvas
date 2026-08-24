/**
 * Session receipt (rail-chrome-v2 phase 5, design item 2): a dismissible card
 * at the canvas region's top-right after a session ends — what the session did
 * (items / done / vetoed), the pre-session snapshot (taken at attach, so View
 * diff shows the session's changes and a restore undoes them), and History
 * (the snapshots panel). Client-side state, cleared on dismiss.
 */
export interface DiffSummary {
    added: number;
    removed: number;
    modified: number;
}
/** The wire shape is SnapshotDiffResult (addedNodes/removedNodes/modifiedNodes/addedEdges/removedEdges). */
export declare function summarizeDiff(diff: unknown): DiffSummary | null;
export declare function SessionReceipt({ onOpenSnapshots }: {
    onOpenSnapshots: () => void;
}): import("preact/src").JSX.Element | null;
