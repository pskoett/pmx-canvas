import { useEffect, useState } from 'preact/hooks';
import { memoryKey, type MemoryGraph } from '../../shared/memory-graph.js';
import {
  RELATION_KINDS,
  relationDefinition,
  relationSourceEnd,
  type RelationDefinition,
} from '../../shared/relations.js';
import {
  activeBoard,
  activeBoardId,
  boardList,
  boardIncarnation,
  openMemoryTarget,
  updateBoard,
} from '../state/boards-store';
import { edges, nodes } from '../state/canvas-store';
import { requestJson } from '../state/intent-bridge';

/** The expanded card's evidence and uses, from the same graph agents navigate. */
export function RelationsPanel({ nodeId }: { nodeId: string }) {
  const boardId = activeBoardId.value;
  const [graph, setGraph] = useState<MemoryGraph | null>(null);
  const [editing, setEditing] = useState(false);
  const [vocabulary, setVocabulary] = useState<RelationDefinition[]>([]);
  const [error, setError] = useState('');
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
      <button
        type="button"
        class="home-button"
        onClick={() => {
          setVocabulary(structuredClone(activeBoard()?.relationVocabulary ?? RELATION_KINDS));
          setEditing(!editing);
          setError('');
        }}
      >
        Board vocabulary
      </button>
      {editing && (
        <form
          class="relation-vocabulary"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!boardId || activeBoardId.value !== boardId) return;
            if (
              vocabulary.some((item) => !item.kind.trim()) ||
              new Set(vocabulary.map((item) => item.kind.trim())).size !== vocabulary.length
            ) {
              setError('Give each kind a unique name.');
              return;
            }
            const incarnation = boardIncarnation;
            const saved = await updateBoard(boardId, { relationVocabulary: vocabulary });
            if (incarnation !== boardIncarnation) return;
            if (saved) setEditing(false);
            else setError('Vocabulary was not saved. Try again.');
          }}
        >
          <p>Kinds stay open. Inks use the six relation meanings, never pin, agent or warning colours.</p>
          {vocabulary.map((item, index) => (
            <div class="vocabulary-row" key={index}>
              <input
                aria-label={`Kind ${index + 1}`}
                value={item.kind}
                maxLength={80}
                onInput={(event) =>
                  setVocabulary(
                    vocabulary.map((old, i) => (i === index ? { ...old, kind: event.currentTarget.value } : old)),
                  )
                }
              />
              <select
                aria-label={`Ink ${index + 1}`}
                value={item.ink}
                onChange={(event) =>
                  setVocabulary(
                    vocabulary.map((old, i) =>
                      i === index ? { ...old, ink: event.currentTarget.value as RelationDefinition['ink'] } : old,
                    ),
                  )
                }
              >
                {['supports', 'contradicts', 'cites', 'derived', 'informs', 'related'].map((ink) => (
                  <option key={ink}>{ink}</option>
                ))}
              </select>
              <label>
                <input
                  type="checkbox"
                  checked={item.directed}
                  onChange={(event) =>
                    setVocabulary(
                      vocabulary.map((old, i) =>
                        i === index ? { ...old, directed: event.currentTarget.checked } : old,
                      ),
                    )
                  }
                />{' '}
                Arrow
              </label>
              <button
                type="button"
                aria-label={`Remove kind ${index + 1}`}
                onClick={() => setVocabulary(vocabulary.filter((_, i) => i !== index))}
              >
                ×
              </button>
            </div>
          ))}
          {error && <p role="alert">{error}</p>}
          <button
            type="button"
            class="home-button"
            disabled={vocabulary.length >= 64}
            onClick={() => setVocabulary([...vocabulary, { kind: '', ink: 'related', directed: true }])}
          >
            Add kind
          </button>
          <button type="submit" class="home-button">
            Save vocabulary
          </button>
        </form>
      )}
    </aside>
  );
}
