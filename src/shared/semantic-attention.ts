import type { CanvasEdge, CanvasLayout, CanvasNodeState } from '../client/types.js';
import { buildSpatialContext, type SpatialContext } from '../server/spatial-analysis.js';

export type SemanticWatchEventType =
  | 'context-pin'
  | 'connect'
  | 'remove'
  | 'group'
  | 'move-end';

export const ALL_SEMANTIC_WATCH_EVENT_TYPES: SemanticWatchEventType[] = [
  'context-pin',
  'connect',
  'remove',
  'group',
  'move-end',
];

export interface SemanticWatchNodeSummary {
  id: string;
  title: string | null;
  nodeType: CanvasNodeState['type'];
}

export interface SemanticWatchEdgeSummary {
  id: string;
  edgeType: CanvasEdge['type'];
  fromId: string;
  toId: string;
  fromTitle: string | null;
  toTitle: string | null;
}

export interface ContextPinWatchEvent {
  type: 'context-pin';
  timestamp?: string;
  sessionId?: string;
  added: SemanticWatchNodeSummary[];
  removed: SemanticWatchNodeSummary[];
}

export interface ConnectWatchEvent {
  type: 'connect';
  timestamp?: string;
  sessionId?: string;
  edges: SemanticWatchEdgeSummary[];
}

export interface RemoveWatchEvent {
  type: 'remove';
  timestamp?: string;
  sessionId?: string;
  nodes: SemanticWatchNodeSummary[];
  edges: SemanticWatchEdgeSummary[];
}

export interface GroupCreatedSummary {
  id: string;
  title: string | null;
  childCount: number;
}

export interface GroupUpdatedSummary {
  id: string;
  title: string | null;
  addedChildIds: string[];
  removedChildIds: string[];
  childCount: number;
}

export interface GroupWatchEvent {
  type: 'group';
  timestamp?: string;
  sessionId?: string;
  created: GroupCreatedSummary[];
  updated: GroupUpdatedSummary[];
}

export interface MoveEndNodeSummary extends SemanticWatchNodeSummary {
  reasons: string[];
}

export interface MoveEndWatchEvent {
  type: 'move-end';
  timestamp?: string;
  sessionId?: string;
  nodes: MoveEndNodeSummary[];
}

export type SemanticWatchEvent =
  | ContextPinWatchEvent
  | ConnectWatchEvent
  | RemoveWatchEvent
  | GroupWatchEvent
  | MoveEndWatchEvent;

export interface SseMessage {
  event: string;
  data: unknown;
  id?: string;
}

interface EventMeta {
  timestamp?: string;
  sessionId?: string;
}

export interface SemanticAttentionRegion {
  id: string;
  primaryNodeId: string;
  nodeIds: string[];
}

export interface SemanticAttentionSnapshot {
  layout: CanvasLayout | null;
  pinnedNodeIds: string[];
  primaryFocusNodeIds: string[];
  secondaryFocusNodeIds: string[];
  regions: SemanticAttentionRegion[];
  spatial: SpatialContext | null;
}

