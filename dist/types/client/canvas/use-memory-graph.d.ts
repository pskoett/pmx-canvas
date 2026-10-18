import type { MemoryGraph } from '../../shared/memory-graph.js';
/** Coalesce live discovery and reject responses from an older library revision. */
export declare function useMemoryGraph(projection: 'full' | 'boards'): {
    graph: MemoryGraph | null;
    loading: boolean;
    error: boolean;
    retry: () => void;
};
