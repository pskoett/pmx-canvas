import type { MemoryGraphEdge, MemoryGraphNode } from '../../shared/memory-graph.js';
import { GRAPH_NODE } from './graph-geometry';
import type { Point } from './memory-layout';

export type GraphScene =
  | { kind: 'overview' }
  | { kind: 'board'; boardId: string }
  | { kind: 'card'; boardId: string; cardId: string };
export const graphSceneKey = (scene: GraphScene) => (scene.kind === 'overview' ? 'overview' : JSON.stringify(scene));
export const pairKey = (a: string, b: string) => JSON.stringify([a, b].sort());

/** Partition original facts once; grouping never changes authored endpoints. */
export function graphEvidence(edges: MemoryGraphEdge[]) {
  const pairs = new Map<string, { boardId: string; peerId: string; edges: MemoryGraphEdge[] }>();
  const internal = new Map<string, number>();
  const missing: MemoryGraphEdge[] = [];
  const evidence = edges.filter((edge) => edge.kind !== 'member');
  for (const edge of evidence) {
    if (edge.missing) {
      missing.push(edge);
      continue;
    }
    if (edge.source.boardId === edge.target.boardId) {
      internal.set(edge.source.boardId, (internal.get(edge.source.boardId) ?? 0) + 1);
      continue;
    }
    const key = pairKey(edge.source.boardId, edge.target.boardId);
    const pair = pairs.get(key);
    if (pair) pair.edges.push(edge);
    else pairs.set(key, { boardId: edge.source.boardId, peerId: edge.target.boardId, edges: [edge] });
  }
  return { evidence, pairs, internal, missing };
}

/** Stable seed, independent of traversal order and the host's random source. */
function seed(key: string) {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return (hash >>> 0) / 4294967296;
}

function graphAdjacency(keys: string[], edges: ReadonlyArray<{ from: string; to: string; weight?: number }>) {
  const adjacency = new Map(keys.map((key) => [key, new Map<string, number>()]));
  // Sort before summing parallel facts so floating-point sums are order-independent too.
  const links = edges
    .filter((edge) => edge.from !== edge.to && adjacency.has(edge.from) && adjacency.has(edge.to))
    .map((edge) => ({ ends: [edge.from, edge.to].sort(), weight: Math.max(0.1, edge.weight ?? 1) }))
    .sort((a, b) => a.ends[0].localeCompare(b.ends[0]) || a.ends[1].localeCompare(b.ends[1]) || a.weight - b.weight);
  for (const {
    ends: [a, b],
    weight,
  } of links) {
    adjacency.get(a)!.set(b, (adjacency.get(a)!.get(b) ?? 0) + weight);
    adjacency.get(b)!.set(a, (adjacency.get(b)!.get(a) ?? 0) + weight);
  }
  return adjacency;
}

/** Shared forces for the initial solve and interaction, in footprint-normalized coordinates. */
function graphForce(key: string, positions: Map<string, Point>, keys: string[], neighbors: Map<string, number>) {
  const point = positions.get(key)!;
  // Share a gentle pull across links instead of multiplying it by a node's degree.
  const totalWeight = [...neighbors.values()].reduce((sum, weight) => sum + Math.sqrt(weight), 0);
  let fx = 0,
    fy = 0;
  for (const other of keys) {
    if (other === key) continue;
    const peer = positions.get(other)!;
    const dx = point.x - peer.x || (seed(key) - 0.5) * 0.01;
    const dy = point.y - peer.y || (seed(`${key}:y`) - 0.5) * 0.01;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const repulsion = 14000 / (distance * distance);
    const weight = neighbors.get(other) ?? 0;
    const attraction = weight ? ((distance - 290) * 0.006 * Math.sqrt(weight)) / totalWeight : 0;
    fx += (dx / distance) * (repulsion - attraction);
    fy += (dy / distance) * (repulsion - attraction);
    const width = GRAPH_NODE.width + GRAPH_NODE.gap;
    const height = ((GRAPH_NODE.height + GRAPH_NODE.gap) * GRAPH_NODE.width) / GRAPH_NODE.height;
    if (Math.abs(dx) < width && Math.abs(dy) < height) {
      if (width - Math.abs(dx) < height - Math.abs(dy)) fx += Math.sign(dx) * (width - Math.abs(dx)) * 0.2;
      else fy += Math.sign(dy) * (height - Math.abs(dy)) * 0.2;
    }
  }
  return { x: fx, y: fy };
}

