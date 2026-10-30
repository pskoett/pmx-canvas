import type { CanvasNodeState } from '../types';
export declare function hasUnsavedPrompt(boardId: string, nodeId: string): boolean;
export declare function PromptNode({ node, expanded }: {
    node: CanvasNodeState;
    expanded?: boolean;
}): import("preact/src").JSX.Element;
