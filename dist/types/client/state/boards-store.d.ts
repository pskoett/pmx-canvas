/**
 * Many boards (plan 012): the workspace's boards and which one is open. The
 * server is the authority; this mirrors GET /api/canvas/boards and the
 * `boards-changed` SSE frame. `activeBoardId === null` is Home.
 */
export interface BoardSummary {
    id: string;
    name: string;
    createdAt: string;
    lastOpenedAt: string | null;
    nodeCount: number;
}
export declare const boardList: import("@preact/signals-core").Signal<BoardSummary[]>;
export declare const activeBoardId: import("@preact/signals-core").Signal<string | null>;
/** False until the first list arrives — Home must not flash before the server answers. */
export declare const boardsLoaded: import("@preact/signals-core").Signal<boolean>;
/** The SSE bridge resyncs the canvas when the open board changes under it. */
export declare function setBoardSwitchHandler(handler: (() => void) | null): void;
export declare function applyBoards(data: {
    activeBoardId?: unknown;
    boards?: unknown;
} | null): void;
export declare function loadBoards(): Promise<void>;
/** Open a board, or Home with null. */
export declare function openBoard(id: string | null): Promise<void>;
export declare function createAndOpenBoard(name: string): Promise<void>;
export declare function renameBoard(id: string, name: string): Promise<void>;
export declare function deleteBoard(id: string): Promise<void>;
export declare function activeBoard(): BoardSummary | null;