/** One animation step. The pointer/drop anchor stays fixed while its visible neighbors respond. */
export function relaxGraphPositions(
  positions: Map<string, Point>,
  edges: ReadonlyArray<{ from: string; to: string; weight?: number }>,
  held: string,
  cooling: number,
) {
  const keys = [...positions.keys()].sort();
  const adjacency = graphAdjacency(keys, edges);
  const aspect = GRAPH_NODE.width / GRAPH_NODE.height;
  const normalized = new Map([...positions].map(([key, point]) => [key, { x: point.x, y: point.y * aspect }]));
  let movement = 0;
  for (const key of keys) {
    if (key === held) continue;
    const point = normalized.get(key)!;
    const force = graphForce(key, normalized, keys, adjacency.get(key)!);
    const step = Math.min(1, 24 / Math.max(1, Math.hypot(force.x, force.y))) * cooling;
    const dx = force.x * step,
      dy = (force.y * step) / aspect;
    positions.set(key, { x: point.x + dx, y: point.y / aspect + dy });
    movement = Math.max(movement, Math.hypot(dx, dy));
  }
  // Resolve rectangular collisions, rather than letting springs seal a node's connection ports.
  for (const [index, key] of keys.entries())
    for (const other of keys.slice(index + 1)) {
      const point = positions.get(key)!,
        peer = positions.get(other)!;
      const dx = point.x - peer.x,
        dy = point.y - peer.y;
      const width = GRAPH_NODE.width + GRAPH_NODE.gap - Math.abs(dx),
        height = GRAPH_NODE.height + GRAPH_NODE.gap - Math.abs(dy);
      if (width <= 0 || height <= 0) continue;
      const push =
        width < height ? { x: (Math.sign(dx) || -1) * width, y: 0 } : { x: 0, y: (Math.sign(dy) || -1) * height };
      const a = other === held ? 1 : 0.5,
        b = key === held ? 1 : 0.5;
      if (key !== held) positions.set(key, { x: point.x + push.x * a, y: point.y + push.y * a });
      if (other !== held) positions.set(other, { x: peer.x - push.x * b, y: peer.y - push.y * b });
      movement = Math.max(movement, Math.hypot(push.x, push.y));
    }
  return movement;
}