function getNodeTitle(node: CanvasNodeState | undefined): string | null {
  if (!node) return null;
  const raw = node.data.title;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

function summarizeNode(node: CanvasNodeState | undefined, fallbackId: string): SemanticWatchNodeSummary {
  return {
    id: node?.id ?? fallbackId,
    title: getNodeTitle(node),
    nodeType: node?.type ?? 'markdown',
  };
}

function summarizeEdge(edge: CanvasEdge, nodeMap: Map<string, CanvasNodeState>): SemanticWatchEdgeSummary {
  return {
    id: edge.id,
    edgeType: edge.type,
    fromId: edge.from,
    toId: edge.to,
    fromTitle: getNodeTitle(nodeMap.get(edge.from)),
    toTitle: getNodeTitle(nodeMap.get(edge.to)),
  };
}

function toNodeMap(nodes: CanvasNodeState[]): Map<string, CanvasNodeState> {
  return new Map(nodes.map((node) => [node.id, node]));
}

function toEdgeMap(edges: CanvasEdge[]): Map<string, CanvasEdge> {
  return new Map(edges.map((edge) => [edge.id, edge]));
}

function sortIds(values: Iterable<string>): string[] {
  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function summarizeTitleList(nodes: SemanticWatchNodeSummary[]): string {
  return nodes
    .map((node) => node.title ?? node.id)
    .map((value) => `"${value}"`)
    .join(', ');
}

function getGroupChildren(node: CanvasNodeState | undefined): string[] {
  if (!node || node.type !== 'group') return [];
  const raw = node.data.children;
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is string => typeof value === 'string').sort((a, b) => a.localeCompare(b));
}

function buildClusterPeerMap(spatial: SpatialContext): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const cluster of spatial.clusters) {
    const members = [...cluster.nodeIds].sort((a, b) => a.localeCompare(b));
    for (const nodeId of members) {
      map.set(nodeId, members.filter((id) => id !== nodeId));
    }
  }
  return map;
}

function buildNeighborhoodMap(spatial: SpatialContext): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const neighborhood of spatial.pinnedNeighborhoods) {
    map.set(
      neighborhood.pinnedNodeId,
      neighborhood.neighbors.map((neighbor) => neighbor.id).sort((a, b) => a.localeCompare(b)),
    );
  }
  return map;
}

function diffSet(prev: Set<string>, next: Set<string>): { added: string[]; removed: string[] } {
  const added = sortIds(Array.from(next).filter((id) => !prev.has(id)));
  const removed = sortIds(Array.from(prev).filter((id) => !next.has(id)));
  return { added, removed };
}

function normalizeEventMeta(payload: unknown): EventMeta {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  return {
    timestamp: typeof record.timestamp === 'string' ? record.timestamp : undefined,
    sessionId: typeof record.sessionId === 'string' ? record.sessionId : undefined,
  };
}

function compactCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function buildAttentionSnapshot(
  currentLayout: CanvasLayout | null,
  currentPins: Set<string>,
  spatial: SpatialContext | null,
): SemanticAttentionSnapshot {
  if (!currentLayout || !spatial) {
    return {
      layout: currentLayout,
      pinnedNodeIds: [],
      primaryFocusNodeIds: [],
      secondaryFocusNodeIds: [],
      regions: [],
      spatial,
    };
  }

  const nodeMap = toNodeMap(currentLayout.nodes);
  const pinnedNodeIds = sortIds(currentPins).filter((nodeId) => nodeMap.has(nodeId));
  const primaryIds = new Set(pinnedNodeIds);
  const secondaryIds = new Set<string>();
  const regions: SemanticAttentionRegion[] = [];

  for (const neighborhood of spatial.pinnedNeighborhoods) {
    if (!primaryIds.has(neighborhood.pinnedNodeId)) continue;
    const nodeIds = sortIds([
      neighborhood.pinnedNodeId,
      ...neighborhood.neighbors.map((neighbor) => neighbor.id),
    ]).filter((nodeId, index, values) => values.indexOf(nodeId) === index && nodeMap.has(nodeId));
    for (const nodeId of nodeIds) {
      if (!primaryIds.has(nodeId)) secondaryIds.add(nodeId);
    }
    regions.push({
      id: `region-${neighborhood.pinnedNodeId}`,
      primaryNodeId: neighborhood.pinnedNodeId,
      nodeIds,
    });
  }

  if (regions.length === 0 && pinnedNodeIds.length > 0) {
    for (const pinnedNodeId of pinnedNodeIds) {
      regions.push({
        id: `region-${pinnedNodeId}`,
        primaryNodeId: pinnedNodeId,
        nodeIds: [pinnedNodeId],
      });
    }
  }

  return {
    layout: currentLayout,
    pinnedNodeIds,
    primaryFocusNodeIds: pinnedNodeIds,
    secondaryFocusNodeIds: sortIds(secondaryIds),
    regions,
    spatial,
  };
}

