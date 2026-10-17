import type { MemoryGraphNode } from '../../shared/memory-graph.js';
export type Point = {
    x: number;
    y: number;
};
export declare const MAP_CARD: {
    width: number;
    height: number;
};
export interface MemoryRegion extends Point {
    path: string;
    width: number;
    height: number;
    count: number;
    depth: number;
    collapsed: boolean;
}
/** Folder membership determines regions; authored Map positions never change membership. */
export declare function mapLayout(nodes: MemoryGraphNode[], collapsed: Set<string>): {
    positions: Map<string, Point>;
    regions: MemoryRegion[];
    hidden: Set<string>;
};
export declare function graphRadius(node: MemoryGraphNode, size: number): number;
export interface GraphLayout {
    positions: Map<string, Point>;
    cells: Map<string, {
        folder: string;
        x: number;
        y: number;
        height: number;
        cards: string[];
    }>;
    regions: MemoryRegion[];
}
/** Reserve card slots before expansion. Refreshes append, never repack existing boards. */
export declare function graphLayout(nodes: MemoryGraphNode[], previous?: GraphLayout): GraphLayout;
