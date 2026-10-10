import type { CanvasNodeState, NodeDeletionTombstone } from './canvas-state.js';
export type ContextBriefReason = 'overview' | 'pinned' | 'near' | 'changed' | 'pinned-board' | 'human' | 'ask' | 'steer' | 'linked' | 'category';
/** How long a card's summary is in the brief: enough to know what it is. */
export declare const BRIEF_SUMMARY_LENGTH = 280;
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
/**
 * A board in the working set (vision move 0a), sent as a map: enough to know what
 * it is and how it relates, so the agent decides what to pull in full.
 */
export interface ContextBriefPinnedBoard {
    boardId: string;
    name: string;
    folder: string | null;
    readmeSummary: string | null;
    /** Pinned cards as title + short summary, each pullable by id. */
    cards: Array<{
        nodeId: string;
        title: string;
        summary: string;
    }>;
    /** Names of the boards it links to and is linked from. */
    links: string[];
    backlinks: string[];
}
/** The open board at a glance: what it is and how it relates to other boards. */
export interface ContextBriefOverview {
    folder: string | null;
    readmeSummary: string | null;
    links: string[];
    backlinks: string[];
}
export interface ContextBriefEdge {
    from: string;
    to: string;
    type: string;
    label?: string | null;
    /** Board revision of the link's latest add, retype or relabel, and who made it. */
    revision?: number;
    changedBy?: {
        actor: string;
        source: string;
        agentId?: string;
    };
    /** Equal to changedAt while the link is as first drawn: "new" rather than "changed". */
    createdAt?: string;
    changedAt?: string;
}
export interface ContextBriefInput {
    activeBoard: {
        boardId: string;
        name: string;
        category: string | null;
    };
    /** The brief is a map, not a dump: overview and relations let the agent choose what to pull. */
    overview?: ContextBriefOverview;
    /** Edges on the open board, carried as each card's relations. */
    edges?: readonly ContextBriefEdge[];
    /** Why each pin was pinned, when someone said. */
    pinReasons?: Readonly<Record<string, string>>;
    nodes: readonly CanvasNodeState[];
    pinnedNodeIds: readonly string[];
    contentRevision: number;
    retentionFloor: number;
    tombstones: readonly NodeDeletionTombstone[];
    /** null means a first read. Other values must be non-negative safe integers. */
    since: number | null;
    libraryBoards: readonly ContextBriefLibraryBoard[];
    /** Pinned boards, each sent as a map (see ContextBriefPinnedBoard). */
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
    /** A title + short summary of a card the agent may pull in full; seen, not read. */
    summaryOnly?: true;
    /**
     * On a later read, what changed on this card since the cursor
     * (docs/design/LinksChanged.dc.html): its text, its links, or both.
     */
    changes?: Array<'text' | 'links'>;
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
