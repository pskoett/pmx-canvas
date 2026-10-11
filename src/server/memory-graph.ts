import { canvasState } from './canvas-state.js';
import { summarizeNodeForAgentContext } from '../shared/agent-context.js';
import {
  memoryKey,
  wikiLinksFromData,
  type MemoryGraph,
  type MemoryGraphEdge,
  type MemoryGraphNode,
  type MemoryTarget,
} from '../shared/memory-graph.js';

/** One library projection for Home, backlinks, brief discovery and agent exploration. No writes. */
export function memoryGraph(projection: 'full' | 'boards' = 'full'): MemoryGraph {
  const boards = canvasState.listBoards();
  const reads = boards.map((board) => ({ board, read: canvasState.readBoard(board.id, false) }));
  const keys = new Set<string>();
  const nodes: MemoryGraphNode[] = [];
  const edges: MemoryGraphEdge[] = [];
  const unresolvedLinks: MemoryGraph['unresolvedLinks'] = [];
  const add = (
    kind: MemoryGraphEdge['kind'],
    id: string,
    source: MemoryTarget,
    target: MemoryTarget,
    label?: string,
    type?: string,
  ) => {
    edges.push({
      id,
      kind,
      from: memoryKey(source),
      to: memoryKey(target),
      source,
      target,
      missing: false,
      ...(label ? { label } : {}),
      ...(type ? { type } : {}),
    });
  };
  for (const { board, read } of reads) {
    const readme = read?.layout.nodes.find((node) => node.id === board.readmeNodeId);
    const summary = (node: NonNullable<typeof read>['layout']['nodes'][number]) =>
      summarizeNodeForAgentContext(node, { defaultTextLength: 280, webpageTextLength: 280 }).slice(0, 280);
    nodes.push({
      key: memoryKey({ boardId: board.id }),
      boardId: board.id,
      kind: 'board',
      title: board.name,
      summary: readme ? summary(readme) : '',
      folder: board.folder,
      inContext: !!board.pin,
      summaryOnly: true,
      nodeCount: board.nodeCount,
      ...(board.mapPosition ? { position: board.mapPosition } : {}),
    });
    keys.add(memoryKey({ boardId: board.id }));
    if (board.previousBoardId)
      add(
        'previous',
        `previous:${board.id}`,
        { boardId: board.id },
        { boardId: board.previousBoardId },
        'previous board',
      );
    for (const node of read?.layout.nodes ?? []) {
      const source = { boardId: board.id, cardId: node.id };
      keys.add(memoryKey(source));
      if (projection === 'full')
        nodes.push({
          ...source,
          key: memoryKey(source),
          kind: 'card',
          title: typeof node.data.title === 'string' ? node.data.title : node.id,
          summary: summary(node),
          folder: board.folder,
          type: node.type,
          summaryOnly: true,
          linksRevision: node.linksRevision ?? 0,
          inContext: !!board.pin || !!read?.state.contextPins.includes(node.id),
        });
      if (projection === 'full') add('member', `member:${memoryKey(source)}`, { boardId: board.id }, source);
      if (node.type === 'board' && typeof node.data.boardId === 'string') {
        add('portal', `portal:${memoryKey(source)}`, source, { boardId: node.data.boardId });
      }
      for (const link of node.type === 'markdown' ? wikiLinksFromData(node.data) : []) {
        if (link.target) add('wiki', `wiki:${memoryKey(source)}:${link.ref}`, source, link.target, link.ref);
        else unresolvedLinks.push({ source, ref: link.ref });
      }
    }
    for (const edge of read?.layout.edges ?? []) {
      add(
        'card',
        `card:${board.id}:${edge.id}`,
        { boardId: board.id, cardId: edge.from },
        { boardId: edge.toBoardId ?? board.id, cardId: edge.to },
        edge.label,
        edge.type,
      );
    }
  }
  for (const edge of edges) edge.missing = !keys.has(edge.from) || !keys.has(edge.to);
  const graph = { nodes, edges, unresolvedLinks, focus: null, depth: 2 };
  return projection === 'boards' ? boardMemoryGraph(graph) : graph;
}

/** Keep original qualified endpoints and missing evidence, without card summaries or membership. */
export function boardMemoryGraph(graph: MemoryGraph): MemoryGraph {
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => node.kind === 'board'),
    edges: graph.edges.filter(
      (edge) => edge.kind !== 'member' && (edge.missing || edge.source.boardId !== edge.target.boardId),
    ),
  };
}

/** Board-level connections are a collapse of the SAME edges, not another link scanner. */
export function boardConnections(graph: MemoryGraph): MemoryGraphEdge[] {
  return graph.edges.filter((edge) => edge.kind !== 'member' && edge.source.boardId !== edge.target.boardId);
}

/** Undirected exploration. Membership is a hop too; focus accepts a board ID, qualified key, or pins. */
export function localMemoryGraph(graph: MemoryGraph, focus: string | null, depth: number): MemoryGraph {
  if (!focus) return { ...graph, depth };
  const seed =
    focus === 'pins'
      ? graph.nodes.filter((node) => node.inContext).map((node) => node.key)
      : graph.nodes
          .filter((node) => node.key === focus || (node.kind === 'board' && node.boardId === focus))
          .map((node) => node.key);
  const selected = new Set(seed);
  let frontier = new Set(seed);
  for (let level = 0; level < depth; level++) {
    const next = new Set<string>();
    for (const edge of graph.edges) {
      if (edge.missing) continue;
      if (frontier.has(edge.from) && !selected.has(edge.to)) next.add(edge.to);
      if (frontier.has(edge.to) && !selected.has(edge.from)) next.add(edge.from);
    }
    for (const key of next) selected.add(key);
    frontier = next;
  }
  const edges = graph.edges.filter((edge) => selected.has(edge.from) && (selected.has(edge.to) || edge.missing));
  const deliveredEdges = new Set(edges.map((edge) => edge.id));
  return {
    nodes: graph.nodes
      .filter((node) => selected.has(node.key))
      .map((node) => ({
        ...node,
        linksComplete: graph.edges.every(
          (edge) =>
            edge.kind === 'member' || (edge.from !== node.key && edge.to !== node.key) || deliveredEdges.has(edge.id),
        ),
      })),
    edges,
    unresolvedLinks: graph.unresolvedLinks.filter((link) => selected.has(memoryKey(link.source))),
    focus,
    depth,
  };
}
