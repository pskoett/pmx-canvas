import { type MemoryGraph, type MemoryGraphEdge } from '../shared/memory-graph.js';
/** One library projection for Home, backlinks, brief discovery and agent exploration. No writes. */
export declare function memoryGraph(projection?: 'full' | 'boards'): MemoryGraph;
/** Keep original qualified endpoints and missing evidence, without card summaries or membership. */
export declare function boardMemoryGraph(graph: MemoryGraph): MemoryGraph;
/** Board-level connections are a collapse of the SAME edges, not another link scanner. */
export declare function boardConnections(graph: MemoryGraph): MemoryGraphEdge[];
/** Undirected exploration. Membership is a hop too; focus accepts a board ID, qualified key, or pins. */
export declare function localMemoryGraph(graph: MemoryGraph, focus: string | null, depth: number): MemoryGraph;