export function formatCompactWatchEvent(event: SemanticWatchEvent): string {
  switch (event.type) {
    case 'context-pin': {
      const parts: string[] = [];
      if (event.added.length > 0) parts.push(`+${event.added.length}: ${summarizeTitleList(event.added)}`);
      if (event.removed.length > 0) parts.push(`removed: ${summarizeTitleList(event.removed)}`);
      return `context-pin ${parts.join(' | ')}`.trim();
    }
    case 'connect':
      return `connect ${compactCount(event.edges.length, 'edge')}: ${event.edges
        .map((edge) => `"${edge.fromTitle ?? edge.fromId}" -> "${edge.toTitle ?? edge.toId}" (${edge.edgeType})`)
        .join(', ')}`;
    case 'remove': {
      const parts: string[] = [];
      if (event.nodes.length > 0) {
        parts.push(`${compactCount(event.nodes.length, 'node')}: ${summarizeTitleList(event.nodes)}`);
      }
      if (event.edges.length > 0) {
        parts.push(`${compactCount(event.edges.length, 'edge')}`);
      }
      return `remove ${parts.join(' | ')}`.trim();
    }
    case 'group': {
      const parts: string[] = [];
      if (event.created.length > 0) {
        parts.push(
          `created: ${event.created
            .map((group) => `"${group.title ?? group.id}" (${compactCount(group.childCount, 'child')})`)
            .join(', ')}`,
        );
      }
      if (event.updated.length > 0) {
        parts.push(
          `updated: ${event.updated
            .map((group) =>
              `"${group.title ?? group.id}" +${group.addedChildIds.length} -${group.removedChildIds.length} children`,
            )
            .join(', ')}`,
        );
      }
      return `group ${parts.join(' | ')}`.trim();
    }
    case 'move-end':
      return `move-end: ${event.nodes
        .map((node) => `"${node.title ?? node.id}" ${node.reasons.join('; ')}`)
        .join(', ')}`;
  }
}

export class SemanticWatchReducer {
  private currentLayout: CanvasLayout | null = null;
  private currentPins = new Set<string>();
  private previousSpatial: SpatialContext | null = null;

  setInitialPins(nodeIds: string[]): void {
    this.currentPins = new Set(nodeIds);
  }

  getAttentionSnapshot(): SemanticAttentionSnapshot {
    return buildAttentionSnapshot(this.currentLayout, this.currentPins, this.previousSpatial);
  }

  handleMessage(message: SseMessage): SemanticWatchEvent[] {
    if (message.event === 'context-pins-changed') {
      return this.handleContextPinsChanged(message.data);
    }
    if (message.event === 'canvas-layout-update') {
      return this.handleLayoutUpdate(message.data);
    }
    return [];
  }

  private handleContextPinsChanged(payload: unknown): SemanticWatchEvent[] {
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const nodeIds = Array.isArray(record.nodeIds)
      ? record.nodeIds.filter((id): id is string => typeof id === 'string')
      : [];
    const meta = normalizeEventMeta(payload);
    const nextPins = new Set(nodeIds);
    const { added, removed } = diffSet(this.currentPins, nextPins);
    this.currentPins = nextPins;

    if (!this.currentLayout) return [];

    const nodeMap = toNodeMap(this.currentLayout.nodes);
    const previousEventPins = {
      added: added.map((id) => summarizeNode(nodeMap.get(id), id)),
      removed: removed.map((id) => summarizeNode(nodeMap.get(id), id)),
    };

    this.previousSpatial = buildSpatialContext(
      this.currentLayout.nodes,
      this.currentLayout.edges,
      this.currentPins,
    );

    if (previousEventPins.added.length === 0 && previousEventPins.removed.length === 0) {
      return [];
    }

    return [{
      type: 'context-pin',
      ...meta,
      ...previousEventPins,
    }];
  }

