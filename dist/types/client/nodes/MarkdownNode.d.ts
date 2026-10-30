import type { JSX } from 'preact';
import type { CanvasNodeState } from '../types';
/** Flip exactly one parsed GFM task without reformatting any other source bytes. */
export declare function toggleTaskMarker(markdown: string, index: number): string;
/** Review must refer to persisted content, not an edited or saving preview. */
export declare function hasUnsavedMarkdown(boardId: string, nodeId: string): boolean;
/** After blur, navigate only when this board/card's save has actually succeeded. */
export declare function waitForMarkdownSave(boardId: string | null, nodeId: string): Promise<boolean>;
export declare function MarkdownNode({ node, expanded }: {
    node: CanvasNodeState;
    expanded?: boolean;
}): JSX.Element;
