import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from 'd3-force';
import { memoryKey, type MemoryGraphEdge, type MemoryGraphNode } from '../../shared/memory-graph.js';

export type Point = { x: number; y: number };
export const MAP_CARD = { width: 220, height: 92 };
export interface MemoryRegion extends Point {
  path: string;
  width: number;
  height: number;
  count: number;
  depth: number;
  collapsed: boolean;
}

/** Folder membership determines regions; authored Map positions never change membership. */
export function mapLayout(nodes: MemoryGraphNode[], collapsed: Set<string>) {
  const boards = nodes.filter((node) => node.kind === 'board');
  const positions = new Map<string, Point>();
  const regions: MemoryRegion[] = [];
  const hidden = new Set<string>();
  const paths = new Set<string>();
  for (const board of boards) {
    const parts = (board.folder ?? '').split('/');
    parts.forEach((_, index) => {
      paths.add(parts.slice(0, index + 1).join('/'));
    });
  }
  const inside = (node: MemoryGraphNode, path: string) =>
    (node.folder ?? '') === path || (!!path && !!node.folder?.startsWith(`${path}/`));
  const measure = (path: string, x: number, y: number, depth: number): { width: number; height: number } => {
    const members = boards.filter((node) => inside(node, path));
    const folded = collapsed.has(path);
    const region: MemoryRegion = {
      path,
      x,
      y,
      width: 280,
      height: 72,
      count: members.length,
      depth,
      collapsed: folded,
    };
    regions.push(region);
    if (folded) {
      for (const node of members) hidden.add(node.key);
      return region;
    }
    const direct = members
      .filter((node) => (node.folder ?? '') === path)
      .sort((a, b) => a.title.localeCompare(b.title));
    const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(direct.length))));
    direct.forEach((node, index) => {
      const topLeft = node.position ?? {
        x: x + 24 + (index % columns) * (MAP_CARD.width + 28),
        y: y + 52 + Math.floor(index / columns) * (MAP_CARD.height + 28),
      };
      positions.set(node.key, { x: topLeft.x + MAP_CARD.width / 2, y: topLeft.y + MAP_CARD.height / 2 });
    });
    let nextY = y + 52 + Math.ceil(direct.length / columns) * (MAP_CARD.height + 28);
    let width = direct.length ? columns * (MAP_CARD.width + 28) + 20 : 280;
    const children = [...paths]
      .filter((item) => item && item.slice(0, item.lastIndexOf('/')) === path && item.includes('/'))
      .sort();
    let childX = 20,
      childHeight = 0;
    for (const child of children) {
      if (childX > 650) {
        childX = 20;
        nextY += childHeight + 24;
        childHeight = 0;
      }
      const size = measure(child, x + childX, nextY, depth + 1);
      childX += size.width + 24;
      childHeight = Math.max(childHeight, size.height);
      width = Math.max(width, childX);
    }
    nextY += childHeight + (children.length ? 20 : 0);
    region.width = width;
    region.height = Math.max(100, nextY - y + 4);
    // Include saved positions and nested regions without discarding a person's arrangement.
    const points = members.flatMap((node) => {
      const point = positions.get(node.key);
      return point ? [point] : [];
    });
    const right = Math.max(x + region.width, ...points.map((point) => point.x + MAP_CARD.width / 2 + 20));
    const bottom = Math.max(y + region.height, ...points.map((point) => point.y + MAP_CARD.height / 2 + 20));
    region.x = Math.min(x, ...points.map((point) => point.x - MAP_CARD.width / 2 - 20));
    region.y = Math.min(y, ...points.map((point) => point.y - MAP_CARD.height / 2 - 48));
    region.width = right - region.x;
    region.height = bottom - region.y;
    return region;
  };
  let x = 32,
    y = 32,
    rowHeight = 0;
  for (const path of [...paths].filter((path) => !path.includes('/')).sort()) {
    if (x > 1100) {
      x = 32;
      y += rowHeight + 36;
      rowHeight = 0;
    }
    const size = measure(path, x, y, 0);
    x += size.width + 36;
    rowHeight = Math.max(rowHeight, size.height);
  }
  return { positions, regions, hidden };
}