  private handleLayoutUpdate(payload: unknown): SemanticWatchEvent[] {
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const layout = record.layout && typeof record.layout === 'object'
      ? record.layout as CanvasLayout
      : null;
    if (!layout) return [];

    const meta = normalizeEventMeta(payload);
    if (!this.currentLayout) {
      this.currentLayout = layout;
      this.previousSpatial = buildSpatialContext(layout.nodes, layout.edges, this.currentPins);
      return [];
    }

    const prevLayout = this.currentLayout;
    const prevSpatial = this.previousSpatial ?? buildSpatialContext(
      prevLayout.nodes,
      prevLayout.edges,
      this.currentPins,
    );
    const nextSpatial = buildSpatialContext(layout.nodes, layout.edges, this.currentPins);
    const events: SemanticWatchEvent[] = [];

    const prevNodeMap = toNodeMap(prevLayout.nodes);
    const nextNodeMap = toNodeMap(layout.nodes);
    const prevEdgeMap = toEdgeMap(prevLayout.edges);
    const nextEdgeMap = toEdgeMap(layout.edges);

    const addedEdges = sortIds(Array.from(nextEdgeMap.keys()).filter((id) => !prevEdgeMap.has(id)))
      .map((id) => nextEdgeMap.get(id))
      .filter((edge): edge is CanvasEdge => edge !== undefined);
    if (addedEdges.length > 0) {
      events.push({
        type: 'connect',
        ...meta,
        edges: addedEdges.map((edge) => summarizeEdge(edge, nextNodeMap)),
      });
    }

    const removedNodeIds = sortIds(Array.from(prevNodeMap.keys()).filter((id) => !nextNodeMap.has(id)));
    const removedEdgeIds = sortIds(Array.from(prevEdgeMap.keys()).filter((id) => !nextEdgeMap.has(id)));
    if (removedNodeIds.length > 0 || removedEdgeIds.length > 0) {
      events.push({
        type: 'remove',
        ...meta,
        nodes: removedNodeIds.map((id) => summarizeNode(prevNodeMap.get(id), id)),
        edges: removedEdgeIds
          .map((id) => prevEdgeMap.get(id))
          .filter((edge): edge is CanvasEdge => edge !== undefined)
          .map((edge) => summarizeEdge(edge, prevNodeMap)),
      });
    }

    const groupEvent = this.buildGroupEvent(prevNodeMap, nextNodeMap, meta);
    if (groupEvent) events.push(groupEvent);

    const moveEvent = this.buildMoveEndEvent(
      prevLayout,
      layout,
      prevNodeMap,
      nextNodeMap,
      prevSpatial,
      nextSpatial,
      meta,
    );
    if (moveEvent) events.push(moveEvent);

    this.currentLayout = layout;
    this.previousSpatial = nextSpatial;
    return events;
  }

  private buildGroupEvent(
    prevNodeMap: Map<string, CanvasNodeState>,
    nextNodeMap: Map<string, CanvasNodeState>,
    meta: EventMeta,
  ): GroupWatchEvent | null {
    const prevGroupIds = sortIds(Array.from(prevNodeMap.values())
      .filter((node) => node.type === 'group')
      .map((node) => node.id));
    const nextGroupIds = sortIds(Array.from(nextNodeMap.values())
      .filter((node) => node.type === 'group')
      .map((node) => node.id));

    const created = nextGroupIds
      .filter((id) => !prevGroupIds.includes(id))
      .map((id) => {
        const group = nextNodeMap.get(id);
        const children = getGroupChildren(group);
        return {
          id,
          title: getNodeTitle(group),
          childCount: children.length,
        };
      });

    const updated: GroupUpdatedSummary[] = [];
    for (const groupId of nextGroupIds.filter((id) => prevGroupIds.includes(id))) {
      const prevChildren = getGroupChildren(prevNodeMap.get(groupId));
      const nextChildren = getGroupChildren(nextNodeMap.get(groupId));
      if (arraysEqual(prevChildren, nextChildren)) continue;

      updated.push({
        id: groupId,
        title: getNodeTitle(nextNodeMap.get(groupId)),
        addedChildIds: nextChildren.filter((id) => !prevChildren.includes(id)),
        removedChildIds: prevChildren.filter((id) => !nextChildren.includes(id)),
        childCount: nextChildren.length,
      });
    }

    if (created.length === 0 && updated.length === 0) return null;
    return {
      type: 'group',
      ...meta,
      created,
      updated,
    };
  }

