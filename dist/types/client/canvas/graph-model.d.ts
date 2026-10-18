import type { MemoryGraphEdge, MemoryGraphNode } from '../../shared/memory-graph.js';
import type { Point } from './memory-layout';
export type GraphScene = {
    kind: 'overview';
} | {
    kind: 'board';
    boardId: string;
} | {
    kind: 'card';
    boardId: string;
    cardId: string;
};
export declare const graphSceneKey: (scene: GraphScene) => string;
export declare const pairKey: (a: string, b: string) => string;
/** Partition original facts once; grouping never changes authored endpoints. */
export declare function graphEvidence(edges: MemoryGraphEdge[]): {
    evidence: MemoryGraphEdge[];
    pairs: Map<string, {
        boardId: string;
        peerId: string;
        edges: MemoryGraphEdge[];
    }>;
    internal: Map<string, number>;
    missing: MemoryGraphEdge[];
};
/** One animation step. The pointer/drop anchor stays fixed while its visible neighbors respond. */
export declare function relaxGraphPositions(positions: Map<string, Point>, edges: ReadonlyArray<{
    from: string;
    to: string;
    weight?: number;
}>, held: string, cooling: number): number;
/** Deterministic initial placement; live additions preserve retained coordinates. */
export declare function graphPositions(nodes: MemoryGraphNode[], edges: ReadonlyArray<{
    from: string;
    to: string;
    weight?: number;
}>, retained: Map<string, Point>): Map<string, Point>;
