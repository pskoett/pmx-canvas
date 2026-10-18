import type { MemoryGraphNode } from '../../shared/memory-graph.js';

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
