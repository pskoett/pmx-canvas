import { useEffect, useRef, useState } from 'preact/hooks';
import type { RelationDefinition, RelationPreset } from '../../shared/relations.js';
import { boardList, updateBoard } from '../state/boards-store';
import { requestJson } from '../state/intent-bridge';
import { knowledge, refreshKnowledge } from '../state/knowledge-store';
import { useFocusTrap } from './use-focus-trap';
import { submitWithoutNavigation } from './submit-without-navigation';

/** Shared templates live in Home; applying one never rewrites connection kinds. */
export function RelationPresetsDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const presets = knowledge.value?.relationPresets;
  // Until the user chooses, the first saved preset follows catalog availability.
  // Explicit null (new/deleted preset) must not silently select another template.
  const [selection, setSelected] = useState<RelationPreset | null | undefined>();
  const selected = selection === undefined ? (presets?.[0] ?? null) : selection;
  const [editing, setEditing] = useState<RelationPreset | null>(null);
  const [baseline, setBaseline] = useState<RelationPreset | null>(null);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [boardId, setBoardId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const guardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pending) return;
    const previous = document.activeElement;
    guardRef.current?.querySelector('button')?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [pending]);
  const existing = selected;
  const dirty = editing !== null && JSON.stringify(editing) !== JSON.stringify(baseline);
  const leave = (action: () => void) => {
    if (busy) return;
    if (dirty) setPending(() => action);
    else action();
  };
  const handleEscape = () => {
    if (pending) setPending(null);
    else if (confirmDelete) setConfirmDelete(false);
    else leave(onClose);
  };
  useFocusTrap(ref, true, { onEscape: handleEscape });
  const choose = (preset: RelationPreset | null) => {
    setSelected(preset ? structuredClone(preset) : null);
    setEditing(null);
    setBaseline(null);
    setConfirmDelete(false);
    setMessage('');
  };
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
          event.preventDefault();
          event.stopPropagation();
          handleEscape();
        }
      }}
    >
      <div
        ref={ref}
        class="knowledge-dialog is-category-editor relation-presets-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Workspace relation presets"
      >
        <header>
          <h2>Workspace relation presets</h2>
          <button
            type="button"
            disabled={busy || !!pending}
            aria-label="Close relation presets"
            onClick={() => leave(onClose)}
          >
            ×
          </button>
        </header>
        <p>Saved templates are shared across the workspace. Saving does not apply a preset to any board.</p>
        {message && <p role="status">{message}</p>}
        {pending && (
          <div
            ref={guardRef}
            role="alertdialog"
            aria-label="Discard preset changes"
            aria-modal="true"
            class="relation-dirty-guard"
          >
            <p>Discard unsaved preset changes?</p>
            <button type="button" onClick={() => setPending(null)}>
              Keep editing
            </button>
            <button
              type="button"
              onClick={() => {
                const action = pending;
                setPending(null);
                action();
              }}
            >
              Discard changes
            </button>
          </div>
        )}
        <div inert={pending ? true : undefined}>
          {!presets ? (
            <p>Relation presets unavailable. Close and retry.</p>
          ) : (
            <div class="category-editor-columns">
              <section>
                <h3>{presets.length} presets</h3>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    leave(() => {
                      choose(null);
                      const draft = { id: crypto.randomUUID(), name: '', vocabulary: [] };
                      setBaseline(structuredClone(draft));
                      setEditing(draft);
                    })
                  }
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
                      aria-pressed={(editing?.id ?? selected?.id) === preset.id}
                      onClick={() => leave(() => choose(preset))}
                    >
                      <strong>{preset.name}</strong>
                      <span>{preset.vocabulary.map((kind) => kind.kind).join(' · ') || 'No relation kinds'}</span>
                    </button>
                  ))}
                </div>
              </section>
              <section class="relation-preset-detail">
                {editing ? (
                  <form
                    class="relation-vocabulary"
                    onClick={submitWithoutNavigation}
                    onSubmit={async (event) => {
                      event.preventDefault();
                      if (busy) return;
                      if (
                        new Set(editing.vocabulary.map((kind) => kind.kind.trim())).size !== editing.vocabulary.length
                      ) {
                        setMessage('Give each relation kind a unique name.');
                        return;
                      }
                      setBusy(true);
                      const result = await requestJson<{ ok: boolean; preset: RelationPreset } | null>(
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
                      if (result?.ok) choose(result.preset);
                      setMessage(
                        result?.ok
                          ? 'Preset saved for the workspace. Existing boards are unchanged.'
                          : 'Preset was not saved. Retry.',
                      );
                    }}
                  >
                    <h3>{selected ? 'Customize shared preset' : 'New shared preset'}</h3>
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
                    <div class="relation-preset-footer">
                      <button type="submit" disabled={busy}>
                        Save preset
                      </button>
                      <button type="button" disabled={busy} onClick={() => leave(() => choose(selected))}>
                        Cancel customization
                      </button>
                    </div>
                  </form>
                ) : existing ? (
                  <>
                    <h3>{existing.name}</h3>
                    <p>Saved relations · read-only example</p>
                    <p>
                      Use on board replaces only the chosen board’s vocabulary. Matching connections use its ink and
                      direction; connection records are not rewritten.
                    </p>
                    <ul class="relation-preset-preview" aria-label="Saved relation preview">
                      {existing.vocabulary.map((kind) => (
                        <li key={kind.kind} style={{ '--relation-ink': `var(--c-rel-${kind.ink})` }}>
                          <strong>{kind.kind}</strong>
                          <div class="relation-preset-example">
                            <span>Example A</span>
                            <svg viewBox="0 0 120 24" aria-hidden="true">
                              <line
                                x1="8"
                                y1="12"
                                x2="112"
                                y2="12"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-dasharray={kind.ink === 'related' ? '3 5' : undefined}
                              />
                              {kind.directed && (
                                <path
                                  d="M 102 6 L 112 12 L 102 18"
                                  fill="none"
                                  stroke="currentColor"
                                  stroke-width="2"
                                />
                              )}
                            </svg>
                            <span>Example B</span>
                          </div>
                          <span>
                            {kind.ink} · {kind.directed ? 'Directed: A → B' : 'Undirected: A — B'}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {!existing.vocabulary.length && (
                      <p>No relation kinds. This empty preset can still be used on a board.</p>
                    )}
                    <div class="relation-preset-footer">
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
                            class="relation-preset-use"
                            disabled={busy || !boardId}
                            onClick={async () => {
                              if (busy || !boardId) return;
                              setBusy(true);
                              const saved = await updateBoard(boardId, { relationVocabulary: existing.vocabulary });
                              setBusy(false);
                              setMessage(
                                saved
                                  ? 'Preset applied. Connection records and other boards are unchanged.'
                                  : 'Preset was not applied. Retry.',
                              );
                            }}
                          >
                            Use on board
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setBaseline(structuredClone(existing));
                              setEditing(structuredClone(existing));
                              setConfirmDelete(false);
                              setMessage('');
                            }}
                          >
                            Customize preset
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
                                  if (result?.ok) choose(null);
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
                            <button
                              type="button"
                              class="is-danger"
                              disabled={busy}
                              onClick={() => setConfirmDelete(true)}
                            >
                              Delete preset
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <p>Choose a saved preset or add a new one.</p>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
