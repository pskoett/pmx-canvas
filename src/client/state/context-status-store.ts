import { signal } from '@preact/signals';
import { activeBoardId } from './boards-store';
import { requestJson } from './intent-bridge';

/**
 * What agents did with the board's context (docs/design/AgentContext.dc.html):
 * per node, the latest agent read of its content and the revision it read;
 * per pin, who pinned it, when and why. Server truth from
 * `GET /api/canvas/ax/context-status`, refetched when a read lands
 * (`context-status-changed`), when pins change, and on (re)connect.
 */

export interface NodeReadStatus {
  nodeId: string;
  lastReadAt: string;
  lastReadBy: string;
  readRevision: number;
  readCount: number;
}

export interface ContextPinMeta {
  pinnedBy: { actor: 'human' | 'agent' | 'system' | 'unknown'; source: string; agentId?: string };
  pinnedAt: string;
  reason?: string;
}

interface ContextStatusResponse {
  ok?: boolean;
  boardId?: string | null;
  nodes?: NodeReadStatus[];
  /** Per node, the newest links revision an agent read carried. */
  links?: Record<string, number>;
  pins?: Record<string, ContextPinMeta>;
}

export const nodeReadStatus = signal<Map<string, NodeReadStatus>>(new Map());
export const contextPinMeta = signal<Record<string, ContextPinMeta>>({});
export const seenLinks = signal<Record<string, number>>({});

export function applyContextStatus(response: ContextStatusResponse): void {
  nodeReadStatus.value = new Map((response.nodes ?? []).map((entry) => [entry.nodeId, entry]));
  seenLinks.value = response.links ?? {};
  contextPinMeta.value = response.pins ?? {};
}

export async function refreshContextStatus(): Promise<void> {
  const response = await requestJson<ContextStatusResponse>('fetchContextStatus', '/api/canvas/ax/context-status', {});
  // A late answer for a board you have since left must not mark this one.
  if (response.ok && response.boardId === activeBoardId.value) applyContextStatus(response);
}

/** How an agent's context relates to one pinned node — the mark its header shows. */
export type PinnedReadState =
  | { kind: 'not-read' }
  | { kind: 'read'; by: string; at: string; count: number }
  | { kind: 'changed'; by: string; at: string };

export function pinnedReadState(nodeId: string, currentRevision: number): PinnedReadState {
  const read = nodeReadStatus.value.get(nodeId);
  const pinnedAt = contextPinMeta.value[nodeId]?.pinnedAt;
  // Pinned after the latest read: the agent has not loaded it since you pinned it.
  if (!read || (pinnedAt && read.lastReadAt < pinnedAt)) return { kind: 'not-read' };
  if (currentRevision > read.readRevision) return { kind: 'changed', by: read.lastReadBy, at: read.lastReadAt };
  return { kind: 'read', by: read.lastReadBy, at: read.lastReadAt, count: read.readCount };
}

/**
 * Connection changes (option C, docs/design/LinksOptions.dc.html): the mark a
 * link carries until a read brings either end with its relations. A person's
 * change is "not seen" by the agent; an agent's change says which agent made
 * it. Quiet until an agent has read this board at all, so a board no agent
 * reads never fills with marks.
 */
export type LinkMark = { kind: 'not-seen' } | { kind: 'agent'; by: string } | null;

export function linkMark(edge: {
  from: string;
  to: string;
  revision?: number;
  changedBy?: { actor: string; source: string; agentId?: string };
}): LinkMark {
  const seen = seenLinks.value;
  if (!edge.revision || Object.keys(seen).length === 0) return null;
  if (edge.revision <= Math.max(seen[edge.from] ?? -1, seen[edge.to] ?? -1)) return null;
  return edge.changedBy?.actor === 'agent' ? { kind: 'agent', by: writerName(edge.changedBy) } : { kind: 'not-seen' };
}

/** A card whose links changed after the last read that carried them (shown neutral, never amber). */
export function linksChanged(nodeId: string, linksRevision: number): boolean {
  const seen = seenLinks.value[nodeId];
  return seen !== undefined && linksRevision > seen;
}

/** Display name for an attributed writer: its agent id, else its transport label. */
export function writerName(actor: { source: string; agentId?: string }): string {
  return actor.agentId?.trim() || actor.source;
}
