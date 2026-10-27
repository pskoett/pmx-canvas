import type { ActorAttribution } from './attribution.js';
import { createEmptyAxState } from './ax-state.js';
import type { CanvasBoard, PersistedCanvasState } from './canvas-db.js';
import type { CanvasNodeState } from './canvas-state.js';
import type { DocumentImport } from './document-import.js';
import { OperationError } from './operations/types.js';

export interface BoardMoveInput {
  sourceBoardId: string;
  nodeIds: string[];
  name: string;
  expectedRevision: number;
  requestId: string;
  preview?: boolean;
}

export interface BoardMovePreview {
  sourceBoardId: string;
  nodeIds: string[];
  affectedBoardIds: string[];
  readmeNodeId: string | null;
  pinnedNodeIds: string[];
  liveTaskNodeIds: string[];
  attachmentIds: string[];
  blockers: string[];
  notices: string[];
}

export interface BoardMoveResult {
  sourceBoardId: string;
  destinationBoardId: string;
  portalId: string;
  nodeIds: string[];
  affectedBoardIds: string[];
}

export interface MoveBoard {
  board: CanvasBoard;
  state: PersistedCanvasState;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function attachmentId(node: CanvasNodeState): string | undefined {
  const value = node.data.attachmentId ?? record(node.data.source)?.attachmentId;
  return typeof value === 'string' ? value : undefined;
}

/** Pure relocation plan. Preview and commit run the same checks on a consistent library view. */
export function prepareBoardMove(
  input: BoardMoveInput,
  library: Map<string, MoveBoard>,
  destinationId: string,
  portalId: string,
  imports: DocumentImport[],
  runtimeBlockers: ReadonlyMap<string, string>,
  actor: ActorAttribution,
  at: string,
): { preview: BoardMovePreview; states: Map<string, PersistedCanvasState> } {
  const source = library.get(input.sourceBoardId);
  if (!source) throw new OperationError('Source board not found.', 404);
  if (input.expectedRevision !== (source.state.revisionState?.revision ?? 0))
    throw new OperationError('The source board changed. Preview the move again.', 409);
  if (!input.nodeIds.length) throw new OperationError('Select at least one card to move.');
  const nodes = new Map(source.state.nodes.map((node) => [node.id, node]));
  const moving = new Set<string>();
  const include = (id: string) => {
    if (moving.has(id)) return;
    const node = nodes.get(id);
    if (!node) throw new OperationError(`Selected card "${id}" no longer exists.`, 409);
    moving.add(id);
    if (node.type === 'group') {
      for (const child of strings(node.data.children)) include(child);
      for (const child of nodes.values()) if (child.data.parentGroup === id) include(child.id);
    }
  };
  for (const id of input.nodeIds) include(id);
  const blockers = new Set<string>();
  const movedAttachments = new Set<string>();
  const liveTasks: string[] = [];
  const blocks = (id: string, reason: string) => blockers.add(`${id}: ${reason}`);
  for (const node of source.state.nodes) {
    const moves = moving.has(node.id);
    const data = node.data;
    if (moves) {
      const runtime = runtimeBlockers.get(node.id);
      if (runtime) blocks(node.id, runtime);
      if (
        data.streamStatus === 'open' ||
        data._activeResponseId ||
        (['prompt', 'response'].includes(node.type) &&
          ['pending', 'sending', 'streaming'].includes(String(data.threadStatus ?? data.status)))
      )
        blocks(node.id, 'finish the active producer before moving this card');
      if (
        (node.type === 'context' && node.id === 'context-main') ||
        (node.type === 'status' && node.id === 'status-main')
      )
        blocks(node.id, 'this presentation is owned by the host adapter');
      if (data.appSessionId || data.transportConfig || data.sessionStatus === 'reconnecting')
        blocks(node.id, 'the external app binding cannot be relocated without reconnecting');
      if (data.workboard || data.axStep || data.axFlow || data.axFlowId)
        blocks(node.id, 'materialized task/flow controls retain authority on this board');
      if (node.type === 'status' && typeof data.workItemId === 'string') liveTasks.push(node.id);
      const attachment = attachmentId(node);
      if (attachment) movedAttachments.add(attachment);
      if (
        ['html', 'json-render', 'graph', 'mcp-app'].includes(node.type) &&
        /ax[.:](work|approval|flow|elicitation|mode)|data-ax-|\/api\/canvas\/ax/.test(JSON.stringify(data))
      )
        blocks(node.id, 'embedded action targets cannot retain their board authority after this move');
    }
    // Declared local bindings are not opaque strings to rewrite. Both ends must move together.
    const local = [
      ...strings(data.embeddedNodeIds),
      ...strings(data.contextNodeIds),
      data.embeddedNodeId,
      data.embeddedGraphId,
      data.sourceNodeId,
      data.promptNodeId,
      data.responseNodeId,
      data.parentNodeId,
    ].filter((id): id is string => typeof id === 'string');
    for (const text of [data.url, data.html, data.content, ...strings(data.embeddedUrls)]) {
      if (typeof text !== 'string') continue;
      for (const match of text.matchAll(/\/api\/canvas\/[^\s"'<>]+/g)) {
        const url = new URL(match[0].replaceAll('&amp;', '&'), 'http://canvas.local');
        let target =
          url.pathname === '/api/canvas/json-render/view' || url.pathname === '/api/canvas/file-bytes'
            ? url.searchParams.get('nodeId')
            : url.pathname.match(/^\/api\/canvas\/image\/(.+)$/)?.[1];
        if (url.pathname.startsWith('/api/canvas/surface/')) {
          try {
            target = decodeURIComponent(url.pathname.slice('/api/canvas/surface/'.length));
          } catch {
            // Malformed examples in authored text cannot resolve to a surface.
            continue;
          }
        }
        if (target) local.push(target);
      }
    }
    for (const id of local)
      if (moving.has(id) !== moves)
        blocks(node.id, `include both ends of the local viewer/content reference to "${id}"`);
  }
  for (const node of source.state.nodes) {
    const attachment = attachmentId(node);
    if (attachment && movedAttachments.has(attachment) && !moving.has(node.id))
      blocks(node.id, 'include every card sharing this attachment/import');
  }
  for (const job of imports) {
    if (!movedAttachments.has(job.attachmentId) && !job.committedNodeIds.some((id) => moving.has(id))) continue;
    if (job.status === 'requested' || job.status === 'drafted')
      blocks(job.id, 'finish or cancel the document import first');
    if (!movedAttachments.has(job.attachmentId) || job.committedNodeIds.some((id) => !moving.has(id)))
      blocks(job.id, 'include the original attachment and every imported section');
  }
  for (const stop of source.state.tour?.stops ?? []) {
    if ('nodeId' in stop.target && moving.has(stop.target.nodeId))
      blocks(stop.target.nodeId, 'a source-board tour targets this card; remove that stop before moving');
  }
  const ax = source.state.ax ?? createEmptyAxState();
  for (const item of [...ax.workItems, ...ax.approvalGates, ...ax.elicitations, ...ax.modeRequests]) {
    for (const id of item.nodeIds)
      if (moving.has(id)) blocks(id, `board-owned work/approval/input record "${item.id}" anchors this card`);
  }
  for (const review of ax.reviewAnnotations)
    if (review.nodeId && moving.has(review.nodeId))
      blocks(review.nodeId, `board-local review annotation "${review.id}" anchors this card`);

  const states = new Map<string, PersistedCanvasState>();
  const destination: PersistedCanvasState = {
    version: 1,
    theme: source.state.theme,
    viewport: { x: 0, y: 0, scale: 1 },
    nodes: [],
    edges: [],
    contextPins: [],
    contextPinMeta: {},
    annotations: [],
    ax: createEmptyAxState(),
  };
  const locate = (boardId: string, cardId: string) =>
    boardId === input.sourceBoardId && moving.has(cardId) ? destinationId : boardId;
  for (const [boardId, entry] of library) {
    const state = structuredClone(entry.state);
    const prior = JSON.stringify(state);
    state.edges = state.edges.flatMap((edge) => {
      const owner = locate(boardId, edge.from);
      const target = locate(edge.toBoardId ?? boardId, edge.to);
      const next = { ...edge };
      if (target === owner) delete next.toBoardId;
      else next.toBoardId = target;
      if (owner === destinationId) {
        destination.edges.push(next);
        return [];
      }
      return [next];
    });
    state.nodes = state.nodes.flatMap((node) => {
      const data = node.data;
      for (const link of Array.isArray(data.wikiLinks) ? data.wikiLinks : []) {
        const target = record(record(link)?.target);
        if (target?.boardId === input.sourceBoardId && typeof target.cardId === 'string' && moving.has(target.cardId))
          target.boardId = destinationId;
      }
      const provenance = record(data.provenance);
      for (const target of Array.isArray(provenance?.sources) ? provenance.sources : []) {
        const ref = record(target);
        if (ref?.boardId === input.sourceBoardId && typeof ref.cardId === 'string' && moving.has(ref.cardId))
          ref.boardId = destinationId;
      }
      if (boardId !== input.sourceBoardId) return [node];
      if (!moving.has(node.id)) {
        if (node.type === 'group') data.children = strings(data.children).filter((id) => !moving.has(id));
        return [node];
      }
      if (typeof data.parentGroup === 'string' && !moving.has(data.parentGroup)) delete data.parentGroup;
      if (node.type === 'status' && typeof data.workItemId === 'string') data.workItemBoardId ??= input.sourceBoardId;
      destination.nodes.push(node);
      if (state.contextPins.includes(node.id)) {
        destination.contextPins.push(node.id);
        const meta = state.contextPinMeta?.[node.id];
        if (meta) destination.contextPinMeta![node.id] = meta;
      }
      return [];
    });
    if (boardId === input.sourceBoardId) {
      state.contextPins = state.contextPins.filter((id) => !moving.has(id));
      for (const id of moving) if (state.contextPinMeta) delete state.contextPinMeta[id];
      if (state.ax) {
        state.ax.focus.nodeIds = state.ax.focus.nodeIds.filter((id) => !moving.has(id));
        if (state.ax.focus.primaryNodeId && moving.has(state.ax.focus.primaryNodeId))
          state.ax.focus.primaryNodeId = null;
      }
    }
    if (prior !== JSON.stringify(state) || boardId === input.sourceBoardId) states.set(boardId, state);
  }
  const revision =
    Math.max(
      source.state.revisionState?.revision ?? 0,
      ...destination.nodes.flatMap((node) => [node.contentRevision ?? 0, node.linksRevision ?? 0]),
      ...destination.edges.map((edge) => edge.revision ?? 0),
    ) + 1;
  const selected = [...moving].map((id) => nodes.get(id)!);
  states.get(input.sourceBoardId)!.nodes.push({
    id: portalId,
    type: 'board',
    data: { boardId: destinationId, title: input.name },
    position: {
      x: Math.min(...selected.map((node) => node.position.x)),
      y: Math.min(...selected.map((node) => node.position.y)),
    },
    size: { width: 360, height: 200 },
    zIndex: Math.max(...selected.map((node) => node.zIndex)),
    collapsed: false,
    pinned: false,
    createdBy: actor,
    lastEditedBy: actor,
    contentRevision: revision,
    contentChangedAt: at,
    freshnessStartedAt: at,
  });
  states.set(destinationId, destination);
  for (const state of states.values()) {
    const floor = Math.max(state.revisionState?.revision ?? 0, revision) + 1;
    state.revisionState = { revision: floor, floor, tombstones: [] };
  }
  return {
    states,
    preview: {
      sourceBoardId: input.sourceBoardId,
      nodeIds: [...moving].sort(),
      affectedBoardIds: [...states.keys()].filter((id) => id !== destinationId).sort(),
      readmeNodeId:
        source.board.readmeNodeId && moving.has(source.board.readmeNodeId) ? source.board.readmeNodeId : null,
      pinnedNodeIds: destination.contextPins,
      liveTaskNodeIds: liveTasks,
      attachmentIds: [...movedAttachments],
      blockers: [...blockers],
      notices: [
        'Moves the original cards and leaves a portal. This is not a copy.',
        'Pre-move Undo/Redo is cleared on affected boards. Older snapshots remain inspectable but cannot be restored across the move.',
        'Board-space annotations stay on the source. Live tasks keep their original owner.',
      ],
    },
  };
}
