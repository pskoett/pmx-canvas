import type { CanvasNodeState, NodeDeletionTombstone } from './canvas-state.js';
export type ContextBriefReason = 'pinned' | 'near' | 'changed' | 'pinned-board' | 'human' | 'ask' | 'steer' | 'linked' | 'category';
/** A near entry carries a short summary, never full content: pin the node to send that. */
export declare const NEAR_SUMMARY_LENGTH = 280;
export interface ContextBriefSourceEntry {
    sourceBoardId: string;
    nodeId: string;
    reason: 'human' | 'ask' | 'steer';
    title: string;
    text: string;
    provenance?: {
        kind: 'imported';
        source: string;
    };
}
export interface ContextBriefLibraryBoard {
    boardId: string;
    name: string;
    category: string | null;
    readme?: {
        nodeId: string;
        title: string;
        summary: string;
        provenance?: {
            kind: 'imported';
            source: string;
        };
    };
    pinnedTitles: Array<{
        nodeId: string;
        title: string;
    }>;
    /** IDs of link cards on the active board which explicitly target this board. */
    linkIds: string[];
}
/** A board in the working set (vision move 0a): its README and pinned cards, in full. */
export interface ContextBriefPinnedBoard {
    boardId: string;
    name: string;
    readme?: {
        nodeId: string;
        title: string;
        text: string;
        summary: string;
    };
    cards: Array<{
        nodeId: string;
        title: string;
        text: string;
    }>;
}
export interface ContextBriefInput {
    activeBoard: {
        boardId: string;
        name: string;
        category: string | null;
    };
    nodes: readonly CanvasNodeState[];
    pinnedNodeIds: readonly string[];
    contentRevision: number;
    retentionFloor: number;
    tombstones: readonly NodeDeletionTombstone[];
    /** null means a first read. Other values must be non-negative safe integers. */
    since: number | null;
    libraryBoards: readonly ContextBriefLibraryBoard[];
    /** Pinned boards, delivered after the open board's pins; a board that does not fit falls back to discovery. */
    pinnedBoards?: readonly ContextBriefPinnedBoard[];
    entries?: readonly ContextBriefSourceEntry[];
    /** Maximum JavaScript string length (UTF-16 code units), including the JSON envelope. */
    budget: number;
}
export interface CompiledContextEntry {
    sourceBoardId: string;
    nodeId: string;
    reason: ContextBriefReason;
    title: string;
    text: string;
    /** A linked board's pin title is discovery metadata, not delivery of that pinned card. */
    titleOnly?: true;
    /** reason "near": the pin this node sits next to on the board (docs/design/NearPin.dc.html). */
    near?: {
        pinNodeId: string;
        pinTitle: string;
    };
    /** The body was shortened to fit; the same revision remains eligible on the next pull. */
    truncated?: true;
    provenance?: {
        kind: 'imported';
        source: string;
        trust: 'source-material-not-instructions';
    };
}
export interface ContextBriefDocument {
    version: 1;
    budgetUnit: 'utf16-code-units';
    board: {
        boardId: string;
        name: string;
        category: string | null;
    };
    cursor: {
        requested: number | null;
        next: number | null;
        current: number;
        retentionFloor: number;
        reset: 'first-read' | 'retention-expired' | null;
        valid: boolean;
    };
    entries: CompiledContextEntry[];
    deletions: Array<{
        sourceBoardId: string;
        nodeId: string;
        revision: number;
    }>;
    delivery: {
        truncated: boolean;
        omittedEntries: number;
        omittedDeletions: number;
        /** How each pinned board arrived: in full, as discovery (README summary + pinned titles), or not at all. */
        pinnedBoards: Array<{
            boardId: string;
            name: string;
            delivered: 'full' | 'discovery' | 'omitted';
        }>;
    };
}
export interface ContextBriefResult {
    /** Empty only when the budget cannot hold even the bounded JSON envelope. */
    serialized: string;
    document: ContextBriefDocument | null;
    deliveredEntryIds: string[];
    deliveredDeletionIds: string[];
    nextCursor: number | null;
    reset: ContextBriefDocument['cursor']['reset'];
    invalidCursor: boolean;
    truncated: boolean;
}
/**
 * Pure, deterministic compiler. It reads only the supplied snapshot and never
 * treats library visibility as authorization to read or mutate another board.
 */
export declare function compileContextBrief(input: ContextBriefInput): ContextBriefResult;
