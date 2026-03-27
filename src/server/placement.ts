export interface CanvasPlacementRect {
  position: { x: number; y: number };
  size: { width: number; height: number };
}

function rectsOverlap(
  a: { x: number; y: number },
  aw: number,
  ah: number,
  b: CanvasPlacementRect,
  gap: number,
): boolean {
  return (
    a.x < b.position.x + b.size.width + gap &&
    a.x + aw + gap > b.position.x &&
    a.y < b.position.y + b.size.height + gap &&
    a.y + ah + gap > b.position.y
  );
}

function overlapsAny(
  pos: { x: number; y: number },
  width: number,
  height: number,
  existing: CanvasPlacementRect[],
  gap: number,
): boolean {
  return existing.some((rect) => rectsOverlap(pos, width, height, rect, gap));
}

function findBlocker(
  pos: { x: number; y: number },
  width: number,
  height: number,
  existing: CanvasPlacementRect[],
  gap: number,
): CanvasPlacementRect | undefined {
  return existing.find((rect) => rectsOverlap(pos, width, height, rect, gap));
}

const GROUP_PAD = 40;
const GROUP_TITLEBAR_HEIGHT = 32;

/**
 * Compute bounding box for a group that should contain the given child rects.
 * Returns position and size with padding, or null if no valid children.
 */
export function computeGroupBounds(
  children: CanvasPlacementRect[],
  defaultWidth = 600,
  defaultHeight = 400,
): { x: number; y: number; width: number; height: number } | null {
  if (children.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const child of children) {
    minX = Math.min(minX, child.position.x);
    minY = Math.min(minY, child.position.y);
    maxX = Math.max(maxX, child.position.x + child.size.width);
    maxY = Math.max(maxY, child.position.y + child.size.height);
  }
  if (minX === Infinity) return null;

  return {
    x: minX - GROUP_PAD,
    y: minY - GROUP_PAD - GROUP_TITLEBAR_HEIGHT,
    width: maxX - minX + GROUP_PAD * 2,
    height: maxY - minY + GROUP_PAD * 2 + GROUP_TITLEBAR_HEIGHT,
  };
}

export function findOpenCanvasPosition(
  existing: CanvasPlacementRect[],
  width: number,
  height: number,
  gap = 24,
): { x: number; y: number } {
  if (existing.length === 0) return { x: 40, y: 80 };

  const last = existing[existing.length - 1];
  const candidate = {
    x: last.position.x + last.size.width + gap,
    y: last.position.y,
  };
  if (!overlapsAny(candidate, width, height, existing, gap)) return candidate;

  const startX = 40;
  const startY = 80;
  const maxX = 3000;
  let y = startY;

  for (let row = 0; row < 20; row++) {
    let x = startX;
    while (x + width < maxX) {
      const blocker = findBlocker({ x, y }, width, height, existing, gap);
      if (!blocker) return { x, y };
      x = blocker.position.x + blocker.size.width + gap;
    }

    const rowNodes = existing.filter(
      (node) => node.position.y <= y + height + gap && node.position.y + node.size.height + gap > y,
    );
    const maxBottom = rowNodes.reduce(
      (max, node) => Math.max(max, node.position.y + node.size.height),
      y,
    );
    y = maxBottom + gap;
  }

  const maxY = existing.reduce((max, node) => Math.max(max, node.position.y + node.size.height), 0);
  return { x: startX, y: maxY + gap };
}
