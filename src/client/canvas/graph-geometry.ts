import type { Point } from './memory-layout';

/** Painted bounds, collision clearance, ports and Fit share this footprint. */
export const GRAPH_NODE = { width: 220, height: 96, gap: 64 };
interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface GraphRoute {
  path: string;
  points: Point[];
  label?: Point & Rect;
}
interface Link {
  id: string;
  from: string;
  to: string;
  label: string;
}
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const inside = (point: Point, r: Rect) =>
  point.x > r.left && point.x < r.right && point.y > r.top && point.y < r.bottom;

/** Open-interior intersection: following a rectangle boundary is permitted. */
function crosses(a: Point, b: Point, r: Rect) {
  let low = 0,
    high = 1;
  for (const [start, delta, min, max] of [
    [a.x, b.x - a.x, r.left, r.right],
    [a.y, b.y - a.y, r.top, r.bottom],
  ]) {
    if (!delta) {
      if (start <= min || start >= max) return false;
    } else {
      const p = (min - start) / delta,
        q = (max - start) / delta;
      low = Math.max(low, Math.min(p, q));
      high = Math.min(high, Math.max(p, q));
    }
  }
  return low < high && high > 0 && low < 1;
}

/** Obstacle visibility is shared across routes and independent of zoom/hover. */
export function graphRoutes(positions: Map<string, Point>, links: Link[]) {
  // Keep route clearance inside the larger node-spacing gap.
  const clearance = 8;
  const boxes = [...positions].map(([key, p]) => ({
    key,
    left: p.x - GRAPH_NODE.width / 2 - clearance,
    right: p.x + GRAPH_NODE.width / 2 + clearance,
    top: p.y - GRAPH_NODE.height / 2 - clearance,
    bottom: p.y + GRAPH_NODE.height / 2 + clearance,
  }));
  const clear = (a: Point, b: Point) => !boxes.some((r) => crosses(a, b, r));
  const corners = boxes
    .flatMap((r) => [
      { x: r.left, y: r.top },
      { x: r.right, y: r.top },
      { x: r.right, y: r.bottom },
      { x: r.left, y: r.bottom },
    ])
    .filter((p) => !boxes.some((r) => inside(p, r)));
  const neighbors = new Map<number, Array<{ index: number; length: number }>>();
  const ports = (p: Point, fraction: number) =>
    [
      { x: p.x - GRAPH_NODE.width / 2, y: p.y + fraction * GRAPH_NODE.height },
      { x: p.x + GRAPH_NODE.width / 2, y: p.y + fraction * GRAPH_NODE.height },
      { x: p.x + fraction * GRAPH_NODE.width, y: p.y - GRAPH_NODE.height / 2 },
      { x: p.x + fraction * GRAPH_NODE.width, y: p.y + GRAPH_NODE.height / 2 },
    ].map((port, index) => ({
      port,
      stub: {
        x: port.x + (index === 0 ? -clearance : index === 1 ? clearance : 0),
        y: port.y + (index === 2 ? -clearance : index === 3 ? clearance : 0),
      },
    }));
  const result = new Map<string, GraphRoute>();
  const labels: Rect[] = [];
  const lanes = new Map<string, number>();
  const pairs = new Map<string, number>();
  for (const link of links) {
    const pair = JSON.stringify([link.from, link.to].sort());
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
  }
  for (const link of links) {
    const a = positions.get(link.from)!,
      b = positions.get(link.to)!;
    const pair = JSON.stringify([link.from, link.to].sort());
    const lane = lanes.get(pair) ?? 0;
    lanes.set(pair, lane + 1);
    // Distinct boundary ports keep every reciprocal/parallel fact selectable.
    const fraction = ((lane + 1) / (pairs.get(pair)! + 1) - 0.5) * 0.8;
    const starts = ports(a, fraction),
      ends = ports(b, fraction);
    let points: Point[] | undefined;
    let best = Infinity;
    for (const s of starts)
      for (const t of ends) {
        const length = distance(s.stub, t.stub);
        if (length && length < best && clear(s.stub, t.stub)) {
          best = length;
          points = [s.port, s.stub, t.stub, t.port];
        }
      }
    if (!points) {
      const distances = corners.map(() => Infinity),
        previous = corners.map(() => -1);
      const origins = corners.map(() => 0),
        visited = new Set<number>();
      for (let i = 0; i < corners.length; i++)
        for (let s = 0; s < starts.length; s++) {
          const length = distance(starts[s].stub, corners[i]);
          if (length < distances[i] && clear(starts[s].stub, corners[i])) {
            distances[i] = length;
            origins[i] = s;
          }
        }
      let finish = -1,
        endPort = 0;
      while (visited.size < corners.length) {
        let current = -1;
        for (let i = 0; i < corners.length; i++)
          if (!visited.has(i) && (current < 0 || distances[i] < distances[current])) current = i;
        if (current < 0 || distances[current] >= best || !Number.isFinite(distances[current])) break;
        visited.add(current);
        for (let t = 0; t < ends.length; t++) {
          const length = distances[current] + distance(corners[current], ends[t].stub);
          if (length < best && clear(corners[current], ends[t].stub)) {
            best = length;
            finish = current;
            endPort = t;
          }
        }
        let peers = neighbors.get(current);
        if (!peers) {
          peers = corners.flatMap((point, index) =>
            index !== current && clear(corners[current], point)
              ? [{ index, length: distance(corners[current], point) }]
              : [],
          );
          neighbors.set(current, peers);
        }
        for (const peer of peers)
          if (distances[current] + peer.length < distances[peer.index]) {
            distances[peer.index] = distances[current] + peer.length;
            previous[peer.index] = current;
            origins[peer.index] = origins[current];
          }
      }
      if (finish >= 0) {
        const path: Point[] = [];
        for (let at = finish; at >= 0; at = previous[at]) path.unshift(corners[at]);
        const s = starts[origins[finish]],
          t = ends[endPort];
        points = [s.port, s.stub, ...path, t.stub, t.port];
      }
    }
    if (!points) continue; // Only overlapping footprints can seal every boundary port.
    const half = Math.max(24, link.label.length * 3.6 + 6);
    const segments = points
      .slice(1)
      .map((point, index) => ({ first: points![index], point, length: distance(points![index], point) }))
      .filter((segment) => segment.length > 0)
      .sort((a, b) => b.length - a.length);
    let label: GraphRoute['label'];
    // Expand only as needed. Finite obstacles cannot hide a required label forever.
    for (let radius = 16; link.label && !label; radius += 20) {
      const candidates = segments.flatMap(({ first, point, length }) =>
        [0.5, 0.25, 0.75].flatMap((along) =>
          [-radius, radius].map((offset) => {
            const x = first.x + (point.x - first.x) * along - ((point.y - first.y) * offset) / length;
            const y = first.y + (point.y - first.y) * along + ((point.x - first.x) * offset) / length;
            return { x, y, left: x - half, right: x + half, top: y - 16, bottom: y + 8 };
          }),
        ),
      );
      label = candidates.find(
        (p) =>
          ![...boxes, ...labels].some(
            (r) => p.left < r.right && p.right > r.left && p.top < r.bottom && p.bottom > r.top,
          ),
      );
    }
    if (label) labels.push(label);
    result.set(link.id, {
      points,
      path: points.map((p, index) => `${index ? 'L' : 'M'} ${p.x} ${p.y}`).join(' '),
      label,
    });
  }
  return result;
}
