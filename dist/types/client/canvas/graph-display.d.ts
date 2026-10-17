import { type MemoryGraphEdge, type MemoryGraphNode } from '../../shared/memory-graph.js';
export interface GraphConnection {
    key: string;
    from: string;
    to: string;
    kind: MemoryGraphEdge['kind'];
    exact: boolean;
    edges: MemoryGraphEdge[];
    incident: number;
}
/** A view projection only: qualified raw evidence, direction and revisions stay untouched. */
export declare function graphDisplay(nodes: MemoryGraphNode[], edges: MemoryGraphEdge[], options: {
    expanded: ReadonlySet<string>;
    eligible: ReadonlySet<string>;
    hiddenLinks: ReadonlySet<MemoryGraphEdge['kind']>;
    selectedKey: string | null;
    showBoards: boolean;
    showCards: boolean;
}): {
    nodes: MemoryGraphNode[];
    connections: GraphConnection[];
    internal: Map<string, number>;
    neighbors: Set<string>;
    exactCount: number;
    bundledCount: number;
};
