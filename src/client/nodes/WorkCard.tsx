import { signal, type Signal } from '@preact/signals';
import { useMemo } from 'preact/hooks';
import { WORK_CARD_STATES, type AxWorkItemStatus } from '../../shared/ax-kinds.js';
import { activeBoardId } from '../state/boards-store';
import { updateNodeFromClient } from '../state/intent-bridge';
import type { CanvasNodeState } from '../types';

type WorkDraft = {
  title: string;
  state: AxWorkItemStatus;
  detail: string;
  progress: string;
  boardId: string | null;
  revision: number;
  saving: boolean;
  error: string;
};
// Like Markdown drafts, these belong to the qualified card, not its inline/focus renderer.
const drafts = new Map<string, Signal<WorkDraft | null>>();

export function WorkCard({ node, state }: { node: CanvasNodeState; state: AxWorkItemStatus }) {
  const key = JSON.stringify([activeBoardId.value, node.id]);
  const editing = useMemo(() => drafts.get(key) ?? signal<WorkDraft | null>(null), [key]);
  const draft = editing.value;
  const saving = draft?.saving ?? false;
  const error = draft?.error ?? '';
  const setDraft = (next: WorkDraft | null) => {
    if (next) drafts.set(key, editing);
    else drafts.delete(key);
    editing.value = next;
  };
  const detail = typeof node.data.detail === 'string' ? node.data.detail : '';
  const progress = typeof node.data.progress === 'number' ? node.data.progress : null;

  const edit = () => {
    setDraft({
      title: typeof node.data.title === 'string' ? node.data.title : '',
      state,
      detail,
      progress: progress === null ? '' : String(progress),
      boardId: activeBoardId.value,
      revision: node.contentRevision ?? 0,
      saving: false,
      error: '',
    });
  };
  const save = async () => {
    if (!draft || saving) return;
    setDraft({ ...draft, saving: true, error: '' });
    const result = await updateNodeFromClient(node.id, {
      title: draft.title.trim(),
      data: {
        workState: draft.state,
        detail: draft.detail,
        progress: draft.progress === '' ? null : Number(draft.progress),
      },
      expectedBoardId: draft.boardId,
      expectedContentRevision: draft.revision,
    });
    if (result.ok) setDraft(null);
    else
      setDraft({
        ...draft,
        saving: false,
        error: 'Could not save. Your draft is still here. Check the connection or whether the card changed.',
      });
  };

  if (draft) {
    return (
      <form
        class="work-card-editor"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape' && !saving) {
            event.preventDefault();
            setDraft(null);
          }
        }}
      >
        <fieldset disabled={saving}>
          <label>
            Title
            <input required value={draft.title} onInput={(e) => setDraft({ ...draft, title: e.currentTarget.value })} />
          </label>
          <label>
            Work state
            <select
              value={draft.state}
              onChange={(e) => setDraft({ ...draft, state: e.currentTarget.value as AxWorkItemStatus })}
            >
              {Object.entries(WORK_CARD_STATES).map(([value, item]) => (
                <option key={value} value={value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Detail
            <textarea value={draft.detail} onInput={(e) => setDraft({ ...draft, detail: e.currentTarget.value })} />
          </label>
          <label>
            Progress (%) · optional
            <input
              type="number"
              min="0"
              max="100"
              step="any"
              value={draft.progress}
              onInput={(e) => setDraft({ ...draft, progress: e.currentTarget.value })}
            />
          </label>
          {error && (
            <div class="work-card-error" role="alert">
              {error}
            </div>
          )}
          <footer>
            <button type="button" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button class="work-card-save" type="submit">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </footer>
        </fieldset>
      </form>
    );
  }

  return (
    <div class={`work-card work-card-${state}`}>
      <div class="work-card-state">
        <span aria-hidden="true">{WORK_CARD_STATES[state].glyph}</span> {WORK_CARD_STATES[state].label}
      </div>
      {detail && <div class="work-card-detail">{detail}</div>}
      {progress !== null && (
        <div class="work-card-progress">
          <span>{progress}% complete</span>
          <div
            class="status-progress"
            role="progressbar"
            aria-label="Progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <div style={{ width: `${progress}%`, background: 'currentColor' }} />
          </div>
        </div>
      )}
      <footer>
        <button type="button" onClick={edit}>
          Edit
        </button>
      </footer>
    </div>
  );
}
