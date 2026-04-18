import {
  SemanticWatchReducer,
  type ContextPinWatchEvent,
  type ConnectWatchEvent,
  type GroupWatchEvent,
  type MoveEndWatchEvent,
  type RemoveWatchEvent,
  type SemanticWatchEvent,
  type SseMessage,
} from '../../shared/semantic-attention.js';
import {
  pushAttentionHistory,
  resetAttentionState,
  setAttentionFocus,
  setAttentionPulse,
  setAttentionToast,
  type AttentionEntry,
  type AttentionTone,
} from './attention-store';

let reducer = new SemanticWatchReducer();
let toastQueue: AttentionEntry[] = [];
let toastTimer: number | null = null;
let pulseTimer: number | null = null;
let lastSignature = '';
let lastSignatureAt = 0;

function scheduleTimer(callback: () => void, delayMs: number): number {
  return globalThis.setTimeout(callback, delayMs) as unknown as number;
}

function cancelTimer(timerId: number | null): void {
  if (timerId === null) return;
  globalThis.clearTimeout(timerId);
}

function runOnNextFrame(callback: () => void): void {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    globalThis.requestAnimationFrame(() => callback());
    return;
  }
  callback();
}

function quoteLabel(value: string | null | undefined, fallback: string): string {
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

function summarizeNames(values: string[], limit = 3): string {
  if (values.length === 0) return '';
  if (values.length <= limit) return values.join(', ');
  return `${values.slice(0, limit).join(', ')} +${values.length - limit}`;
}

function uniqueNodeIds(nodeIds: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(nodeIds).filter((nodeId) => nodeId.length > 0)));
}

