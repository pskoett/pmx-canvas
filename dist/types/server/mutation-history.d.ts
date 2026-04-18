/**
 * Canvas Mutation History — Time Travel for PMX Canvas
 *
 * Records every canvas mutation in an in-memory ring buffer with forward/inverse
 * closures for undo/redo. Provides a human-readable history timeline and
 * snapshot diff capabilities.
 *
 * Design decisions:
 * - In-memory only (not persisted) — history is session-scoped
 * - Ring buffer caps at 200 entries to bound memory
 * - forward/inverse closures capture cloned state at record time
 * - _replaying flag prevents undo/redo from recording new entries
 */
import type { CanvasNodeState, CanvasEdge } from './canvas-state.js';
export type MutationOp = 'addNode' | 'updateNode' | 'removeNode' | 'addEdge' | 'removeEdge' | 'clear' | 'arrange' | 'restoreSnapshot' | 'setPins' | 'batch' | 'viewport' | 'groupNodes' | 'ungroupNodes';
export interface MutationEntry {
    id: string;
    timestamp: string;
    description: string;
    operationType: MutationOp;
    forward: () => void;
    inverse: () => void;
}
export interface MutationSummary {
    id: string;
    timestamp: string;
    description: string;
    operationType: MutationOp;
    isCurrent: boolean;
    isUndone: boolean;
}
export interface SnapshotDiffResult {
    snapshotName: string;
    addedNodes: {
        id: string;
        type: string;
        title: string | null;
    }[];
    removedNodes: {
        id: string;
        type: string;
        title: string | null;
    }[];
    modifiedNodes: {
        id: string;
        type: string;
        title: string | null;
        changes: string[];
    }[];
    addedEdges: {
        id: string;
        from: string;
        to: string;
        type: string;
    }[];
    removedEdges: {
        id: string;
        from: string;
        to: string;
        type: string;
    }[];
}
declare class MutationHistory {
    private entries;
    /** Index of the last applied mutation. -1 means nothing applied / all undone. */
    private cursor;
    /** When true, mutations triggered by undo/redo are not recorded. */
    private _replaying;
    get isReplaying(): boolean;
    /**
     * Record a new mutation. Truncates any redo-able future, then appends.
     * If called while replaying (undo/redo), the call is silently ignored.
     */
    record(entry: Omit<MutationEntry, 'id' | 'timestamp'>): void;
    /** Undo the last applied mutation. Returns the entry that was undone, or null. */
    undo(): MutationEntry | null;
    /** Redo the next undone mutation. Returns the entry that was redone, or null. */
    redo(): MutationEntry | null;
    canUndo(): boolean;
    canRedo(): boolean;
    /** Get all entries with current/undone status for display. */
    getSummaries(): MutationSummary[];
    /** Human-readable timeline for the canvas://history resource. */
    toHumanReadable(): string;
    /** Number of recorded entries. */
    get length(): number;
    /** Clear all recorded mutations. Useful for isolated test runs. */
    reset(): void;
}
/**
 * Compare two canvas layouts and produce a structured diff.
 */
export declare function diffLayouts(snapshotName: string, snapshotLayout: {
    nodes: CanvasNodeState[];
    edges: CanvasEdge[];
}, currentLayout: {
    nodes: CanvasNodeState[];
    edges: CanvasEdge[];
}): SnapshotDiffResult;
/**
 * Format a diff result as human-readable text for MCP.
 */
export declare function formatDiff(diff: SnapshotDiffResult): string;
export declare const mutationHistory: MutationHistory;
export {};
