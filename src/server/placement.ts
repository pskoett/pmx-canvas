import {
  findBlocker,
  findOpenCanvasPosition,
  overlapsAny,
  type CanvasPlacementRect,
} from '../shared/placement.js';

export { findOpenCanvasPosition, type CanvasPlacementRect } from '../shared/placement.js';

const GROUP_PAD = 40;
const GROUP_TITLEBAR_HEIGHT = 32;
const GROUP_LAYOUT_GAP_X = 32;
const GROUP_LAYOUT_GAP_Y = 32;
const GROUP_LAYOUT_MIN_ROW_WIDTH = 1200;
const GROUP_LAYOUT_MAX_ROW_WIDTH = 1800;
const GROUP_TO_GROUP_GAP = 48;

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

export function computePackedGroupLayout<T extends CanvasPlacementRect & { id: string }>(
  children: T[],
): {
  positions: Map<string, { x: number; y: number }>;
  bounds: { x: number; y: number; width: number; height: number } | null;
} {
  const positions = new Map<string, { x: number; y: number }>();
  if (children.length === 0) return { positions, bounds: null };

  const sorted = [...children].sort(
    (a, b) => a.position.y - b.position.y || a.position.x - b.position.x,
  );
  const totalArea = sorted.reduce((sum, child) => sum + child.size.width * child.size.height, 0);
  const widestChild = sorted.reduce((max, child) => Math.max(max, child.size.width), 0);
  const targetRowWidth = Math.max(
    widestChild,
    Math.min(
      GROUP_LAYOUT_MAX_ROW_WIDTH,
      Math.max(GROUP_LAYOUT_MIN_ROW_WIDTH, Math.ceil(Math.sqrt(totalArea))),
    ),
  );

  const startX = Math.min(...sorted.map((child) => child.position.x));
  const startY = Math.min(...sorted.map((child) => child.position.y));
  let cursorX = startX;
  let cursorY = startY;
  let rowHeight = 0;

  for (const child of sorted) {
    if (
      cursorX > startX &&
      cursorX + child.size.width > startX + targetRowWidth
    ) {
      cursorX = startX;
      cursorY += rowHeight + GROUP_LAYOUT_GAP_Y;
      rowHeight = 0;
    }

    positions.set(child.id, { x: cursorX, y: cursorY });
    cursorX += child.size.width + GROUP_LAYOUT_GAP_X;
    rowHeight = Math.max(rowHeight, child.size.height);
  }

  const bounds = computeGroupBounds(
    sorted.map((child) => ({
      position: positions.get(child.id) ?? child.position,
      size: child.size,
    })),
  );

  return { positions, bounds };
}

export function resolveGroupCollision(
  bounds: { x: number; y: number; width: number; height: number },
  existing: CanvasPlacementRect[],
): { x: number; y: number } {
  let candidate = { x: bounds.x, y: bounds.y };
  let guard = 0;

  while (overlapsAny(candidate, bounds.width, bounds.height, existing, GROUP_TO_GROUP_GAP) && guard < 100) {
    const blocker = findBlocker(candidate, bounds.width, bounds.height, existing, GROUP_TO_GROUP_GAP);
    if (!blocker) break;

    const blockerCenterX = blocker.position.x + blocker.size.width / 2;
    const moveRight = candidate.x >= blockerCenterX;
    candidate = moveRight
      ? {
          x: blocker.position.x + blocker.size.width + GROUP_TO_GROUP_GAP,
          y: candidate.y,
        }
      : {
          x: candidate.x,
          y: blocker.position.y + blocker.size.height + GROUP_TO_GROUP_GAP,
        };
    guard += 1;
  }

  return candidate;
}
