import { signal } from '@preact/signals';
import { activeBoardId } from './boards-store';
import { edges } from './canvas-store';
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
 * The marks a link's pill carries (docs/design/LinkAuthorship.dc.html):
 * - `agent`: the agent that drew or last relabelled it — a ✦ that stays until
 *   a person edits, retypes or relabels the link. A read never clears it.
 * - `notSeen`: a person's new or edited link that no read has carried yet —
 *   temporary, cleared by the agent's next read of either end. Quiet until an
 *   agent has read this board at all. An agent's link is never "not seen".
 * The board's only person draws without a mark (another person's initial is
 * Part 3, shared boards).
 */
export interface LinkMarks {
  agent: string | null;
  notSeen: boolean;
}

export function linkMarks(edge: {
  from: string;
  to: string;
  revision?: number;
  changedBy?: { actor: string; source: string; agentId?: string };
}): LinkMarks {
  if (edge.changedBy?.actor === 'agent') return { agent: writerName(edge.changedBy), notSeen: false };
  const seen = seenLinks.value;
  const notSeen =
    !!edge.revision &&
    Object.keys(seen).length > 0 &&
    edge.revision > Math.max(seen[edge.from] ?? -1, seen[edge.to] ?? -1);
  return { agent: null, notSeen };
}

/**
 * A card whose links changed after the last read that carried them (shown
 * neutral, never amber). A link an agent drew does not count — that agent
 * made it, and the link itself says "by <agent>". A removed link has no
 * author left to check, so it counts.
 */
export function linksChanged(nodeId: string, linksRevision: number): boolean {
  const seen = seenLinks.value[nodeId];
  if (seen === undefined || linksRevision <= seen) return false;
  const unseen = [...edges.value.values()].filter(
    (edge) => (edge.from === nodeId || edge.to === nodeId) && (edge.revision ?? 0) > seen,
  );
  if (unseen.some((edge) => edge.changedBy?.actor !== 'agent')) return true;
  return !unseen.some((edge) => edge.revision === linksRevision);
}

/** Display name for an attributed writer: its agent id, else its transport label. */
export function writerName(actor: { source: string; agentId?: string }): string {
  return actor.agentId?.trim() || actor.source;
}
