import { computed } from '@preact/signals';
import { findNeighborhoods } from '../../server/spatial-analysis.js';
import { contextPinnedNodeIds, nodes } from './canvas-store';

/**
 * Near a pin (docs/design/NearPin.dc.html): each pinned node pulls up to five
 * unpinned nodes within 600 px into the agent's brief as title + short
 * summary. Same rule as the server's brief (`findNeighborhoods`), so the mark
 * claims exactly what the agent receives.
 */
export interface NearPin {
  pinNodeId: string;
  pinTitle: string;
}

let lastKey = '';
let lastNear = new Map<string, NearPin[]>();

/**
 * Unpinned node id → the pins it is near, nearest first. Every drag frame
 * moves a node, so the result keeps its identity while no node's set of pins
 * changes: the chips subscribed to it re-render only when a neighbourhood does.
 */
export const nearPins = computed<Map<string, NearPin[]>>(() => {
  const pins = contextPinnedNodeIds.value;
  const near = new Map<string, NearPin[]>();
  if (pins.size > 0) {
    const nearest = new Map<string, Array<NearPin & { distance: number }>>();
    for (const neighborhood of findNeighborhoods([...nodes.value.values()], pins)) {
      const pinTitle = neighborhood.pinnedNodeTitle ?? neighborhood.pinnedNodeId;
      for (const neighbor of neighborhood.neighbors) {
        const list = nearest.get(neighbor.id) ?? [];
        list.push({ pinNodeId: neighborhood.pinnedNodeId, pinTitle, distance: neighbor.distance });
        nearest.set(neighbor.id, list);
      }
    }
    for (const [id, list] of nearest) {
      list.sort((a, b) => a.distance - b.distance);
      near.set(
        id,
        list.map(({ pinNodeId, pinTitle }) => ({ pinNodeId, pinTitle })),
      );
    }
  }
  const key = [...near]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, list]) => `${id}:${list.map((pin) => `${pin.pinNodeId}=${pin.pinTitle}`).join(',')}`)
    .join('|');
  if (key === lastKey) return lastNear;
  lastKey = key;
  lastNear = near;
  return near;
});
