import { computed, signal } from '@preact/signals';
import { centerDistance, findNeighborhoods } from '../../server/spatial-analysis.js';
import { contextPinnedNodeIds, nodes, selectedNodeIds } from './canvas-store';
import { grabbingNodeId } from './human-store';

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

/** Pin id → its neighbours' ids: the tether layer looks a pin up, never scans the near map. */
export const neighboursByPin = computed<Map<string, string[]>>(() => {
  const byPin = new Map<string, string[]>();
  for (const [nodeId, pins] of nearPins.value) {
    for (const pin of pins) {
      const list = byPin.get(pin.pinNodeId) ?? [];
      list.push(nodeId);
      byPin.set(pin.pinNodeId, list);
    }
  }
  return byPin;
});

/** The node under the pointer: a hovered pin draws its neighbours (NearPin.dc.html §2). */
export const hoveredNodeId = signal<string | null>(null);
/** A near node whose pins the human asked to see from its chip ("Show pins"). */
export const shownPinsFor = signal<string | null>(null);

/**
 * Pins drawn with tethers and the 600 px radius: the pin being dragged,
 * hovered or selected, or the pins of the near node whose chip said "Show
 * pins". Dragging an unpinned node rings only its nearest pin (§3).
 */
export const tetherFocus = computed<{ pinIds: string[]; ringOnly: boolean }>(() => {
  const pins = contextPinnedNodeIds.value;
  if (pins.size === 0) return { pinIds: [], ringOnly: false };
  const grabbed = grabbingNodeId.value;
  if (grabbed && !pins.has(grabbed)) {
    const dragged = nodes.value.get(grabbed);
    let nearest: string | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const id of pins) {
      const pin = nodes.value.get(id);
      if (!dragged || !pin) continue;
      const distance = centerDistance(dragged, pin);
      if (distance < best) {
        best = distance;
        nearest = id;
      }
    }
    return { pinIds: nearest ? [nearest] : [], ringOnly: true };
  }
  const ids = new Set<string>();
  if (grabbed) ids.add(grabbed);
  const hovered = hoveredNodeId.value;
  if (hovered && pins.has(hovered)) ids.add(hovered);
  for (const id of selectedNodeIds.value) if (pins.has(id)) ids.add(id);
  const shown = shownPinsFor.value;
  for (const pin of (shown && nearPins.value.get(shown)) || []) ids.add(pin.pinNodeId);
  return { pinIds: [...ids], ringOnly: false };
});

/** The moment it changes (§3): the chip pulses once on a drop inside, fades on a drop outside. */
export const nearChange = signal<{ nodeId: string; kind: 'in' | 'out'; pins: NearPin[] } | null>(null);
let nearAtGrab: NearPin[] | undefined;

export function noteNearAtGrab(nodeId: string): void {
  clearNearChange(nodeId);
  nearAtGrab = nearPins.value.get(nodeId);
}

export function settleNearAfterDrop(nodeId: string): void {
  const before = nearAtGrab;
  nearAtGrab = undefined;
  const after = nearPins.value.get(nodeId);
  if (after && !before) nearChange.value = { nodeId, kind: 'in', pins: after };
  else if (before && !after) nearChange.value = { nodeId, kind: 'out', pins: before };
}

export function clearNearChange(nodeId: string): void {
  if (nearChange.value?.nodeId === nodeId) nearChange.value = null;
}

/**
 * The open near chip's card (§2), drawn over the canvas because a node paints
 * contained. `at` is the chip's screen rect when it opened; the card closes
 * when the view moves rather than chase a stale anchor.
 */
export const nearCard = signal<{
  nodeId: string;
  at: { left: number; right: number; top: number; bottom: number };
  view: string;
} | null>(null);
let closeTimer: ReturnType<typeof setTimeout> | null = null;

export function openNearCard(nodeId: string, chip: Element, view: string): void {
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = null;
  const rect = chip.getBoundingClientRect();
  nearCard.value = { nodeId, at: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, view };
}

/** Leaving the chip for the card must not close it: close after a short grace. */
export function closeNearCardSoon(): void {
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    closeTimer = null;
    nearCard.value = null;
  }, 160);
}

export function keepNearCard(): void {
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = null;
}
