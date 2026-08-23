/**
 * Scope fence geometry shared by the server's enforcement and the client's
 * rendering so both draw the same box: the bounding box of the fenced nodes
 * plus `padding` px. Null when none of the fenced nodes exist.
 */
export interface FenceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function fenceRectFromNodes(
  nodes: Iterable<{ position: { x: number; y: number }; size: { width: number; height: number } }>,
  padding: number,
): FenceRect | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let count = 0;
  for (const node of nodes) {
    count += 1;
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + node.size.width);
    maxY = Math.max(maxY, node.position.y + node.size.height);
  }
  if (count === 0) return null;
  return { x: minX - padding, y: minY - padding, width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 };
}
