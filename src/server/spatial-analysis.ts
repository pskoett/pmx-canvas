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

// ── Types ────────────────────────────────────────────────────────────

export interface SpatialCluster {
  /** Auto-generated cluster ID */
  id: string;
  /** Node IDs in this cluster */
  nodeIds: string[];
  /** Human-readable label derived from node titles/types */
  label: string;
  /** Centroid of the cluster */
  centroid: { x: number; y: number };
  /** Bounding box of all nodes in the cluster */
  bounds: { x: number; y: number; width: number; height: number };
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

// ── Helpers ──────────────────────────────────────────────────────────

/** Euclidean distance between two node centers */
function centerDistance(a: CanvasNodeState, b: CanvasNodeState): number {
  const ax = a.position.x + a.size.width / 2;
  const ay = a.position.y + a.size.height / 2;
  const bx = b.position.x + b.size.width / 2;
  const by = b.position.y + b.size.height / 2;
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

/** Gap distance — how far apart two nodes are edge-to-edge (0 if overlapping) */
function gapDistance(a: CanvasNodeState, b: CanvasNodeState): number {
  const aRight = a.position.x + a.size.width;
  const aBottom = a.position.y + a.size.height;
  const bRight = b.position.x + b.size.width;
  const bBottom = b.position.y + b.size.height;

  const gapX = Math.max(0, Math.max(a.position.x, b.position.x) - Math.min(aRight, bRight));
  const gapY = Math.max(0, Math.max(a.position.y, b.position.y) - Math.min(aBottom, bBottom));

  return Math.sqrt(gapX ** 2 + gapY ** 2);
}

/** Reading-order sort: top-to-bottom, then left-to-right (with row tolerance) */
function readingOrderSort(nodes: CanvasNodeState[]): CanvasNodeState[] {
  const sorted = [...nodes];
  // Row tolerance: nodes within 100px vertical are considered the same row
  const ROW_TOLERANCE = 100;
  sorted.sort((a, b) => {
    const rowA = Math.floor(a.position.y / ROW_TOLERANCE);
    const rowB = Math.floor(b.position.y / ROW_TOLERANCE);
    if (rowA !== rowB) return rowA - rowB;
    return a.position.x - b.position.x;
  });
  return sorted;
}

/** Derive a human-readable label for a cluster from its nodes */
function deriveClusterLabel(nodes: CanvasNodeState[]): string {
  // Use the first node with a title, or fall back to type summary
  const titled = nodes.find((n) => n.data.title && typeof n.data.title === 'string');
  if (titled && nodes.length <= 3) {
    const titles = nodes
      .filter((n) => n.data.title)
      .map((n) => n.data.title as string)
      .slice(0, 3);
    return titles.join(', ');
  }

  // Summarize by type counts
  const typeCounts: Record<string, number> = {};
  for (const n of nodes) {
    typeCounts[n.type] = (typeCounts[n.type] ?? 0) + 1;
  }
  const parts = Object.entries(typeCounts).map(([type, count]) =>
    count === 1 ? type : `${count} ${type}`,
  );

  if (titled) {
    return `${titled.data.title} + ${parts.join(', ')}`;
  }
  return parts.join(', ');
}

// ── Core Analysis ────────────────────────────────────────────────────

/**
 * Detect proximity clusters using single-linkage clustering.
 * Two nodes are "close" if their edge-to-edge gap is within the threshold.
 *
 * Default threshold: 200px (roughly "visually grouped" on a typical canvas).
 */
export function detectClusters(
  nodes: CanvasNodeState[],
  proximityThreshold = 200,
): SpatialCluster[] {
  if (nodes.length === 0) return [];

  // Union-Find for clustering
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    while (parent.get(id) !== id) {
      const p = parent.get(id)!;
      parent.set(id, parent.get(p)!); // path compression
      id = p;
    }
    return id;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  // Initialize each node as its own cluster
  for (const node of nodes) {
    parent.set(node.id, node.id);
  }

  // Compare all pairs (fine for canvas-scale node counts, typically < 200)
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (gapDistance(nodes[i], nodes[j]) <= proximityThreshold) {
        union(nodes[i].id, nodes[j].id);
      }
    }
  }