function makeEntry(
  tone: AttentionTone,
  title: string,
  detail: string,
  nodeIds: string[],
  createdAt = Date.now(),
): AttentionEntry {
  return {
    id: `${tone}-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    tone,
    title,
    detail,
    nodeIds: uniqueNodeIds(nodeIds),
    createdAt,
  };
}

function formatReason(reason: string): string {
  if (reason === 'joined cluster') return 'joined a nearby cluster';
  if (reason === 'left cluster') return 'moved away from its cluster';
  if (reason === 'cluster changed') return 'shifted into a different cluster';
  if (reason === 'pinned neighborhood changed') return 'changed the local focus field';
  const enteredMatch = /^entered pinned neighborhood of "(.+)"$/.exec(reason);
  if (enteredMatch) return `moved into focus around ${enteredMatch[1]}`;
  const leftMatch = /^left pinned neighborhood of "(.+)"$/.exec(reason);
  if (leftMatch) return `moved out of focus around ${leftMatch[1]}`;
  return reason;
}

function entryFromContextPin(event: ContextPinWatchEvent): AttentionEntry | null {
  const addedNames = event.added.map((node) => quoteLabel(node.title, node.id));
  const removedNames = event.removed.map((node) => quoteLabel(node.title, node.id));
  if (addedNames.length === 0 && removedNames.length === 0) return null;

  let detail = '';
  if (addedNames.length > 0 && removedNames.length === 0) {
    detail = `Now in focus: ${summarizeNames(addedNames)}`;
  } else if (removedNames.length > 0 && addedNames.length === 0) {
    detail = `Removed from focus: ${summarizeNames(removedNames)}`;
  } else {
    const parts: string[] = [];
    if (addedNames.length > 0) parts.push(`${summarizeNames(addedNames)} added`);
    if (removedNames.length > 0) parts.push(`${summarizeNames(removedNames)} removed`);
    detail = parts.join(' · ');
  }

  return makeEntry(
    'context',
    'Context updated',
    detail,
    [
      ...event.added.map((node) => node.id),
      ...event.removed.map((node) => node.id),
    ],
    event.timestamp ? Date.parse(event.timestamp) || Date.now() : Date.now(),
  );
}

function entryFromConnect(event: ConnectWatchEvent): AttentionEntry | null {
  if (event.edges.length === 0) return null;
  if (event.edges.length === 1) {
    const edge = event.edges[0];
    return makeEntry(
      'relationship',
      'Relationship added',
      `${quoteLabel(edge.fromTitle, edge.fromId)} linked to ${quoteLabel(edge.toTitle, edge.toId)}`,
      [edge.fromId, edge.toId],
      event.timestamp ? Date.parse(event.timestamp) || Date.now() : Date.now(),
    );
  }

  return makeEntry(
    'relationship',
    'Relationships added',
    `${event.edges.length} connections changed the board structure`,
    event.edges.flatMap((edge) => [edge.fromId, edge.toId]),
    event.timestamp ? Date.parse(event.timestamp) || Date.now() : Date.now(),
  );
}

function entryFromRemove(event: RemoveWatchEvent): AttentionEntry | null {
  if (event.nodes.length === 0 && event.edges.length === 0) return null;
  const nodeNames = event.nodes.map((node) => quoteLabel(node.title, node.id));
  const parts: string[] = [];
  if (nodeNames.length > 0) parts.push(summarizeNames(nodeNames));
  if (event.edges.length > 0) {
    parts.push(`${event.edges.length} relationship${event.edges.length === 1 ? '' : 's'}`);
  }
  return makeEntry(
    'remove',
    'Items removed',
    parts.join(' · '),
    [
      ...event.nodes.map((node) => node.id),
      ...event.edges.flatMap((edge) => [edge.fromId, edge.toId]),
    ],
    event.timestamp ? Date.parse(event.timestamp) || Date.now() : Date.now(),
  );
}

function entryFromGroup(event: GroupWatchEvent): AttentionEntry | null {
  if (event.created.length > 0) {
    const titles = event.created.map((group) => quoteLabel(group.title, group.id));
    return makeEntry(
      'group',
      event.created.length === 1 ? 'Group created' : 'Groups created',
      event.created.length === 1
        ? `${titles[0]} now frames ${event.created[0].childCount} items`
        : summarizeNames(titles),
      event.created.map((group) => group.id),
      event.timestamp ? Date.parse(event.timestamp) || Date.now() : Date.now(),
    );
  }
  if (event.updated.length > 0) {
    const titles = event.updated.map((group) => quoteLabel(group.title, group.id));
    return makeEntry(
      'group',
      event.updated.length === 1 ? 'Group updated' : 'Groups updated',
      event.updated.length === 1
        ? `${titles[0]} now holds ${event.updated[0].childCount} items`
        : summarizeNames(titles),
      event.updated.map((group) => group.id),
      event.timestamp ? Date.parse(event.timestamp) || Date.now() : Date.now(),
    );
  }
  return null;
}

function entryFromMoveEnd(event: MoveEndWatchEvent): AttentionEntry | null {
  if (event.nodes.length === 0) return null;
  const reasons = event.nodes.flatMap((node) => node.reasons);
  const names = event.nodes.map((node) => quoteLabel(node.title, node.id));
  const createdAt = event.timestamp ? Date.parse(event.timestamp) || Date.now() : Date.now();

  if (reasons.some((reason) => reason.includes('pinned neighborhood'))) {
    if (event.nodes.length === 1) {
      return makeEntry(
        'neighborhood',
        'Neighborhood changed',
        `${names[0]} ${formatReason(event.nodes[0].reasons[0])}`,
        event.nodes.map((node) => node.id),
        createdAt,
      );
    }
    return makeEntry(
      'neighborhood',
      'Neighborhood changed',
      summarizeNames(names),
      event.nodes.map((node) => node.id),
      createdAt,
    );
  }

  const clusterReasons = reasons.filter((reason) => reason.includes('cluster'));
  if (clusterReasons.length > 0) {
    const formedOnly = clusterReasons.every((reason) => reason === 'joined cluster');
    if (event.nodes.length === 1) {
      return makeEntry(
        'cluster',
        formedOnly ? 'Cluster formed' : 'Cluster changed',
        `${names[0]} ${formatReason(event.nodes[0].reasons[0])}`,
        event.nodes.map((node) => node.id),
        createdAt,
      );
    }
    return makeEntry(
      'cluster',
      formedOnly ? 'Cluster formed' : 'Cluster changed',
      summarizeNames(names),
      event.nodes.map((node) => node.id),
      createdAt,
    );
  }

  return null;
}

function entryFromEvent(event: SemanticWatchEvent): AttentionEntry | null {
  switch (event.type) {
    case 'context-pin':
      return entryFromContextPin(event);
    case 'connect':
      return entryFromConnect(event);
    case 'remove':
      return entryFromRemove(event);
    case 'group':
      return entryFromGroup(event);
    case 'move-end':
      return entryFromMoveEnd(event);
  }
}

function applyAttentionSnapshot(): void {
  const snapshot = reducer.getAttentionSnapshot();
  setAttentionFocus(snapshot.primaryFocusNodeIds, snapshot.secondaryFocusNodeIds, snapshot.regions);
}

function flushToastQueue(): void {
  if (toastTimer !== null) return;
  const next = toastQueue.shift() ?? null;
  if (!next) {
    setAttentionToast(null);
    return;
  }

  setAttentionToast(next);
  const durationMs = Math.max(1800, Math.min(2800, 1600 + next.detail.length * 18));
  toastTimer = scheduleTimer(() => {
    toastTimer = null;
    setAttentionToast(null);
    flushToastQueue();
  }, durationMs);
}

function enqueueToast(entry: AttentionEntry): void {
  toastQueue.push(entry);
  flushToastQueue();
}

function pulseNodes(nodeIds: string[]): void {
  cancelTimer(pulseTimer);
  pulseTimer = null;
  setAttentionPulse([]);
  if (nodeIds.length === 0) return;
  runOnNextFrame(() => {
    setAttentionPulse(nodeIds);
    pulseTimer = scheduleTimer(() => {
      pulseTimer = null;
      setAttentionPulse([]);
    }, 900);
  });
}

function shouldSuppressEntry(entry: AttentionEntry): boolean {
  const signature = `${entry.tone}:${entry.title}:${entry.detail}`;
  const now = entry.createdAt;
  if (signature === lastSignature && now - lastSignatureAt < 1200) {
    return true;
  }
  lastSignature = signature;
  lastSignatureAt = now;
  return false;
}

export function resetAttentionBridge(): void {
  cancelTimer(toastTimer);
  cancelTimer(pulseTimer);
  toastTimer = null;
  pulseTimer = null;
  toastQueue = [];
  lastSignature = '';
  lastSignatureAt = 0;
  reducer = new SemanticWatchReducer();
  resetAttentionState();
}

export function syncAttentionFromSse(message: SseMessage): void {
  const entries = reducer.handleMessage(message)
    .map((event) => entryFromEvent(event))
    .filter((entry): entry is AttentionEntry => entry !== null);

  applyAttentionSnapshot();

  for (const entry of entries) {
    if (shouldSuppressEntry(entry)) continue;
    pushAttentionHistory(entry);
    enqueueToast(entry);
    pulseNodes(entry.nodeIds);
  }
}
