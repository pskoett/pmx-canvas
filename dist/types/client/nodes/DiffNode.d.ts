import type { CanvasNodeState } from '../types';
export interface ParsedDiffLine {
    kind: 'add' | 'remove' | 'context' | 'hunk';
    text: string;
}
export interface ParsedDiffSection {
    /** Display path derived from the +++/--- headers or the `diff --git` line; null for headerless diffs. */
    path: string | null;
    lines: ParsedDiffLine[];
}
/**
 * Split unified diff text into file sections, hunk headers, and classified
 * lines. Recognizes `diff --git` boundaries and `---`/`+++` header pairs
 * (never misclassifying them as remove/add); diffs without any file headers
 * parse as a single anonymous section.
 */
export declare function parseUnifiedDiff(text: string): ParsedDiffSection[];
export declare function DiffNode({ node }: {
    node: CanvasNodeState;
}): import("preact/src").JSX.Element;
