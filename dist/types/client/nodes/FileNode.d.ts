import type { CanvasNodeState } from '../types';
/** Human-readable byte size, e.g. `4.2 MB`. */
export declare function formatBytes(bytes: number): string;
export declare function FileNode({ node, expanded }: {
    node: CanvasNodeState;
    expanded?: boolean;
}): import("preact/src").JSX.Element;
