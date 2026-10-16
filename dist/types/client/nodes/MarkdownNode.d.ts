import type { JSX } from 'preact';
import type { CanvasNodeState } from '../types';
/** Flip the index-th GFM task marker in the source (document order matches the rendered boxes). */
export declare function toggleTaskMarker(markdown: string, index: number): string;
/** Review must refer to persisted content, not an edited or saving preview. */
export declare function hasUnsavedMarkdown(boardId: string, nodeId: string): boolean;
export declare function MarkdownNode({ node, expanded }: {
    node: CanvasNodeState;
    expanded?: boolean;
}): JSX.Element;
