import { type SimulationNodeDatum } from 'd3-force';
import { type MemoryGraphEdge, type MemoryGraphNode } from '../../shared/memory-graph.js';
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
export interface GraphParticle extends SimulationNodeDatum {
    key: string;
    boardId: string;
    kind: 'board' | 'card';
    radius: number;
    x: number;
    y: number;
    anchor: Point;
}
export declare function graphRadius(node: MemoryGraphNode, size: number): number;
/** D3 owns only view particles, never the shared graph or saved board coordinates. */
export declare function graphSimulation(nodes: MemoryGraphNode[], edges: MemoryGraphEdge[], previous: Map<string, GraphParticle>, settings: {
    repel: number;
    distance: number;
    size: number;
}): import("d3-force").Simulation<GraphParticle, undefined>;
