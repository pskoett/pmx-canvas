import type { ActorAttribution } from './attribution.js';
import type { CanvasBoard, PersistedCanvasState } from './canvas-db.js';
import type { DocumentImport } from './document-import.js';
export interface BoardMoveInput {
    sourceBoardId: string;
    nodeIds: string[];
    name: string;
    expectedRevision: number;
    requestId: string;
    preview?: boolean;
}
export interface BoardMovePreview {
    sourceBoardId: string;
    nodeIds: string[];
    affectedBoardIds: string[];
    readmeNodeId: string | null;
    pinnedNodeIds: string[];
    liveTaskNodeIds: string[];
    attachmentIds: string[];
    blockers: string[];
    notices: string[];
}
export interface BoardMoveResult {
    sourceBoardId: string;
    destinationBoardId: string;
    portalId: string;
    nodeIds: string[];
    affectedBoardIds: string[];
}
export interface MoveBoard {
    board: CanvasBoard;
    state: PersistedCanvasState;
}
/** Pure relocation plan. Preview and commit run the same checks on a consistent library view. */
export declare function prepareBoardMove(input: BoardMoveInput, library: Map<string, MoveBoard>, destinationId: string, portalId: string, imports: DocumentImport[], runtimeBlockers: ReadonlyMap<string, string>, actor: ActorAttribution, at: string): {
    preview: BoardMovePreview;
    states: Map<string, PersistedCanvasState>;
};