export interface GraphParticle extends SimulationNodeDatum {
  key: string;
  boardId: string;
  kind: 'board' | 'card';
  radius: number;
  x: number;
  y: number;
  anchor: Point;
}

export function graphRadius(node: MemoryGraphNode, size: number): number {
  return (node.kind === 'board' ? 7 + Math.sqrt(node.nodeCount ?? 0) * 1.6 : 3.2) * size;
}

/** D3 owns only view particles, never the shared graph or saved board coordinates. */
export function graphSimulation(
  nodes: MemoryGraphNode[],
  edges: MemoryGraphEdge[],
  previous: Map<string, GraphParticle>,
  settings: { repel: number; distance: number; size: number },
) {
  // A shallow card focus can omit board nodes but still contains multiple boards.
  const boards = [...new Map(nodes.map((node) => [node.boardId, node])).values()];
  const folders = [...new Set(nodes.map((node) => node.folder?.split('/')[0] ?? ''))].sort();
  const anchors = new Map<string, Point>();
  folders.forEach((folder, index) => {
    const group = boards.filter((node) => (node.folder?.split('/')[0] ?? '') === folder);
    const angle = (index * Math.PI * 2) / Math.max(1, folders.length);
    const center = {
      x: Math.cos(angle) * 200 * Math.sqrt(folders.length),
      y: Math.sin(angle) * 200 * Math.sqrt(folders.length),
    };
    group.forEach((board, i) => {
      const a = i * 2.399963229728653;
      const r = Math.sqrt(i) * 200;
      anchors.set(board.boardId, { x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r });
    });
  });
  const counts = new Map<string, number>();
  const particles = nodes.map((node): GraphParticle => {
    const old = previous.get(node.key);
    const anchor = anchors.get(node.boardId) ?? { x: 0, y: 0 };
    const i = counts.get(node.boardId) ?? 0;
    counts.set(node.boardId, i + 1);
    const radius = node.kind === 'board' ? 0 : 45 + Math.sqrt(i) * 9;
    return {
      key: node.key,
      boardId: node.boardId,
      kind: node.kind,
      anchor,
      radius: graphRadius(node, settings.size),
      x: old?.x ?? anchor.x + Math.cos(i * 2.399963229728653) * radius,
      y: old?.y ?? anchor.y + Math.sin(i * 2.399963229728653) * radius,
      ...(old?.fx != null ? { fx: old.fx, fy: old.fy } : {}),
    };
  });
  const keys = new Set(particles.map((node) => node.key));
  const seen = new Set<string>();
  const links: Array<{ source: string; target: string; member: boolean }> = [];
  for (const edge of edges) {
    if (edge.missing) continue;
    // Cross-board attraction is between clusters. Card-to-card springs across the
    // library would tear the clouds apart and make an overview unreadable.
    const source = edge.kind === 'member' ? edge.from : memoryKey({ boardId: edge.source.boardId });
    const target = edge.kind === 'member' ? edge.to : memoryKey({ boardId: edge.target.boardId });
    const key = JSON.stringify([source, target]);
    if (source === target || !keys.has(source) || !keys.has(target) || seen.has(key)) continue;
    seen.add(key);
    links.push({ source, target, member: edge.kind === 'member' });
  }
  return forceSimulation(particles)
    .alphaDecay(0.055)
    .velocityDecay(0.55)
    .force(
      'links',
      forceLink<GraphParticle, (typeof links)[number]>(links)
        .id((node) => node.key)
        .distance((edge) => (edge.member ? settings.distance * 0.28 : settings.distance * 2.2))
        .strength((edge) => (edge.member ? 0.35 : 0.035)),
    )
    .force(
      'repel',
      forceManyBody<GraphParticle>()
        .strength((node) => -(node.kind === 'board' ? 250 : 12) * settings.repel)
        .distanceMax(700),
    )
    .force(
      'collision',
      forceCollide<GraphParticle>((node) => node.radius + (node.kind === 'board' ? 25 : 4)).iterations(2),
    )
    .force(
      'folder-x',
      forceX<GraphParticle>((node) => node.anchor.x).strength((node) => (node.kind === 'board' ? 0.035 : 0.008)),
    )
    .force(
      'folder-y',
      forceY<GraphParticle>((node) => node.anchor.y).strength((node) => (node.kind === 'board' ? 0.035 : 0.008)),
    );
}
