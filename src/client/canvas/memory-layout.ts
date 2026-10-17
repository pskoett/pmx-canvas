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

export function graphRadius(node: MemoryGraphNode, size: number): number {
  return (node.kind === 'board' ? 16 + Math.sqrt(node.nodeCount ?? 0) * 0.5 : 4) * size;
}

export interface GraphLayout {
  positions: Map<string, Point>;
  cells: Map<string, { folder: string; x: number; y: number; height: number; cards: string[] }>;
  regions: MemoryRegion[];
}

/** Reserve card slots before expansion. Refreshes append, never repack existing boards. */
export function graphLayout(nodes: MemoryGraphNode[], previous?: GraphLayout): GraphLayout {
  const positions = new Map(previous?.positions);
  const cells: GraphLayout['cells'] = new Map();
  for (const [id, cell] of previous?.cells ?? []) cells.set(id, { ...cell, cards: [...cell.cards] });
  const boards = nodes.filter((node) => node.kind === 'board');
  const roots = [...new Set(boards.map((node) => node.folder?.split('/')[0] ?? ''))].sort();
  let rootX = 32;
  let rootY = 32;
  let rowHeight = 0;
  let appendX = previous?.regions.length
    ? Math.max(...previous.regions.map((region) => region.x + region.width)) + 96
    : 32;
  for (const root of roots) {
    const oldRegion = previous?.regions.find((region) => region.path === root);
    if (oldRegion) {
      rootX = oldRegion.x;
      rootY = oldRegion.y;
    } else if (previous?.regions.length) {
      rootX = appendX;
      rootY = 32;
    } else if (rootX > 1200) {
      rootX = 32;
      rootY += rowHeight + 64;
      rowHeight = 0;
    }
    const members = boards.filter((node) => (node.folder?.split('/')[0] ?? '') === root);
    const paths = [...new Set(members.map((node) => node.folder ?? ''))].sort();
    let y = rootY + 64;
    for (const path of paths) {
      const group = members
        .filter((node) => (node.folder ?? '') === path)
        .sort((a, b) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
      const height = Math.max(360, ...group.map((node) => Math.ceil((node.nodeCount ?? 0) / 2) * 110 + 160));
      const columns = Math.min(2, group.length);
      const existing = [...cells.values()].filter((cell) => cell.folder === path);
      let appendedY = existing.length ? Math.max(...existing.map((cell) => cell.y + cell.height)) + 24 : y;
      group.forEach((board, index) => {
        const old = cells.get(board.boardId);
        if (old?.folder === path) return;
        const x = rootX + 40 + (previous ? 0 : index % columns) * 360;
        const top = previous ? appendedY : y + Math.floor(index / columns) * height;
        cells.set(board.boardId, { x, y: top, height, folder: path, cards: old?.cards ?? [] });
        positions.set(board.key, { x: x + 180, y: top + 150 });
        if (old) for (const key of old.cards) positions.delete(key);
        if (previous) appendedY += height + 24;
      });
      y += Math.ceil(group.length / columns) * height + 48;
    }
    const height = y - rootY;
    rowHeight = Math.max(rowHeight, height);
    rootX += Math.min(2, members.length) * 360 + 128;
    appendX = Math.max(appendX, rootX);
  }
  for (const node of nodes.filter((entry) => entry.kind === 'card').sort((a, b) => a.key.localeCompare(b.key))) {
    const cell = cells.get(node.boardId);
    if (!cell) continue;
    let index = cell.cards.indexOf(node.key);
    if (index < 0) {
      index = cell.cards.length;
      cell.cards.push(node.key);
    }
    if (!positions.has(node.key)) {
      positions.set(node.key, {
        x: cell.x + 180 + (index % 2 ? 95 : -95),
        y: cell.y + 150 + (index < 2 ? -90 : Math.floor(index / 2) * 110),
      });
    }
  }
  // Growth compacts only the owning board's card slots, never a neighboring hub.
  for (const cell of cells.values()) {
    const rows = Math.ceil(cell.cards.length / 2);
    if (rows * 110 + 160 <= cell.height) continue;
    const spacing = (cell.height - 230) / Math.max(1, rows - 1);
    cell.cards.forEach((key, index) => {
      positions.set(key, {
        x: cell.x + 180 + (index % 2 ? 95 : -95),
        y: cell.y + (index < 2 ? 60 : 190 + Math.floor(index / 2) * spacing),
      });
    });
  }
  const regions: MemoryRegion[] = [];
  const paths = new Set<string>();
  for (const board of boards) {
    const parts = (board.folder ?? '').split('/');
    parts.forEach((_, index) => {
      paths.add(parts.slice(0, index + 1).join('/'));
    });
  }
  for (const path of [...paths].sort()) {
    const members = boards.filter(
      (node) => (node.folder ?? '') === path || (!!path && node.folder?.startsWith(`${path}/`)),
    );
    const boxes = members.flatMap((node) => {
      const cell = cells.get(node.boardId);
      return cell ? [cell] : [];
    });
    const depth = path ? path.split('/').length - 1 : 0;
    const nesting = Math.max(0, ...members.map((node) => (node.folder?.split('/').length ?? 1) - 1 - depth));
    const x = Math.min(...boxes.map((cell) => cell.x)) - 32 - nesting * 24;
    const y = Math.min(...boxes.map((cell) => cell.y)) - 48 - nesting * 32;
    regions.push({
      path,
      x,
      y,
      width: Math.max(...boxes.map((cell) => cell.x + 360)) - x + 32 + nesting * 24,
      height: Math.max(...boxes.map((cell) => cell.y + cell.height)) - y + 24 + nesting * 24,
      count: members.length,
      depth,
      collapsed: false,
    });
  }
  return { positions, cells, regions };
}
