import { signal } from '@preact/signals';
import { useState } from 'preact/hooks';
import { RELATION_KINDS, relationKind } from '../../shared/relations.js';
import { activeBoard, activeBoardId, boardIncarnation } from '../state/boards-store';
import { edges, selectedEdgeId, viewport } from '../state/canvas-store';
import { removeEdgeFromClient, updateEdgeFromClient } from '../state/intent-bridge';
import type { CanvasEdge } from '../types';
import { canvasArea } from './canvas-area';

export const edgeEditorAnchor = signal<{ id: string; incarnation: number; point: { x: number; y: number } } | null>(
  null,
);

/** Like EdgeHint, the editor lives in App's screen layer, outside the transformed world. */
export function SelectedEdgeEditor() {
  const anchor = edgeEditorAnchor.value;
  const edge = anchor ? edges.value.get(anchor.id) : null;
  return anchor && edge && anchor.id === selectedEdgeId.value && anchor.incarnation === boardIncarnation ? (
    <EdgeEditor key={`${anchor.incarnation}:${edge.id}`} edge={edge} point={anchor.point} />
  ) : null;
}

/** Screen-sized controls anchored to the selected relation, not scaled with its SVG. */
export function EdgeEditor({ edge, point }: { edge: CanvasEdge; point: { x: number; y: number } }) {
  const [field, setField] = useState<'label' | 'reason' | 'kind' | null>(null);
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [incarnation] = useState(boardIncarnation);
  const [boardId] = useState(activeBoardId.value);
  const edit = (next: NonNullable<typeof field>) => {
    setField(next);
    setValue(next === 'kind' ? relationKind(edge) : (edge[next] ?? ''));
    setError('');
  };
  const save = async (patch: Parameters<typeof updateEdgeFromClient>[1] | null) => {
    if (pending || incarnation !== boardIncarnation) return;
    setPending(true);
    const result = patch
      ? await updateEdgeFromClient(edge.id, patch, boardId)
      : await removeEdgeFromClient(edge.id, boardId);
    if (incarnation !== boardIncarnation) return;
    setPending(false);
    if (result.ok) {
      setField(null);
      setError('');
      if (!patch && selectedEdgeId.value === edge.id) selectedEdgeId.value = null;
    } else setError('Change refused. Your draft is still here.');
  };
  const area = canvasArea();
  const view = viewport.value;
  const width = Math.min(320, area.width - 24);
  const x = Math.max(
    area.left + 12,
    Math.min(area.left + area.width - width - 12, area.left + point.x * view.scale + view.x - width / 2),
  );
  const y = Math.max(
    area.top + 8,
    Math.min(area.top + area.height - (field ? 180 : 60), area.top + point.y * view.scale + view.y + 20),
  );
  const kinds = [
    ...new Set(
      [...RELATION_KINDS, ...(activeBoard()?.relationVocabulary ?? [])]
        .map((item) => item.kind)
        .concat(relationKind(edge)),
    ),
  ];
  return (
    <form
      class="edge-editor"
      aria-label="Edit relation"
      style={{ left: x, top: y, width }}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape' && !pending) {
          event.preventDefault();
          setField(null);
          selectedEdgeId.value = null;
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (field) void save({ [field]: value });
      }}
    >
      <fieldset disabled={pending}>
        <div class="edge-editor-tools">
          <select
            aria-label="Relation kind"
            value={relationKind(edge)}
            onChange={(event) => {
              const kind = event.currentTarget.value;
              if (kind === '__custom') edit('kind');
              else {
                setField('kind');
                setValue(kind);
                void save({ kind });
              }
            }}
          >
            {kinds.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
            <option value="__custom">Custom…</option>
          </select>
          <button type="button" onClick={() => edit('label')}>
            Label
          </button>
          <button type="button" onClick={() => edit('reason')}>
            Why
          </button>
          <button type="button" onClick={() => void save(null)}>
            Delete
          </button>
        </div>
        {field && (
          <div class="edge-editor-field">
            <label>
              {field === 'reason' ? 'Why this relation?' : field === 'label' ? 'Label' : 'Custom kind'}
              <input
                autoFocus
                value={value}
                required={field === 'kind'}
                maxLength={field === 'kind' ? 80 : field === 'reason' ? 4000 : 1000}
                onInput={(event) => setValue(event.currentTarget.value)}
              />
            </label>
            <div>
              <button type="submit">Save</button>{' '}
              <button
                type="button"
                onClick={() => {
                  setField(null);
                  setError('');
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
      </fieldset>
    </form>
  );
}
