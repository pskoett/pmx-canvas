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
  distance: number;
}

/** Unpinned node id → the pins it is near, nearest first. */
export const nearPins = computed<Map<string, NearPin[]>>(() => {
  const pins = contextPinnedNodeIds.value;
  const near = new Map<string, NearPin[]>();
  if (pins.size === 0) return near;
  for (const neighborhood of findNeighborhoods([...nodes.value.values()], pins)) {
    const pinTitle = neighborhood.pinnedNodeTitle ?? neighborhood.pinnedNodeId;
    for (const neighbor of neighborhood.neighbors) {
      const list = near.get(neighbor.id) ?? [];
      list.push({ pinNodeId: neighborhood.pinnedNodeId, pinTitle, distance: neighbor.distance });
      near.set(neighbor.id, list);
    }
  }
  for (const list of near.values()) list.sort((a, b) => a.distance - b.distance);
  return near;
});
