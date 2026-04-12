export interface CanvasPlacementRect {
  position: { x: number; y: number };
  size: { width: number; height: number };
}

export function rectsOverlap(
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

export function overlapsAny(
  pos: { x: number; y: number },
  width: number,
  height: number,
  existing: CanvasPlacementRect[],
  gap: number,
): boolean {
  return existing.some((rect) => rectsOverlap(pos, width, height, rect, gap));
}

export function findBlocker(
  pos: { x: number; y: number },
  width: number,
  height: number,
  existing: CanvasPlacementRect[],
  gap: number,
): CanvasPlacementRect | undefined {
  return existing.find((rect) => rectsOverlap(pos, width, height, rect, gap));
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
