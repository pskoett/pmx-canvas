import { memoryKey, type MemoryGraphEdge, type MemoryGraphNode } from '../../shared/memory-graph.js';

export interface GraphConnection {
  key: string;
  from: string;
  to: string;
  kind: MemoryGraphEdge['kind'];
  exact: boolean;
  edges: MemoryGraphEdge[];
  incident: number;
}

/** A view projection only: qualified raw evidence, direction and revisions stay untouched. */
export function graphDisplay(
  nodes: MemoryGraphNode[],
  edges: MemoryGraphEdge[],
  options: {
    expanded: ReadonlySet<string>;
    eligible: ReadonlySet<string>;
    hiddenLinks: ReadonlySet<MemoryGraphEdge['kind']>;
    selectedKey: string | null;
    showBoards: boolean;
    showCards: boolean;
  },
) {
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const visible = nodes.filter(
    (node) =>
      options.eligible.has(node.key) &&
      (node.kind === 'board' ? options.showBoards : options.showCards && options.expanded.has(node.boardId)),
  );
  const keys = new Set(visible.map((node) => node.key));
  const selected = byKey.get(options.selectedKey ?? '');
  const incident = (edge: MemoryGraphEdge) =>
    selected
      ? selected.kind === 'board'
        ? edge.source.boardId === selected.boardId || edge.target.boardId === selected.boardId
        : edge.from === selected.key || edge.to === selected.key
      : false;
  const endpoint = (key: string, boardId: string) => {
    const node = byKey.get(key);
    if (!node || !options.eligible.has(key)) return null;
    if (keys.has(key)) return key;
    const parent = memoryKey({ boardId });
    return keys.has(parent) ? parent : null;
  };
  const connections = new Map<string, GraphConnection>();
  const internal = new Map<string, number>();
  const neighbors = new Set<string>(selected ? [selected.key] : []);
  let exactCount = 0;
  let bundledCount = 0;
  for (const edge of edges) {
    if (options.hiddenLinks.has(edge.kind)) continue;
    const from = endpoint(edge.from, edge.source.boardId);
    const to = endpoint(edge.to, edge.target.boardId);
    if (edge.kind === 'member') {
      if (!keys.has(edge.from) || !keys.has(edge.to)) continue;
    } else if (incident(edge)) {
      if (from) neighbors.add(from);
      if (to) neighbors.add(to);
    }
    if ((!from || !to) && !edge.missing) continue;
    if (!from && !to) continue;
    const exact = from === edge.from && to === edge.to;
    if (!edge.missing && !exact && from === to) {
      internal.set(edge.source.boardId, (internal.get(edge.source.boardId) ?? 0) + 1);
      continue;
    }
    if (edge.kind !== 'member') {
      if (exact) exactCount++;
      else if (!edge.missing) bundledCount++;
    }
    // A neutral bundle may mix directions and kinds of card evidence. It has no
    // arrow or representative reason; the inspector retains each authored edge.
    const ends = [from ?? edge.from, to ?? edge.to];
    const key =
      exact || edge.missing || edge.kind === 'member' ? edge.id : JSON.stringify([edge.kind, ...[...ends].sort()]);
    const previous = connections.get(key);
    if (previous) {
      previous.edges.push(edge);
      previous.incident += Number(incident(edge));
    } else {
      connections.set(key, {
        key,
        from: ends[0],
        to: ends[1],
        kind: edge.kind,
        exact,
        edges: [edge],
        incident: edge.kind === 'member' ? 0 : Number(incident(edge)),
      });
    }
  }
  return { nodes: visible, connections: [...connections.values()], internal, neighbors, exactCount, bundledCount };
}
