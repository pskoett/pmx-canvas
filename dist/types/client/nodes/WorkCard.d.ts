import { type AxWorkItemStatus } from '../../shared/ax-kinds.js';
import type { CanvasNodeState } from '../types';
export declare function hasUnsavedWorkCard(boardId: string, nodeId: string): boolean;
export declare function WorkCard({ node, state }: {
    node: CanvasNodeState;
    state: AxWorkItemStatus;
}): import("preact/jsx-runtime").JSX.Element;
