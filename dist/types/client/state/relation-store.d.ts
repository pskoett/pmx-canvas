import type { CanvasEdge } from '../types';
export declare const relationFilter: import("@preact/signals-core").Signal<{
    boardId: string;
    kind: string;
} | null>;
export declare function showRelationsOnCanvas(nodeId: string, mode: 'lineage' | 'connections'): void;
/** Only qualified dependency/lineage sources warn; citations and illustrated loops never do. */
export declare function relationWarning(edge: CanvasEdge): string[];
export declare const dependencyAnalysis: import("@preact/signals-core").ReadonlySignal<{
    cycles: number;
    cycleEdges: Set<string>;
    affected: Set<string>;
    focused: boolean;
    hasDependencies: boolean;
}>;
export declare const relationFocus: import("@preact/signals-core").ReadonlySignal<string | null>;
/** View-only highlights. They never infer evidence, change a decision or execute a flow. */
export declare const relationHighlight: import("@preact/signals-core").ReadonlySignal<{
    cards: Set<string>;
    links: Set<string>;
} | null>;
