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
  pins?: Record<string, ContextPinMeta>;
}

export const nodeReadStatus = signal<Map<string, NodeReadStatus>>(new Map());
export const contextPinMeta = signal<Record<string, ContextPinMeta>>({});

export function applyContextStatus(response: ContextStatusResponse): void {
  nodeReadStatus.value = new Map((response.nodes ?? []).map((entry) => [entry.nodeId, entry]));
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

/** Display name for an attributed writer: its agent id, else its transport label. */
export function writerName(actor: { source: string; agentId?: string }): string {
  return actor.agentId?.trim() || actor.source;
}
