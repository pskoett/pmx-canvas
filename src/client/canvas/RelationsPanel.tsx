import { useEffect, useState } from 'preact/hooks';
import { memoryKey, type MemoryGraph } from '../../shared/memory-graph.js';
import { relationDefinition, relationSourceEnd } from '../../shared/relations.js';
import { activeBoardId, boardList, openMemoryTarget } from '../state/boards-store';
import { edges, nodes } from '../state/canvas-store';
import { requestJson } from '../state/intent-bridge';

/** The expanded card's evidence and uses, from the same graph agents navigate. */
export function RelationsPanel({ nodeId }: { nodeId: string }) {
  const boardId = activeBoardId.value;
  const [graph, setGraph] = useState<MemoryGraph | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const currentEdges = edges.value;
  const currentNodes = nodes.value;
  const catalog = boardList.value;
  useEffect(() => {
    let cancelled = false;
    setGraph(null);
    setUnavailable(false);
    if (boardId)
      void requestJson<MemoryGraph | null>(
        'relations',
        `/api/canvas/memory-graph?focus=${encodeURIComponent(memoryKey({ boardId, cardId: nodeId }))}&depth=1`,
        null,
      ).then((result) => {
        if (!cancelled) {
          setGraph(result);
          setUnavailable(!result);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [boardId, nodeId, currentEdges, currentNodes, catalog]);
  const key = boardId ? memoryKey({ boardId, cardId: nodeId }) : '';
  const relations =
    graph?.edges.filter((edge) => edge.kind !== 'member' && (edge.from === key || edge.to === key)) ?? [];
  const group = (edge: (typeof relations)[number]) => {
    const incoming = edge.to === key;
    if (incoming && edge.relationKind === 'supports') return 'Evidence for';
    if (incoming && edge.relationKind === 'contradicts') return 'Evidence against';
    const source = relationSourceEnd({ kind: edge.relationKind, type: edge.type });
    if (source) return (source === 'from' ? !incoming : incoming) ? 'Used by' : 'Sources';
    if (edge.relationKind === 'cites' || edge.type === 'references') return incoming ? 'Used by' : 'Sources';
    if (!incoming && edge.relationKind === 'supports') return 'Used by';
    return 'Connections';
  };
  const groups = ['Evidence for', 'Evidence against', 'Sources', 'Used by', 'Connections'];
  relations.sort((a, b) => groups.indexOf(group(a)) - groups.indexOf(group(b)));
  return (
    <aside class="relations-panel" aria-label="Relations">
      <h3>Relations</h3>
      {!graph && <p role="status">{unavailable ? 'Relations unavailable. Reopen to retry.' : 'Loading relations…'}</p>}
      {graph && relations.length === 0 && <p>No connections yet.</p>}
      {relations.map((edge, index) => {
        const outgoing = edge.from === key;
        const target = outgoing ? edge.target : edge.source;
        const other = graph?.nodes.find((item) => item.key === memoryKey(target));
        const owner = catalog.find((board) => board.id === edge.source.boardId);
        const definition = relationDefinition({ kind: edge.relationKind, type: edge.type }, owner?.relationVocabulary);
        return (
          <div class="relation-row" key={edge.id}>
            {(index === 0 || group(relations[index - 1]) !== group(edge)) && <h4>{group(edge)}</h4>}
            <span class="relation-kind" style={{ color: `var(--c-rel-${definition.ink})` }}>
              {outgoing ? '→' : '←'} {edge.relationKind ?? edge.type ?? edge.kind}
            </span>
            {edge.missing ? (
              <span>Missing target</span>
            ) : (
              <button type="button" class="relation-target" onClick={() => void openMemoryTarget(target)}>
                {other?.title ?? target.boardId}
              </button>
            )}
            {edge.label && <span>{edge.label}</span>}
            <p>{edge.reason ?? 'No reason recorded.'}</p>
          </div>
        );
      })}
      <p>Manage shared relation presets in Home.</p>
    </aside>
  );
}
