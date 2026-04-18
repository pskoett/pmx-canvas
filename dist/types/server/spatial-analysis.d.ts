/**
 * Spatial Semantics Layer for PMX Canvas
 *
 * Analyzes the spatial arrangement of nodes on the canvas to extract
 * meaningful relationships: proximity clusters, reading order, and
 * neighborhood context around pinned nodes.
 *
 * This makes the canvas promise — "spatial arrangement is communication" —
 * actually real for agents. Instead of raw x/y coordinates, agents get
 * semantic clusters, ordered context, and implicit human intent.
 */
import type { CanvasNodeState, CanvasEdge } from './canvas-state.js';
export interface SpatialCluster {
    /** Auto-generated cluster ID */
    id: string;
    /** Node IDs in this cluster */
    nodeIds: string[];
    /** Human-readable label derived from node titles/types */
    label: string;
    /** Centroid of the cluster */
    centroid: {
        x: number;
        y: number;
    };
    /** Bounding box of all nodes in the cluster */
    bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}
export interface SpatialNeighbor {
    id: string;
    type: string;
    title: string | null;
    distance: number;
}
export interface NodeSpatialInfo {
    id: string;
    type: string;
    title: string | null;
    content: string | null;
    clusterId: string | null;
    /** Reading order index (top-left to bottom-right) */
    readingOrder: number;
}
export interface SpatialContext {
    /** Total nodes on canvas */
    totalNodes: number;
    /** Detected proximity clusters */
    clusters: SpatialCluster[];
    /** All nodes in spatial reading order (top-left to bottom-right) */
    nodesInReadingOrder: NodeSpatialInfo[];
    /** For each pinned node, nearby unpinned nodes (the implicit context) */
    pinnedNeighborhoods: {
        pinnedNodeId: string;
        pinnedNodeTitle: string | null;
        neighbors: SpatialNeighbor[];
    }[];
}
/**
 * Detect proximity clusters using single-linkage clustering.
 * Two nodes are "close" if their edge-to-edge gap is within the threshold.
 *
 * Default threshold: 200px (roughly "visually grouped" on a typical canvas).
 */
export declare function detectClusters(nodes: CanvasNodeState[], proximityThreshold?: number): SpatialCluster[];
/**
 * Find the nearest unpinned nodes to each pinned node.
 */
export declare function findNeighborhoods(nodes: CanvasNodeState[], pinnedIds: Set<string>, maxNeighbors?: number, maxDistance?: number): SpatialContext['pinnedNeighborhoods'];
/**
 * Full-text search across node titles and content.
 * Returns matching nodes with relevance score.
 */
export declare function searchNodes(nodes: CanvasNodeState[], query: string): {
    id: string;
    type: string;
    title: string | null;
    snippet: string;
    score: number;
}[];
/**
 * Build the complete spatial context for the canvas.
 */
export declare function buildSpatialContext(nodes: CanvasNodeState[], _edges: CanvasEdge[], pinnedIds: Set<string>): SpatialContext;