  private buildMoveEndEvent(
    _prevLayout: CanvasLayout,
    _nextLayout: CanvasLayout,
    prevNodeMap: Map<string, CanvasNodeState>,
    nextNodeMap: Map<string, CanvasNodeState>,
    prevSpatial: SpatialContext,
    nextSpatial: SpatialContext,
    meta: EventMeta,
  ): MoveEndWatchEvent | null {
    const movedIds = sortIds(
      Array.from(nextNodeMap.keys()).filter((id) => {
        const prev = prevNodeMap.get(id);
        const next = nextNodeMap.get(id);
        if (!prev || !next) return false;
        return prev.position.x !== next.position.x || prev.position.y !== next.position.y;
      }),
    );

    if (movedIds.length === 0) return null;

    const prevPeerMap = buildClusterPeerMap(prevSpatial);
    const nextPeerMap = buildClusterPeerMap(nextSpatial);
    const prevNeighborhoodMap = buildNeighborhoodMap(prevSpatial);
    const nextNeighborhoodMap = buildNeighborhoodMap(nextSpatial);
    const reasonsByNode = new Map<string, Set<string>>();

    const pushReason = (nodeId: string, reason: string): void => {
      const current = reasonsByNode.get(nodeId) ?? new Set<string>();
      current.add(reason);
      reasonsByNode.set(nodeId, current);
    };

    for (const nodeId of movedIds) {
      const oldPeers = prevPeerMap.get(nodeId) ?? [];
      const newPeers = nextPeerMap.get(nodeId) ?? [];
      if (!arraysEqual(oldPeers, newPeers)) {
        if (oldPeers.length === 0 && newPeers.length > 0) {
          pushReason(nodeId, 'joined cluster');
        } else if (oldPeers.length > 0 && newPeers.length === 0) {
          pushReason(nodeId, 'left cluster');
        } else {
          pushReason(nodeId, 'cluster changed');
        }
      }
    }

    const pinIds = new Set<string>([
      ...prevNeighborhoodMap.keys(),
      ...nextNeighborhoodMap.keys(),
    ]);
    for (const pinId of pinIds) {
      const oldNeighbors = prevNeighborhoodMap.get(pinId) ?? [];
      const newNeighbors = nextNeighborhoodMap.get(pinId) ?? [];
      if (arraysEqual(oldNeighbors, newNeighbors)) continue;

      const pinTitle = getNodeTitle(nextNodeMap.get(pinId) ?? prevNodeMap.get(pinId)) ?? pinId;
      const added = newNeighbors.filter((id) => !oldNeighbors.includes(id));
      const removed = oldNeighbors.filter((id) => !newNeighbors.includes(id));

      for (const nodeId of added) {
        if (movedIds.includes(nodeId)) {
          pushReason(nodeId, `entered pinned neighborhood of "${pinTitle}"`);
        }
      }
      for (const nodeId of removed) {
        if (movedIds.includes(nodeId)) {
          pushReason(nodeId, `left pinned neighborhood of "${pinTitle}"`);
        }
      }
      if (movedIds.includes(pinId)) {
        pushReason(pinId, 'pinned neighborhood changed');
      }
    }

    const movedNodes = movedIds
      .filter((id) => (reasonsByNode.get(id)?.size ?? 0) > 0)
      .map((id) => {
        const node = nextNodeMap.get(id);
        return {
          ...summarizeNode(node, id),
          reasons: Array.from(reasonsByNode.get(id) ?? []).sort((a, b) => a.localeCompare(b)),
        };
      });

    if (movedNodes.length === 0) return null;
    return {
      type: 'move-end',
      ...meta,
      nodes: movedNodes,
    };
  }
}
