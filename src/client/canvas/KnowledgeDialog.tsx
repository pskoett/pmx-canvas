import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { knowledgeLifecycleEnabled } from '../state/workspace-settings';
import { lifecycleUiGeneration } from '../state/boards-store';
import { categorySchema, type KnowledgeCategory, type Lifecycle } from '../../shared/knowledge-lifecycle.js';
import { KNOWLEDGE_PRESETS } from '../../shared/knowledge-presets.js';
import { knowledge, refreshKnowledge } from '../state/knowledge-store';
import { requestJson } from '../state/intent-bridge';
import { cleanLifecycle, DEFAULT_LIFECYCLE, LifecycleFields } from './LifecycleFields';
import { useFocusTrap } from './use-focus-trap';
import { ChoiceMenu } from './ChoiceMenu';

export function KnowledgeDialog({ folder, onClose }: { folder?: string; onClose: () => void }) {
  const enabled = knowledgeLifecycleEnabled.value;
  const ref = useRef<HTMLDivElement>(null);
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
  const [baseline, setBaseline] = useState(() => JSON.stringify(editing));
  const [tab, setTab] = useState('Basics');
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<(() => void) | null>(null);
  const dirty = !folder && JSON.stringify(editing) !== baseline;
  const requestAction = (action: () => void) => {
    if (!knowledgeLifecycleEnabled.value || busy || pending) return;
    if (dirty) setPending(() => action);
    else action();
  };
  const handleEscape = () => {
    if (!knowledgeLifecycleEnabled.value) return;
    if (pending) setPending(null);
    else if (confirmDelete) setConfirmDelete(null);
    else requestAction(onClose);
  };
  useFocusTrap(ref, enabled, { onEscape: handleEscape });
  useLayoutEffect(() => {
    if (!enabled && ref.current?.contains(document.activeElement))
      document.querySelector<HTMLElement>('button[aria-label="Settings"]')?.focus({ preventScroll: true });
  }, [enabled]);
  useEffect(() => {
    if (enabled) void refreshKnowledge();
  }, [enabled]);
  const select = (category: KnowledgeCategory) => {
    const draft = structuredClone(category);
    setEditing(draft);
    setBaseline(JSON.stringify(draft));
    setTab('Basics');
    setConfirmDelete(null);
    setMessage('');
  };
  const write = async (path: string, body: unknown) => {
    if (!knowledgeLifecycleEnabled.value) return false;
    const result = await requestJson<{ ok: boolean } | null>('knowledgeWrite', `/api/canvas/knowledge/${path}`, null, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return result?.ok === true;
  };
  const adopt = async (name: string) => {
    if (!knowledgeLifecycleEnabled.value || busy || !catalog) return;
    const generation = lifecycleUiGeneration;
    setBusy(true);
    setMessage('');
    let ok = true;
    const preset = KNOWLEDGE_PRESETS[name];
    for (const category of preset.categories) {
      if (!knowledgeLifecycleEnabled.value || generation !== lifecycleUiGeneration) {
        ok = false;
        break;
      }
      if (!catalog.categories.some((item) => item.id === category.id)) ok = await write('category', { category });
      if (!ok) break;
    }
    if (ok)
      for (const [path, id] of Object.entries(preset.folders)) {
        if (!knowledgeLifecycleEnabled.value || generation !== lifecycleUiGeneration) {
          ok = false;
          break;
        }
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
      hidden={!enabled}
      style={enabled ? undefined : { display: 'none' }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          event.preventDefault();
          handleEscape();
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
          <button type="button" aria-label="Close settings" disabled={busy} onClick={() => requestAction(onClose)}>
            ×
          </button>
        </header>
        {message && <p role="status">{message}</p>}
        {pending && (
          <div role="group" aria-label="Discard category changes" class="category-discard">
            <p>Discard unsaved category changes?</p>
            <button type="button" onClick={() => setPending(null)}>
              Keep editing
            </button>
            <button
              type="button"
              onClick={() => {
                if (!knowledgeLifecycleEnabled.value) return;
                const action = pending;
                setPending(null);
                setBaseline(JSON.stringify(editing));
                action();
              }}
            >
              Discard changes
            </button>
          </div>
        )}
        {!catalog ? (
          <p>Knowledge settings unavailable. Close and retry.</p>
        ) : folder ? (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (!knowledgeLifecycleEnabled.value || busy) return;
              const generation = lifecycleUiGeneration;
              setBusy(true);
              const ok = await write('folder', {
                path: folder,
                categoryId: categoryId || null,
                lifecycleOverride: override ? cleanLifecycle(policy) : null,
              });
              await refreshKnowledge();
              setBusy(false);
              if (ok && knowledgeLifecycleEnabled.value && generation === lifecycleUiGeneration) onClose();
              else if (!ok) setMessage('Folder settings were not saved. Retry.');
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
            <details class="category-templates">
              <summary>Add from template</summary>
              <div class="knowledge-presets">
                {Object.entries(KNOWLEDGE_PRESETS).map(([name, preset]) => (
                  <button
                    type="button"
                    key={name}
                    disabled={busy || !!pending}
                    onClick={() =>
                      requestAction(() => {
                        if (dirty) {
                          setEditing(existing ? structuredClone(existing) : null);
                          setBaseline(JSON.stringify(existing ?? null));
                        }
                        void adopt(name);
                      })
                    }
                  >
                    <strong>{name}</strong>
                    <span>{Object.keys(preset.folders).join(' / ') || 'No folders or categories'}</span>
                  </button>
                ))}
              </div>
              <p>Templates add missing data. They never replace your existing settings. Rename any category below.</p>
            </details>
            <div class="category-editor-columns">
              <section class="category-list-panel">
                <h3>{catalog.categories.length} categories</h3>
                <label>
                  Search categories
                  <input type="search" value={search} onInput={(event) => setSearch(event.currentTarget.value)} />
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    requestAction(() => select({ ...DEFAULT_LIFECYCLE, id: crypto.randomUUID(), name: '', glyph: '◇' }))
                  }
                >
                  Add category
                </button>
                <div class="category-library" role="group" aria-label="Workspace categories">
                  {catalog.categories
                    .filter((category) => category.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
                    .map((category) => (
                      <button
                        type="button"
                        class="category-choice"
                        key={category.id}
                        disabled={busy}
                        aria-pressed={editing?.id === category.id}
                        onClick={() => {
                          if (editing?.id !== category.id) requestAction(() => select(category));
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
                  class="category-inspector"
                  noValidate
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (!knowledgeLifecycleEnabled.value || busy) return;
                    const generation = lifecycleUiGeneration;
                    const parsed = categorySchema.safeParse({ ...editing, ...cleanLifecycle(editing) });
                    if (!parsed.success) {
                      const field = String(parsed.error.issues[0].path[0]);
                      setTab(['name', 'glyph', 'id'].includes(field) ? 'Basics' : 'Review policy');
                      setMessage(parsed.error.issues[0].message);
                      setTimeout(() => {
                        if (!knowledgeLifecycleEnabled.value || generation !== lifecycleUiGeneration) return;
                        const label =
                          field === 'name'
                            ? 'Name'
                            : field === 'glyph'
                              ? 'Glyph'
                              : field === 'cadenceDays'
                                ? 'Cadence in days'
                                : 'How to check';
                        const labels = ref.current?.querySelectorAll('label');
                        Array.from(labels ?? [])
                          .find((item) => item.textContent?.trim().startsWith(label))
                          ?.querySelector<HTMLInputElement>('input')
                          ?.focus();
                      }, 0);
                      return;
                    }
                    setBusy(true);
                    const result = await requestJson<{ ok: boolean; category?: KnowledgeCategory } | null>(
                      'knowledgeWrite',
                      '/api/canvas/knowledge/category',
                      null,
                      {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ category: parsed.data }),
                      },
                    );
                    const ok = result?.ok === true;
                    await refreshKnowledge();
                    setBusy(false);
                    if (!knowledgeLifecycleEnabled.value || generation !== lifecycleUiGeneration) return;
                    if (ok) {
                      const saved = result?.category ?? parsed.data;
                      setEditing(saved);
                      setBaseline(JSON.stringify(saved));
                    }
                    setMessage(
                      ok
                        ? 'Category saved. Inheriting folders now use these defaults.'
                        : 'Category was not saved. Retry.',
                    );
                  }}
                >
                  <h3>{existing ? 'Edit category defaults' : 'New category'}</h3>
                  <div role="tablist" aria-label="Category settings" class="category-tabs">
                    {['Basics', 'Review policy', 'Usage'].map((name) => (
                      <button
                        key={name}
                        type="button"
                        role="tab"
                        id={`category-tab-${name.replace(' ', '-')}`}
                        aria-controls="category-tab-panel"
                        aria-selected={tab === name}
                        onClick={() => setTab(name)}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                  <fieldset
                    disabled={busy || !!pending}
                    id="category-tab-panel"
                    role="tabpanel"
                    aria-labelledby={`category-tab-${tab.replace(' ', '-')}`}
                    class="category-tab-content"
                  >
                    {tab === 'Basics' && (
                      <>
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
                        <div class="category-glyph-choices" role="group" aria-label="Glyph choices">
                          {[
                            ...new Set(
                              Object.values(KNOWLEDGE_PRESETS).flatMap((preset) =>
                                preset.categories.map((category) => category.glyph),
                              ),
                            ),
                          ].map((glyph) => (
                            <button
                              key={glyph}
                              type="button"
                              aria-label={`Choose glyph ${glyph}`}
                              aria-pressed={editing.glyph === glyph}
                              onClick={() => setEditing({ ...editing, glyph })}
                            >
                              {glyph}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    {tab === 'Review policy' && (
                      <LifecycleFields value={editing} onChange={(value) => setEditing({ ...editing, ...value })} />
                    )}
                    {tab === 'Usage' && (
                      <>
                        <p>
                          Folders inherit these defaults. Folder settings and card lifecycle overrides remain unchanged.
                          Unknown has no passive expiry.
                        </p>
                        {assignedFolders.length === 0 && <p>No folders assigned.</p>}
                        {existing &&
                          (assignedFolders.length > 0 ? (
                            <p>
                              Cannot delete: assigned to {assignedFolders.map((item) => item.path).join(', ')}. Reassign
                              or clear those folder categories first. Empty folders also count.
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
                                  if (!knowledgeLifecycleEnabled.value || busy) return;
                                  const generation = lifecycleUiGeneration;
                                  setBusy(true);
                                  const result = await requestJson<{ ok: boolean; error?: string } | null>(
                                    'knowledgeRemove',
                                    `/api/canvas/knowledge/category/${encodeURIComponent(existing.id)}`,
                                    null,
                                    { method: 'DELETE' },
                                  );
                                  await refreshKnowledge();
                                  setBusy(false);
                                  if (!knowledgeLifecycleEnabled.value || generation !== lifecycleUiGeneration) return;
                                  setConfirmDelete(null);
                                  if (result?.ok === true) {
                                    setEditing(null);
                                    setBaseline('null');
                                  }
                                  setMessage(
                                    result?.ok === true
                                      ? 'Category deleted.'
                                      : (result?.error ?? 'Category was not deleted. Retry.'),
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
                      </>
                    )}
                  </fieldset>
                  <footer class="category-editor-footer">
                    <button type="button" disabled={busy || !!pending} onClick={() => requestAction(onClose)}>
                      Cancel
                    </button>
                    <button type="submit" disabled={busy || !!pending}>
                      Save category
                    </button>
                  </footer>
                </form>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