/** Deterministic initial placement; live additions preserve retained coordinates. */
export function graphPositions(
  nodes: MemoryGraphNode[],
  edges: ReadonlyArray<{ from: string; to: string; weight?: number }>,
  retained: Map<string, Point>,
): Map<string, Point> {
  const keys = [...new Set(nodes.map((node) => node.key))].sort();
  if (keys.every((key) => retained.has(key))) return new Map(keys.map((key) => [key, retained.get(key)!]));
  const adjacency = graphAdjacency(keys, edges);
  const components: string[][] = [];
  const visited = new Set<string>();
  for (const key of keys) {
    if (visited.has(key)) continue;
    const component = [key];
    visited.add(key);
    for (const member of component) {
      for (const neighbor of adjacency.get(member)!.keys()) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        component.push(neighbor);
      }
    }
    components.push(component.sort());
  }
  const positions = new Map<string, Point>();
  // Solve in footprint-normalized coordinates, then return screen-shaped rectangles.
  const aspect = GRAPH_NODE.width / GRAPH_NODE.height;
  for (const key of keys) {
    const anchor = retained.get(key);
    if (anchor) positions.set(key, { x: anchor.x, y: anchor.y * aspect });
  }
  for (const component of components) {
    // Grow from anchors (or one seeded root), placing each newcomer near real neighbors.
    if (!component.some((key) => positions.has(key))) positions.set(component[0], { x: 0, y: 0 });
    while (component.some((key) => !positions.has(key))) {
      for (const key of component) {
        if (positions.has(key)) continue;
        const neighbors = [...adjacency.get(key)!.keys()].filter((neighbor) => positions.has(neighbor));
        if (!neighbors.length) continue;
        positions.set(key, {
          x:
            neighbors.reduce((sum, neighbor) => sum + positions.get(neighbor)!.x, 0) / neighbors.length +
            (seed(key) - 0.5) * 240,
          y:
            neighbors.reduce((sum, neighbor) => sum + positions.get(neighbor)!.y, 0) / neighbors.length +
            (seed(`${key}:y`) - 0.5) * 240,
        });
      }
    }
    for (let iteration = 0; iteration < 180; iteration++) {
      const updates = new Map<string, Point>();
      for (const key of component) {
        if (retained.has(key)) continue;
        const point = positions.get(key)!;
        const { x: fx, y: fy } = graphForce(key, positions, component, adjacency.get(key)!);
        const step = Math.min(1, 24 / Math.max(1, Math.hypot(fx, fy))) * (1 - iteration / 200);
        updates.set(key, { x: point.x + fx * step, y: point.y + fy * step });
      }
      for (const [key, point] of updates) positions.set(key, point);
    }
  }
  for (const [key, point] of positions) positions.set(key, retained.get(key) ?? { x: point.x, y: point.y / aspect });
  // Exact footprint clearance after cooling. Anchors always win, even across components.
  const occupied = keys.filter((key) => retained.has(key)).map((key) => positions.get(key)!);
  const width = GRAPH_NODE.width + GRAPH_NODE.gap,
    height = GRAPH_NODE.height + GRAPH_NODE.gap;
  const overlaps = (a: Point, b: Point) => Math.abs(a.x - b.x) < width && Math.abs(a.y - b.y) < height;
  let packLeft = 0,
    packX = 0;
  let packY = 0,
    rowHeight = 0;
  const rowWidth = Math.sqrt(keys.length) * 380;
  const anchoredComponent = (component: string[]) => component.some((key) => retained.has(key));
  components.sort((a, b) => Number(anchoredComponent(b)) - Number(anchoredComponent(a)));
  let packing = false;
  for (const component of components) {
    const anchored = anchoredComponent(component);
    if (!anchored && !packing) {
      packLeft = occupied.length ? Math.max(...occupied.map((point) => point.x)) + 340 : 0;
      packX = packLeft;
      packing = true;
    }
    const obstacles = anchored ? occupied : [];
    const placed: Point[] = [];
    for (const key of component) {
      if (retained.has(key)) continue;
      const desired = positions.get(key)!;
      let point = desired;
      if (obstacles.some((peer) => overlaps(point, peer))) {
        const candidates = obstacles.flatMap((peer) => [
          { x: peer.x - width, y: desired.y },
          { x: peer.x + width, y: desired.y },
          { x: desired.x, y: peer.y - height },
          { x: desired.x, y: peer.y + height },
        ]);
        point = candidates
          .filter((candidate) => !obstacles.some((peer) => overlaps(candidate, peer)))
          .sort(
            (a, b) => Math.hypot(a.x - desired.x, a.y - desired.y) - Math.hypot(b.x - desired.x, b.y - desired.y),
          )[0];
      }
      positions.set(key, point);
      obstacles.push(point);
      placed.push(point);
    }
    if (!anchored && placed.length) {
      const left = Math.min(...placed.map((point) => point.x));
      const top = Math.min(...placed.map((point) => point.y));
      for (const point of placed) {
        point.x += packX - left;
        point.y += packY - top;
      }
      occupied.push(...placed);
      packX = Math.max(...placed.map((point) => point.x)) + 340;
      rowHeight = Math.max(rowHeight, Math.max(...placed.map((point) => point.y)) - packY + 200);
      if (packX - packLeft > rowWidth) {
        packX = packLeft;
        packY += rowHeight;
        rowHeight = 0;
      }
    }
  }
  for (const [key, point] of positions) if (!retained.has(key)) retained.set(key, point);
  return positions;
}
