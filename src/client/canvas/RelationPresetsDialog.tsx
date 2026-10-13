import { useRef, useState } from 'preact/hooks';
import type { RelationDefinition, RelationPreset } from '../../shared/relations.js';
import { boardList, updateBoard } from '../state/boards-store';
import { requestJson } from '../state/intent-bridge';
import { knowledge, refreshKnowledge } from '../state/knowledge-store';
import { useFocusTrap } from './use-focus-trap';

/** Shared templates live in Home; applying one never rewrites connection kinds. */
export function RelationPresetsDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true);
  const presets = knowledge.value?.relationPresets;
  const [editing, setEditing] = useState<RelationPreset | null>(() =>
    presets?.[0] ? structuredClone(presets[0]) : null,
  );
  const [boardId, setBoardId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const existing = presets?.find((preset) => preset.id === editing?.id);
  const changeKind = (index: number, change: Partial<RelationDefinition>) => {
    if (editing)
      setEditing({
        ...editing,
        vocabulary: editing.vocabulary.map((kind, i) => (i === index ? { ...kind, ...change } : kind)),
      });
  };
  return (
    <div
      class="knowledge-backdrop"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div
        ref={ref}
        class="knowledge-dialog is-category-editor"
        role="dialog"
        aria-modal="true"
        aria-label="Workspace relation presets"
      >
        <header>
          <h2>Workspace relation presets</h2>
          <button type="button" aria-label="Close relation presets" onClick={onClose}>
            ×
          </button>
        </header>
        <p>Shared across the workspace. Editing a template does not change existing boards or connections.</p>
        {message && <p role="status">{message}</p>}
        {!presets ? (
          <p>Relation presets unavailable. Close and retry.</p>
        ) : (
          <div class="category-editor-columns">
            <section>
              <h3>{presets.length} presets</h3>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setEditing({ id: crypto.randomUUID(), name: '', vocabulary: [] });
                  setConfirmDelete(false);
                  setMessage('');
                }}
              >
                Add preset
              </button>
              <div class="category-library" role="group" aria-label="Workspace relation presets">
                {presets.map((preset) => (
                  <button
                    type="button"
                    class="category-choice"
                    key={preset.id}
                    disabled={busy}
                    aria-pressed={editing?.id === preset.id}
                    onClick={() => {
                      setEditing(structuredClone(preset));
                      setConfirmDelete(false);
                      setMessage('');
                    }}
                  >
                    <strong>{preset.name}</strong>
                    <span>{preset.vocabulary.map((kind) => kind.kind).join(' · ') || 'No relation kinds'}</span>
                  </button>
                ))}
              </div>
            </section>
            {editing && (
              <form
                class="relation-vocabulary"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (busy) return;
                  if (new Set(editing.vocabulary.map((kind) => kind.kind.trim())).size !== editing.vocabulary.length) {
                    setMessage('Give each relation kind a unique name.');
                    return;
                  }
                  setBusy(true);
                  const result = await requestJson<{ ok: boolean } | null>(
                    'relationPresetWrite',
                    '/api/canvas/knowledge/relation-preset',
                    null,
                    {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ preset: editing }),
                    },
                  );
                  await refreshKnowledge();
                  setBusy(false);
                  setMessage(
                    result?.ok
                      ? 'Preset saved for the workspace. Existing boards are unchanged.'
                      : 'Preset was not saved. Retry.',
                  );
                }}
              >
                <h3>{existing ? 'Edit shared preset' : 'New shared preset'}</h3>
                <label>
                  Name
                  <input
                    required
                    pattern={'.*\\S.*'}
                    maxLength={80}
                    disabled={busy}
                    value={editing.name}
                    onInput={(event) => setEditing({ ...editing, name: event.currentTarget.value })}
                  />
                </label>
                <p>Kinds stay open. Choose meaning ink and direction, not pin, agent or warning colours.</p>
                {editing.vocabulary.map((kind, index) => (
                  <div class="vocabulary-row" key={index}>
                    <input
                      required
                      pattern={'.*\\S.*'}
                      aria-label={`Kind ${index + 1}`}
                      maxLength={80}
                      disabled={busy}
                      value={kind.kind}
                      onInput={(event) => changeKind(index, { kind: event.currentTarget.value })}
                    />
                    <select
                      aria-label={`Ink ${index + 1}`}
                      disabled={busy}
                      value={kind.ink}
                      onChange={(event) =>
                        changeKind(index, { ink: event.currentTarget.value as RelationDefinition['ink'] })
                      }
                    >
                      {['supports', 'contradicts', 'cites', 'derived', 'informs', 'related'].map((ink) => (
                        <option key={ink}>{ink}</option>
                      ))}
                    </select>
                    <label>
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={kind.directed}
                        onChange={(event) => changeKind(index, { directed: event.currentTarget.checked })}
                      />
                      Arrow
                    </label>
                    <button
                      type="button"
                      aria-label={`Remove kind ${index + 1}`}
                      disabled={busy}
                      onClick={() =>
                        setEditing({ ...editing, vocabulary: editing.vocabulary.filter((_, i) => i !== index) })
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  disabled={busy || editing.vocabulary.length >= 64}
                  onClick={() =>
                    setEditing({
                      ...editing,
                      vocabulary: [...editing.vocabulary, { kind: '', ink: 'related', directed: true }],
                    })
                  }
                >
                  Add kind
                </button>
                <button type="submit" disabled={busy}>
                  Save preset
                </button>
                {existing && (
                  <>
                    <label>
                      Apply saved preset to board
                      <select
                        aria-label="Apply saved preset to board"
                        disabled={busy}
                        value={boardId}
                        onChange={(event) => setBoardId(event.currentTarget.value)}
                      >
                        <option value="">Choose a board</option>
                        {boardList.value.map((board) => (
                          <option key={board.id} value={board.id}>
                            {board.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={busy || !boardId}
                      onClick={async () => {
                        if (busy || !boardId) return;
                        setBusy(true);
                        const saved = await updateBoard(boardId, { relationVocabulary: existing.vocabulary });
                        setBusy(false);
                        setMessage(
                          saved
                            ? 'Preset applied. Existing connections and other boards are unchanged.'
                            : 'Preset was not applied. Retry.',
                        );
                      }}
                    >
                      Apply saved preset
                    </button>
                    {confirmDelete ? (
                      <div role="group" aria-label="Confirm preset deletion">
                        <p>Delete {existing.name}? Boards that used it keep their existing vocabulary.</p>
                        <button type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>
                          Cancel deletion
                        </button>
                        <button
                          type="button"
                          class="is-danger"
                          disabled={busy}
                          onClick={async () => {
                            if (busy) return;
                            setBusy(true);
                            const result = await requestJson<{ ok: boolean } | null>(
                              'relationPresetRemove',
                              `/api/canvas/knowledge/relation-preset/${encodeURIComponent(existing.id)}`,
                              null,
                              { method: 'DELETE' },
                            );
                            await refreshKnowledge();
                            setBusy(false);
                            setConfirmDelete(false);
                            if (result?.ok) setEditing(null);
                            setMessage(
                              result?.ok
                                ? 'Preset deleted. Existing boards are unchanged.'
                                : 'Preset was not deleted. Retry.',
                            );
                          }}
                        >
                          Confirm deletion
                        </button>
                      </div>
                    ) : (
                      <button type="button" class="is-danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
                        Delete preset
                      </button>
                    )}
                  </>
                )}
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
