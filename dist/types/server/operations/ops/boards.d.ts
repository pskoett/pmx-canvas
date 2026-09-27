import { type CanvasLayout } from '../../canvas-state.js';
import { type Operation } from '../types.js';
export declare function boardsPayload(): Record<string, unknown>;
/** Read a board without opening it. Omitted board preserves the active-board contract. */
export declare function readTargetBoard(boardId?: unknown, includeBlobs?: boolean): {
    boardId: string | null;
    layout: CanvasLayout;
    pinnedNodeIds: Set<string>;
};
export declare const boardOperations: Operation[];
