import { signal } from '@preact/signals';
import type { CanvasNodeState } from '../types';

/** Snap threshold in world-space pixels. */
const SNAP_PX = 8;

export interface GuideLine {
  axis: 'x' | 'y';
  /** World-space coordinate of the guide line. */
  pos: number;
  /** Extent of the guide line for rendering (min/max along the other axis). */
  from: number;
  to: number;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: GuideLine[];
}

/** Active guide lines to render. Null when not dragging. */
export const activeGuides = signal<GuideLine[] | null>(null);

/**
 * Given a dragging node's proposed position and size, snap it to nearby
 * nodes' edges and centers. Returns the snapped position and active guides.
 */
export function snapToGuides(
  proposedX: number,
  proposedY: number,
  nodeW: number,
  nodeH: number,
  dragId: string,
  allNodes: Iterable<CanvasNodeState>,
): SnapResult {
  // Edges of the dragged node
  const dragLeft = proposedX;
  const dragRight = proposedX + nodeW;
  const dragCenterX = proposedX + nodeW / 2;
  const dragTop = proposedY;
  const dragBottom = proposedY + nodeH;
  const dragCenterY = proposedY + nodeH / 2;

  const dragXEdges = [
    { val: dragLeft, type: 'left' as const },
    { val: dragCenterX, type: 'center' as const },
    { val: dragRight, type: 'right' as const },
  ];
  const dragYEdges = [
    { val: dragTop, type: 'top' as const },
    { val: dragCenterY, type: 'center' as const },
    { val: dragBottom, type: 'bottom' as const },
  ];

  // Collect reference edges from all other visible nodes
  const refX: { val: number; minY: number; maxY: number }[] = [];
  const refY: { val: number; minX: number; maxX: number }[] = [];

  for (const n of allNodes) {
    if (n.id === dragId || n.dockPosition !== null) continue;
    const l = n.position.x;
    const r = n.position.x + n.size.width;
    const cx = n.position.x + n.size.width / 2;
    const t = n.position.y;
    const b = n.position.y + n.size.height;
    const cy = n.position.y + n.size.height / 2;

    refX.push({ val: l, minY: t, maxY: b });
    refX.push({ val: r, minY: t, maxY: b });
    refX.push({ val: cx, minY: t, maxY: b });

    refY.push({ val: t, minX: l, maxX: r });
    refY.push({ val: b, minX: l, maxX: r });
    refY.push({ val: cy, minX: l, maxX: r });
  }

  let snapX: number | null = null;
  let bestDx = SNAP_PX + 1;
  let snapXGuide: GuideLine | null = null;

  for (const drag of dragXEdges) {
    for (const ref of refX) {
      const d = Math.abs(drag.val - ref.val);
      if (d < bestDx) {
        bestDx = d;
        // Snap: adjust proposedX so that drag edge aligns with ref
        const offset = drag.type === 'left' ? 0 : drag.type === 'center' ? nodeW / 2 : nodeW;
        snapX = ref.val - offset;
        snapXGuide = {
          axis: 'x',
          pos: ref.val,
          from: Math.min(ref.minY, proposedY),
          to: Math.max(ref.maxY, proposedY + nodeH),
        };
      }
    }
  }

  let snapY: number | null = null;
  let bestDy = SNAP_PX + 1;
  let snapYGuide: GuideLine | null = null;

  for (const drag of dragYEdges) {
    for (const ref of refY) {
      const d = Math.abs(drag.val - ref.val);
      if (d < bestDy) {
        bestDy = d;
        const offset = drag.type === 'top' ? 0 : drag.type === 'center' ? nodeH / 2 : nodeH;
        snapY = ref.val - offset;
        snapYGuide = {
          axis: 'y',
          pos: ref.val,
          from: Math.min(ref.minX, proposedX),
          to: Math.max(ref.maxX, proposedX + nodeW),
        };
      }
    }
  }

  const guides: GuideLine[] = [];
  if (snapXGuide && bestDx <= SNAP_PX) guides.push(snapXGuide);
  if (snapYGuide && bestDy <= SNAP_PX) guides.push(snapYGuide);

  return {
    x: snapX !== null && bestDx <= SNAP_PX ? snapX : proposedX,
    y: snapY !== null && bestDy <= SNAP_PX ? snapY : proposedY,
    guides,
  };
}
