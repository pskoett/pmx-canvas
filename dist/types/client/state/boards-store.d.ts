import type { MemoryTarget } from '../../shared/memory-graph.js';
import type { RelationDefinition } from '../../shared/relations.js';
/**
 * Many boards (plan 012): the workspace's boards and which one is open. The
 * server is the authority; this mirrors GET /api/canvas/boards and the
 * `boards-changed` SSE frame. Null means no server board is open; browsingMemory
 * separately keeps a human in the library while agents open boards.
 */
export interface BoardSummary {
    id: string;
    name: string;
    folder: string | null;
    createdAt: string;
    lastOpenedAt: string | null;
    nodeCount: number;
    readmeNodeId?: string | null;
    mapPosition?: {
        x: number;
        y: number;
    } | null;
    previousBoardId?: string | null;
    relationVocabulary?: RelationDefinition[];
    summary?: string | null;
    pinnedTitles?: Array<{
        nodeId: string;
        title: string;
    }>;
    links?: Array<{
        id?: string;
        nodeId: string;
        boardId: string;
        cardId?: string;
        cardTitle?: string | null;
        title: string | null;
        missing: boolean;
        kind?: string;
    }>;
    backlinks?: Array<{
        id?: string;
        boardId: string;
        title: string;
        nodeId: string;
        cardId?: string;
        kind?: string;
    }>;
    /** Home thumbnail (docs/design/Home.dc.html): cards as 0–1 rectangles of the board's extent. */
    preview?: Array<{
        x: number;
        y: number;
        w: number;
        h: number;
        pinned?: true;
    }>;
    /** Roughly what this board's map costs in the brief when pinned (README + pinned card summaries). */
    mapChars?: number;
    /** In the agent's working set (vision move 0a); null when not pinned. */
    pin?: {
        pinnedBy: {
            actor: string;
            source: string;
            agentId?: string;
        };
        pinnedAt: string;
        reason?: string;
    } | null;
}
export declare const boardList: import("@preact/signals-core").Signal<BoardSummary[]>;
export declare const activeBoardId: import("@preact/signals-core").Signal<string | null>;
/** An explicitly opened library view stays visible while agents switch boards. */
export declare const browsingMemory: import("@preact/signals-core").Signal<boolean>;
/** Review belongs to this navigation incarnation, never merely a reused card ID. */
export declare const lifecycleTarget: import("@preact/signals-core").Signal<{
    boardId: string;
    nodeId: string;
    incarnation: number;
} | null>;
/** Layout/pin/reconnect invalidation for the library's shared graph projection. */
export declare const memoryGraphRevision: import("@preact/signals-core").Signal<number>;
/** False until the first list arrives — Home must not flash before the server answers. */
export declare const boardsLoaded: import("@preact/signals-core").Signal<boolean>;
export declare let catalogEpoch: string | null;
export declare let boardGeneration: number | null;
/** Invalidates suspended writes when the canonical board/library is replaced. */
export declare let boardIncarnation: number;
/** Only the current transport's connected handshake may replace the server epoch. */
export declare function connectBoardCatalog(epoch: string): void;
/** The SSE bridge resyncs the canvas when the open board changes under it. */
export declare function setBoardSwitchHandler(handler: ((initial: boolean) => void) | null): void;
export declare function applyBoards(data: {
    activeBoardId?: unknown;
    boards?: unknown;
    catalogEpoch?: unknown;
    catalogRevision?: unknown;
    reloadRevision?: unknown;
    boardGeneration?: unknown;
} | null): void;
export declare function loadBoards(): Promise<void>;
/** Open a board, or Home with null. */
export declare function openBoard(id: string | null): Promise<void>;
/** Used by wiki links, graph nodes and qualified library hits; never focus a stale board's same-ID card. */
export declare function openMemoryTarget(target: MemoryTarget, options?: {
    review?: boolean;
}): Promise<boolean>;
/** Create a board (filed in `folder` when given) and open it. */
export declare function createAndOpenBoard(name: string, folder?: string | null): Promise<void>;
export interface BoardCopyCard {
    id: string;
    type: string;
    title: string | null;
    reusable: boolean;
}
export interface BoardCopyPreview {
    sourceBoardId: string;
    readmeNodeId: string | null;
    cards: BoardCopyCard[];
    edges: Array<{
        id: string;
        from: string;
        to: string;
        type: string;
    }>;
}
export declare function previewBoardCopy(sourceBoardId: string): Promise<BoardCopyPreview | null>;
export declare function createBoardFrom(opts: {
    sourceBoardId: string;
    name: string;
    folder?: string;
    nodeIds: string[];
    includeReadme: boolean;
    includeStructure: boolean;
}): Promise<BoardSummary | null>;
/** Rename and/or re-file a board; `folder: null` unfiles it. */
export declare function updateBoard(id: string, patch: {
    name?: string;
    folder?: string | null;
    mapPosition?: {
        x: number;
        y: number;
    } | null;
    relationVocabulary?: RelationDefinition[];
}): Promise<boolean>;
/** Pin a board into the agent's working set, or unpin it. */
export declare function setBoardPinned(id: string, pinned: boolean): Promise<void>;
export declare function setBoardReadme(id: string, readmeNodeId: string | null): Promise<void>;
export declare function deleteBoard(id: string): Promise<void>;
export declare function activeBoard(): BoardSummary | null;
