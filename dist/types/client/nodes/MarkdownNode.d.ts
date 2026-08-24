import type { JSX } from 'preact';
import type { CanvasNodeState } from '../types';
/** Flip the index-th GFM task marker in the source (document order matches the rendered boxes). */
export declare function toggleTaskMarker(markdown: string, index: number): string;
export declare function MarkdownNode({ node, expanded }: {
    node: CanvasNodeState;
    expanded?: boolean;
}): JSX.Element;
