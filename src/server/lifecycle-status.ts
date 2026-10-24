import { memoryKey, type MemoryTarget } from '../shared/memory-graph.js';
import { relationKind, relationSourceEnd } from '../shared/relations.js';
import type { LifecycleQualification } from '../shared/lifecycle-status.js';
import { canvasState, type CanvasNodeState } from './canvas-state.js';
import type { Lifecycle, ReviewCardSummary, ReviewRecord } from './knowledge-lifecycle.js';
import { normalizeCanvasNodeData, type CanvasNodeProvenance } from './canvas-provenance.js';
import { agentPresence } from './agent-presence.js';

const processStartedAt = Date.now();

interface Source {
  key: string;
  target: MemoryTarget;
  baseline?: number;
  kind: string;
  observedAt?: string;
  availability?: 'live' | 'cached' | 'unavailable';
}

/** A read-only qualification, shared by briefs, search, Home and card review. No clock is renewed. */
export function lifecycleQualifications(
  now = Date.now(),
  atUse: MemoryTarget[] = [],
): Record<string, LifecycleQualification> {
  return lifecycleSnapshot(now, atUse).cards;
}

/** A card being inspected is in use, including its transitive sources and portal contents. */
export function lifecycleQualification(target: MemoryTarget, now = Date.now()): LifecycleQualification | undefined {
  return lifecycleSnapshot(now, [target], target).cards[memoryKey(target)];
}

/** Read closure boards once; never activate them or flush the active board to discover edges. */
function dependencyClosure(target: MemoryTarget) {
  const reads = new Map<string, ReturnType<typeof canvasState.readBoard>>();
  const nodes = new Map<string, CanvasNodeState>();
  const dependencies = new Map<string, MemoryTarget[]>();
  const selected = new Set<string>();
  const queue: MemoryTarget[] = [target];
  const read = (boardId: string) => {
    if (!reads.has(boardId)) {
      const board = canvasState.readBoard(boardId, false);
      reads.set(boardId, board);
      for (const node of board?.layout.nodes ?? []) nodes.set(memoryKey({ boardId, cardId: node.id }), node);
      for (const edge of board?.layout.edges ?? []) {
        const end = relationSourceEnd(edge);
        if (!end) continue;
        const from = { boardId, cardId: edge.from };
        const to = { boardId: edge.toBoardId ?? boardId, cardId: edge.to };
        const key = memoryKey(end === 'from' ? to : from);
        const sources = dependencies.get(key) ?? [];
        sources.push(end === 'from' ? from : to);
        dependencies.set(key, sources);
      }
    }
    return reads.get(boardId);
  };
  const activeBoardId = canvasState.activeBoardId;
  const incomingActive = new Set(
    canvasState
      .getEdges()
      .flatMap((edge) =>
        edge.toBoardId && relationSourceEnd(edge) === 'from'
          ? [memoryKey({ boardId: edge.toBoardId, cardId: edge.to })]
          : [],
      ),
  );
  for (const current of queue) {
    const key = memoryKey(current);
    if (selected.has(key)) continue;
    selected.add(key);
    const board = read(current.boardId);
    if (!current.cardId) {
      for (const node of board?.layout.nodes ?? []) queue.push({ boardId: current.boardId, cardId: node.id });
      continue;
    }
    const node = nodes.get(key);
    if (!node) continue;
    const provenance = normalizeCanvasNodeData(node.type, node.data).provenance as CanvasNodeProvenance | undefined;
    queue.push(...(provenance?.sources ?? []).map(({ boardId, cardId }) => ({ boardId, cardId })));
    if (node.type === 'board' && typeof node.data.boardId === 'string') queue.push({ boardId: node.data.boardId });
    const owners = new Set([current.boardId, ...canvasState.knowledge.incomingSourceBoards(current, activeBoardId)]);
    if (activeBoardId && incomingActive.has(key)) owners.add(activeBoardId);
    for (const owner of owners) read(owner);
    queue.push(...(dependencies.get(key) ?? []));
  }
  return { reads, selected };
}