  // Group by root
  const groups = new Map<string, CanvasNodeState[]>();
  for (const node of nodes) {
    const root = find(node.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(node);
  }

  // Build cluster objects (only clusters with 2+ nodes are interesting)
  const clusters: SpatialCluster[] = [];
  let clusterIdx = 0;
  for (const [, members] of groups) {
    if (members.length < 2) continue;

    const xs = members.map((n) => n.position.x);
    const ys = members.map((n) => n.position.y);
    const rights = members.map((n) => n.position.x + n.size.width);
    const bottoms = members.map((n) => n.position.y + n.size.height);

    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxRight = Math.max(...rights);
    const maxBottom = Math.max(...bottoms);

    clusters.push({
      id: `cluster-${clusterIdx++}`,
      nodeIds: members.map((n) => n.id),
      label: deriveClusterLabel(members),
      centroid: {
        x: Math.round((minX + maxRight) / 2),
        y: Math.round((minY + maxBottom) / 2),
      },
      bounds: {
        x: minX,
        y: minY,
        width: maxRight - minX,
        height: maxBottom - minY,
      },
    });
  }

  // Sort clusters by reading order (top-left centroid first)
  clusters.sort((a, b) => {
    const rowA = Math.floor(a.centroid.y / 200);
    const rowB = Math.floor(b.centroid.y / 200);
    if (rowA !== rowB) return rowA - rowB;
    return a.centroid.x - b.centroid.x;
  });

  return clusters;
}

/**
 * Find the nearest unpinned nodes to each pinned node.
 */
export function findNeighborhoods(
  nodes: CanvasNodeState[],
  pinnedIds: Set<string>,
  maxNeighbors = 5,
  maxDistance = 600,
): SpatialContext['pinnedNeighborhoods'] {
  const pinned = nodes.filter((n) => pinnedIds.has(n.id));
  const unpinned = nodes.filter((n) => !pinnedIds.has(n.id));

  return pinned.map((pin) => {
    const withDist = unpinned
      .map((n) => ({ node: n, distance: centerDistance(pin, n) }))
      .filter((d) => d.distance <= maxDistance)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, maxNeighbors);

    return {
      pinnedNodeId: pin.id,
      pinnedNodeTitle: (pin.data.title as string) ?? null,
      neighbors: withDist.map((d) => ({
        id: d.node.id,
        type: d.node.type,
        title: (d.node.data.title as string) ?? null,
        distance: Math.round(d.distance),
      })),
    };
  });
}

/**
 * Full-text search across node titles and content.
 * Returns matching nodes with relevance score.
 */
export function searchNodes(
  nodes: CanvasNodeState[],
  query: string,
): { id: string; type: string; title: string | null; snippet: string; score: number }[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const terms = q.split(/\s+/);
  const results: { id: string; type: string; title: string | null; snippet: string; score: number }[] = [];

  for (const node of nodes) {
    const title = ((node.data.title as string) ?? '').toLowerCase();
    const content = ((node.data.content as string) ?? (node.data.fileContent as string) ?? '').toLowerCase();
    const path = ((node.data.path as string) ?? '').toLowerCase();

    let score = 0;
    for (const term of terms) {
      // Title matches are worth more
      if (title.includes(term)) score += 3;
      if (path.includes(term)) score += 2;
      if (content.includes(term)) score += 1;
    }

    if (score === 0) continue;

    // Extract a snippet around the first match in content
    let snippet = '';
    const fullContent = (node.data.content as string) ?? (node.data.fileContent as string) ?? '';
    const matchIdx = fullContent.toLowerCase().indexOf(terms[0]);
    if (matchIdx >= 0) {
      const start = Math.max(0, matchIdx - 40);
      const end = Math.min(fullContent.length, matchIdx + 80);
      snippet = (start > 0 ? '...' : '') +
        fullContent.slice(start, end).replace(/\n/g, ' ') +
        (end < fullContent.length ? '...' : '');
    } else if (title) {
      snippet = (node.data.title as string) ?? '';
    }

    results.push({
      id: node.id,
      type: node.type,
      title: (node.data.title as string) ?? null,
      snippet,
      score,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

/**
 * Build the complete spatial context for the canvas.
 */
export function buildSpatialContext(
  nodes: CanvasNodeState[],
  edges: CanvasEdge[],
  pinnedIds: Set<string>,
): SpatialContext {
  const clusters = detectClusters(nodes);

  // Build a lookup: nodeId → clusterId
  const nodeToCluster = new Map<string, string>();
  for (const cluster of clusters) {
    for (const nid of cluster.nodeIds) {
      nodeToCluster.set(nid, cluster.id);
    }
  }

  const ordered = readingOrderSort(nodes);

  const nodesInReadingOrder: NodeSpatialInfo[] = ordered.map((n, i) => ({
    id: n.id,
    type: n.type,
    title: (n.data.title as string) ?? null,
    content: (n.data.content as string) ?? null,
    clusterId: nodeToCluster.get(n.id) ?? null,
    readingOrder: i,
  }));

  const pinnedNeighborhoods = findNeighborhoods(nodes, pinnedIds);

  return {
    totalNodes: nodes.length,
    clusters,
    nodesInReadingOrder,
    pinnedNeighborhoods,
  };
}
