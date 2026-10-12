import { useRef, useState } from 'preact/hooks';
import type { KnowledgeCategory, Lifecycle } from '../../server/knowledge-lifecycle.js';
import { KNOWLEDGE_PRESETS } from '../../shared/knowledge-presets.js';
import { knowledge, refreshKnowledge } from '../state/knowledge-store';
import { requestJson } from '../state/intent-bridge';
import { cleanLifecycle, DEFAULT_LIFECYCLE, LifecycleFields } from './LifecycleFields';
import { useFocusTrap } from './use-focus-trap';
import { ChoiceMenu } from './ChoiceMenu';

export function KnowledgeDialog({ folder, onClose }: { folder?: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true);
  const catalog = knowledge.value;
  const properties = catalog?.folders.find((item) => item.path === folder);
  const effective = folder ? catalog?.resolvedFolders[folder] : null;
  const [categoryId, setCategoryId] = useState(properties?.categoryId ?? '');
  const [override, setOverride] = useState(!!properties?.lifecycleOverride);
  const [policy, setPolicy] = useState<Lifecycle>(
    properties?.lifecycleOverride ?? effective?.lifecycle ?? DEFAULT_LIFECYCLE,
  );
  const [editing, setEditing] = useState<KnowledgeCategory | null>(() =>
    catalog?.categories[0] ? structuredClone(catalog.categories[0]) : null,
  );
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const existing = catalog?.categories.find((category) => category.id === editing?.id);
  const assignedFolders = catalog?.folders.filter((item) => item.categoryId === editing?.id) ?? [];
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const write = async (path: string, body: unknown) => {
    const result = await requestJson<{ ok: boolean } | null>('knowledgeWrite', `/api/canvas/knowledge/${path}`, null, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return result?.ok === true;
  };
  const adopt = async (name: string) => {
    if (busy || !catalog) return;
    setBusy(true);
    setMessage('');
    let ok = true;
    const preset = KNOWLEDGE_PRESETS[name];
    for (const category of preset.categories) {
      if (!catalog.categories.some((item) => item.id === category.id)) ok = await write('category', { category });
      if (!ok) break;
    }
    if (ok)
      for (const [path, id] of Object.entries(preset.folders)) {
        if (!catalog.folders.some((item) => item.path === path))
          ok = await write('folder', { path, categoryId: id, lifecycleOverride: null });
        if (!ok) break;
      }
    await refreshKnowledge();
    setBusy(false);
    setMessage(
      ok
        ? name === 'Empty'
          ? 'No starter data added. Existing data is unchanged.'
          : 'Starter data added. Existing categories and folder settings were preserved.'
        : 'Template stopped at a failed save. Saved entries remain; retry adds only missing entries.',
    );
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
        class={`knowledge-dialog${folder ? '' : ' is-category-editor'}`}
        role="dialog"
        aria-modal="true"
        aria-label={folder ? 'Folder settings' : 'Categories'}
      >
        <header>
          <div class="knowledge-dialog-title">
            <h2>{folder ? `${folder.split('/').at(-1)} · Folder settings` : 'Workspace categories'}</h2>
            {folder && <span class="knowledge-folder-path">{folder}</span>}
          </div>
          <button type="button" aria-label="Close settings" onClick={onClose}>
            ×
          </button>
        </header>
        {message && <p role="status">{message}</p>}
        {!catalog ? (
          <p>Knowledge settings unavailable. Close and retry.</p>
        ) : folder ? (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              setBusy(true);
              const ok = await write('folder', {
                path: folder,
                categoryId: categoryId || null,
                lifecycleOverride: override ? cleanLifecycle(policy) : null,
              });
              await refreshKnowledge();
              setBusy(false);
              if (ok) onClose();
              else setMessage('Folder settings were not saved. Retry.');
            }}
          >
            <div class="knowledge-field">
              <span>Category</span>
              <ChoiceMenu
                label="Category"
                value={categoryId}
                onChange={setCategoryId}
                options={[
                  { value: '', label: 'Use the parent’s' },
                  ...catalog.categories.map((category) => ({
                    value: category.id,
                    label: `${category.glyph} ${category.name}`,
                  })),
                ]}
              />
            </div>
            <p>
              Currently{' '}
              {effective?.category
                ? `${effective.category.glyph} ${effective.category.name} · ${effective.categorySourceFolder === folder ? 'set here' : `inherited from ${effective.categorySourceFolder}`}`
                : 'unknown'}
              . Cards inherit their category; only lifecycle can be overridden.
            </p>
            <label>
              <input
                type="checkbox"
                checked={override}
                onChange={(event) => setOverride(event.currentTarget.checked)}
              />{' '}
              Override lifecycle for this folder
            </label>
            {override ? (
              <LifecycleFields value={policy} onChange={setPolicy} />
            ) : (
              <p>Lifecycle comes from the selected category or parent. Unknown has no passive expiry.</p>
            )}
            <button type="submit" disabled={busy}>
              Save folder settings
            </button>
          </form>
        ) : (
          <>
            <h3>Start from a template</h3>
            <div class="knowledge-presets">
              {Object.entries(KNOWLEDGE_PRESETS).map(([name, preset]) => (
                <button type="button" key={name} disabled={busy} onClick={() => void adopt(name)}>
                  <strong>{name}</strong>
                  <span>{Object.keys(preset.folders).join(' / ') || 'No folders or categories'}</span>
                </button>
              ))}
            </div>
            <p>Templates add missing data. They never replace your existing settings. Rename any category below.</p>
            <div class="category-editor-columns">
              <section>
                <h3>{catalog.categories.length} categories</h3>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDelete(null);
                    setEditing({ ...DEFAULT_LIFECYCLE, id: crypto.randomUUID(), name: '', glyph: '◇' });
                  }}
                >
                  Add category
                </button>
                <div class="category-library" role="group" aria-label="Workspace categories">
                  {catalog.categories.map((category) => (
                    <button
                      type="button"
                      class="category-choice"
                      key={category.id}
                      aria-pressed={editing?.id === category.id}
                      onClick={() => {
                        setConfirmDelete(null);
                        setEditing(structuredClone(category));
                      }}
                    >
                      <strong>
                        {category.glyph} {category.name}
                      </strong>
                      <span>
                        {category.decayType} · {category.rate}
                        {category.rate === 'medium' && category.cadenceDays ? ` · ${category.cadenceDays} days` : ''}
                      </span>
                    </button>
                  ))}
                </div>
                <p>Folders with no category above them stay unknown. Categories carry no colour.</p>
              </section>
              {editing && (
                <form
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (busy) return;
                    setBusy(true);
                    const ok = await write('category', { category: { ...editing, ...cleanLifecycle(editing) } });
                    await refreshKnowledge();
                    setBusy(false);
                    setMessage(
                      ok
                        ? 'Category saved. Inheriting folders now use these defaults.'
                        : 'Category was not saved. Retry.',
                    );
                  }}
                >
                  <h3>{existing ? 'Edit category defaults' : 'New category'}</h3>
                  <label>
                    Name
                    <input
                      required
                      value={editing.name}
                      onInput={(event) => setEditing({ ...editing, name: event.currentTarget.value })}
                    />
                  </label>
                  <label>
                    Glyph
                    <input
                      required
                      value={editing.glyph}
                      onInput={(event) => setEditing({ ...editing, glyph: event.currentTarget.value })}
                    />
                  </label>
                  <LifecycleFields value={editing} onChange={(value) => setEditing({ ...editing, ...value })} />
                  <button type="submit" disabled={busy}>
                    Save category
                  </button>
                  {existing &&
                    (assignedFolders.length > 0 ? (
                      <p>
                        Cannot delete: assigned to {assignedFolders.map((item) => item.path).join(', ')}. Reassign or
                        clear those folder categories first. Empty folders also count.
                      </p>
                    ) : confirmDelete === existing.id ? (
                      <div role="group" aria-label="Confirm category deletion">
                        <p>Delete {existing.name}? This removes the category from this workspace.</p>
                        <button type="button" disabled={busy} onClick={() => setConfirmDelete(null)}>
                          Cancel deletion
                        </button>
                        <button
                          type="button"
                          class="is-danger"
                          disabled={busy}
                          onClick={async () => {
                            if (busy) return;
                            setBusy(true);
                            const result = await requestJson<{ ok: boolean; error?: string } | null>(
                              'knowledgeRemove',
                              `/api/canvas/knowledge/category/${encodeURIComponent(existing.id)}`,
                              null,
                              { method: 'DELETE' },
                            );
                            await refreshKnowledge();
                            setBusy(false);
                            setConfirmDelete(null);
                            if (result?.ok) setEditing(null);
                            setMessage(
                              result?.ok ? 'Category deleted.' : (result?.error ?? 'Category was not deleted. Retry.'),
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
                        onClick={() => setConfirmDelete(existing.id)}
                      >
                        Delete category
                      </button>
                    ))}
                </form>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