/** Compact queue metadata and qualifications come from the same authoritative read. */
export function lifecycleSnapshot(now = Date.now(), atUse: MemoryTarget[] = [], only?: MemoryTarget) {
  const result: Record<string, LifecycleQualification> = {};
  const cards = new Map<string, CanvasNodeState>();
  const validations = new Map<string, ReviewRecord | null>();
  const sources = new Map<string, Source[]>();
  const portals = new Map<string, string>();
  const policies = new Map<string, Lifecycle | null>();
  const used = new Set<string>();
  const boards = canvasState.listBoards();
  const closure = only ? dependencyClosure(only) : null;
  const reads = boards
    .filter((board) => !closure || closure.reads.has(board.id))
    .map((board) => ({
      board,
      read: closure ? closure.reads.get(board.id) : canvasState.readBoard(board.id, false),
    }));
  const targets = reads
    .flatMap(({ board, read }) => (read?.layout.nodes ?? []).map((node) => ({ boardId: board.id, cardId: node.id })))
    .filter((target) => !closure || closure.selected.has(memoryKey(target)));
  const summaries = canvasState.databasePath ? canvasState.knowledge.reviewSummaries(targets) : null;
  const catalog = canvasState.databasePath
    ? canvasState.knowledge.list()
    : { categories: [], folders: [], relationPresets: [] };
  const session =
    agentPresence.reviewSessionStartedAt() ??
    Date.parse(
      boards.find((board) => board.id === canvasState.activeBoardId)?.lastOpenedAt ??
        new Date(processStartedAt).toISOString(),
    );
  for (const { board, read } of reads) {
    const seen = new Map(canvasState.getNodeReadStatus(board.id).map((status) => [status.nodeId, status]));
    for (const node of read?.layout.nodes ?? []) {
      const key = memoryKey({ boardId: board.id, cardId: node.id });
      if (closure && !closure.selected.has(key)) continue;
      cards.set(key, node);
      const { lifecycle } = canvasState.knowledge.resolveCard(board.folder, node, catalog);
      policies.set(key, lifecycle);
      const { lastValidation, retired } = summaries?.get(key) ?? { lastValidation: null, retired: false };
      validations.set(key, lastValidation);
      const lastRead = seen.get(node.id);
      const pinned = read!.state.contextPins.includes(node.id);
      if (
        canvasState.activeBoardId === board.id ||
        board.pin ||
        atUse.some((target) => target.boardId === board.id && (!target.cardId || target.cardId === node.id))
      )
        used.add(key);
      const reasons: string[] = [];
      if (lastValidation && lastValidation.contentRevision !== (node.contentRevision ?? 0))
        reasons.push('Content changed since evidence validation.');
      result[key] = {
        retired,
        unknown: !lifecycle,
        due: false,
        reasons,
        changedSinceRead: !!lastRead && (node.contentRevision ?? 0) > lastRead.readRevision,
        lastReadAt: lastRead?.lastReadAt ?? null,
        lastValidatedAt: lastValidation?.when ?? null,
        contentRevision: node.contentRevision ?? 0,
        contentChangedAt: node.contentChangedAt ?? null,
        observations: {},
        sources: [],
        relevance: pinned ? 'card-pinned' : board.pin ? 'board-pinned' : 'not-selected',
      };
      if (node.type === 'board' && typeof node.data.boardId === 'string') portals.set(key, node.data.boardId);
      const provenance = normalizeCanvasNodeData(node.type, node.data).provenance as CanvasNodeProvenance | undefined;
      for (const source of provenance?.sources ?? []) {
        const existing = sources.get(key) ?? [];
        existing.push({
          key: `provenance:${memoryKey(source)}`,
          target: { boardId: source.boardId, cardId: source.cardId },
          baseline: source.contentRevision,
          observedAt: source.observedAt,
          availability: source.availability,
          kind: 'derived-from',
        });
        sources.set(key, existing);
      }
    }
    for (const edge of read?.layout.edges ?? []) {
      const end = relationSourceEnd(edge);
      if (!end) continue;
      const from = { boardId: board.id, cardId: edge.from };
      const to = { boardId: edge.toBoardId ?? board.id, cardId: edge.to };
      const target = end === 'from' ? from : to;
      const dependent = memoryKey(end === 'from' ? to : from);
      const kind = relationKind(edge);
      const existing = sources.get(dependent) ?? [];
      existing.push({
        key: JSON.stringify([board.id, edge.id, kind, memoryKey(target)]),
        target,
        kind,
        baseline: edge.sourceRevision,
      });
      sources.set(dependent, existing);
    }
  }
  for (const key of used) {
    for (const source of sources.get(key) ?? []) used.add(memoryKey(source.target));
    const portal = portals.get(key);
    if (portal)
      for (const node of reads.find(({ board }) => board.id === portal)?.read?.layout.nodes ?? [])
        used.add(memoryKey({ boardId: portal, cardId: node.id }));
  }
  for (const [key, status] of Object.entries(result)) {
    const policy = policies.get(key);
    if (!policy) continue;
    const checked = status.lastValidatedAt ? Date.parse(status.lastValidatedAt) : null;
    const authored = cards.get(key)?.freshnessStartedAt;
    const freshSince = checked ?? (authored ? Date.parse(authored) : null);
    if (policy.rate === 'fast' && used.has(key) && (freshSince === null || freshSince < session))
      status.reasons.push('Fast: check at use.');
    if (
      policy.rate === 'medium' &&
      policy.cadenceDays &&
      (freshSince === null || now - freshSince >= policy.cadenceDays * 86400000)
    )
      status.reasons.push(
        `Review every ${policy.cadenceDays} days${freshSince === null ? '; no freshness baseline' : ''}.`,
      );
    if (policy.rate === 'slow' && used.has(key) && (freshSince === null || freshSince < session))
      status.reasons.push('Slow: review on resumed work.');
  }
  for (const [key, dependencies] of sources) {
    const status = result[key];
    if (!status) continue;
    const validation = validations.get(key);
    for (const source of dependencies) {
      const current = cards.get(memoryKey(source.target));
      const revision = source.availability === 'unavailable' ? null : (current?.contentRevision ?? null);
      status.observations[source.key] = revision;
      const observed = validation ? validation.sourceRevisions?.[source.key] : source.baseline;
      const title = current ? String(current.data.title ?? current.id) : 'Unavailable source';
      if (!current) status.reasons.push('A dependency source is unavailable; no fresh check.');
      else if (source.availability === 'unavailable')
        status.reasons.push(`${title}: source unavailable; cached content is not a fresh check.`);
      else if (observed !== revision || (!validation && ['contradicts', 'supersedes'].includes(source.kind)))
        status.reasons.push(`${source.kind}: ${title}${observed === undefined ? ' needs review' : ' changed'}.`);
    }
  }
  // Fixed point, not recursive traversal: cycles cannot overflow and unrelated links never propagate.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [key, status] of Object.entries(result)) {
      if (status.due || status.retired) continue;
      const sourceDue = (sources.get(key) ?? []).some((source) => {
        const upstream = result[memoryKey(source.target)];
        return upstream?.due || upstream?.retired;
      });
      if (status.reasons.length || sourceDue) {
        if (sourceDue) status.reasons.push('An explicit source needs review.');
        status.due = true;
        changed = true;
      }
    }
  }
  for (const [key, status] of Object.entries(result)) {
    const references: Source[] = [...(sources.get(key) ?? [])];
    const boardId = portals.get(key);
    if (boardId) {
      const board = reads.find((entry) => entry.board.id === boardId);
      if (!board?.read) references.push({ key: boardId, target: { boardId }, kind: 'portal' });
      else
        for (const node of board.read.layout.nodes)
          references.push({ key: node.id, target: { boardId, cardId: node.id }, kind: 'portal' });
    }
    for (const source of references) {
      const sourceKey = memoryKey(source.target);
      const qualification = result[sourceKey];
      const node = cards.get(sourceKey);
      if (
        qualification &&
        !qualification.due &&
        !qualification.retired &&
        source.availability !== 'cached' &&
        source.availability !== 'unavailable'
      )
        continue;
      status.sources.push({
        ...source.target,
        title: node ? String(node.data.title ?? node.id) : 'Unavailable source',
        reasons:
          source.availability === 'unavailable'
            ? ['Source unavailable; no fresh check.']
            : source.availability === 'cached'
              ? ['Cached observation; not freshly checked.', ...(qualification?.reasons ?? [])]
              : qualification
                ? qualification.retired
                  ? ['Source is retired.']
                  : qualification.reasons
                : ['Source unavailable; no fresh check.'],
        ...(node ? { contentRevision: node.contentRevision ?? 0 } : { unavailable: true as const }),
        ...(source.baseline !== undefined ? { observedRevision: source.baseline } : {}),
        ...(source.observedAt ? { observedAt: source.observedAt } : {}),
      });
    }
  }
  const reviewCards: ReviewCardSummary[] = [];
  for (const { board, read } of reads) {
    for (const node of read?.layout.nodes ?? []) {
      const status = result[memoryKey({ boardId: board.id, cardId: node.id })];
      if (!status || status.retired || !(status.due || status.sources.length)) continue;
      reviewCards.push({
        boardId: board.id,
        cardId: node.id,
        boardTitle: board.name,
        folder: board.folder,
        title: String(node.data.title || 'Untitled card'),
      });
    }
  }
  return { cards: result, reviewCards };
}
