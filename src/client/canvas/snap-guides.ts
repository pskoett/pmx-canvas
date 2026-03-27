import { signal } from '@preact/signals';
import type { CanvasNodeState } from '../types';

const SNAP_PX = 8;

export interface GuideLine {
  axis: 'x' | 'y';
  pos: number;
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

interface RefEdgeX { val: number; minY: number; maxY: number }
interface RefEdgeY { val: number; minX: number; maxX: number }

/** Cached reference edges — built once at drag-start, reused on every pointermove. */
let cachedRefX: RefEdgeX[] = [];
let cachedRefY: RefEdgeY[] = [];
let cachedDragId: string | null = null;

/** Call at drag-start to pre-compute reference edges from stationary nodes. */
export function buildSnapCache(dragId: string, allNodes: Iterable<CanvasNodeState>): void {
  cachedRefX = [];
  cachedRefY = [];
  cachedDragId = dragId;
  for (const n of allNodes) {
    if (n.id === dragId || n.dockPosition !== null) continue;
    const l = n.position.x;
    const r = n.position.x + n.size.width;
    const cx = n.position.x + n.size.width / 2;
    const t = n.position.y;
    const b = n.position.y + n.size.height;
    const cy = n.position.y + n.size.height / 2;

    cachedRefX.push({ val: l, minY: t, maxY: b });
    cachedRefX.push({ val: r, minY: t, maxY: b });
    cachedRefX.push({ val: cx, minY: t, maxY: b });

    cachedRefY.push({ val: t, minX: l, maxX: r });
    cachedRefY.push({ val: b, minX: l, maxX: r });
    cachedRefY.push({ val: cy, minX: l, maxX: r });
  }
}

/** Call at drag-end to clear the cache. */
export function clearSnapCache(): void {
  cachedRefX = [];
  cachedRefY = [];
  cachedDragId = null;
}

/**
 * Snap a dragging node's proposed position to cached reference edges.
 * Must call buildSnapCache() before the first call in a drag session.
 */
export function snapToGuides(
  proposedX: number,
  proposedY: number,
  nodeW: number,
  nodeH: number,
): SnapResult {
  const dragEdgesX = [proposedX, proposedX + nodeW / 2, proposedX + nodeW];
  const dragEdgesY = [proposedY, proposedY + nodeH / 2, proposedY + nodeH];
  const offX = [0, nodeW / 2, nodeW];
  const offY = [0, nodeH / 2, nodeH];

  let snapX: number | null = null;
  let bestDx = SNAP_PX + 1;
  let snapXGuide: GuideLine | null = null;

  for (let i = 0; i < 3; i++) {
    const dv = dragEdgesX[i];
    for (const ref of cachedRefX) {
      const d = Math.abs(dv - ref.val);
      if (d < bestDx) {
        bestDx = d;
        snapX = ref.val - offX[i];
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

  for (let i = 0; i < 3; i++) {
    const dv = dragEdgesY[i];
    for (const ref of cachedRefY) {
      const d = Math.abs(dv - ref.val);
      if (d < bestDy) {
        bestDy = d;
        snapY = ref.val - offY[i];
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
