import type { JSX } from 'preact';
import { signal, type Signal } from '@preact/signals';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { IconArrowLeft } from '../icons';
import { expandNode, nodes, updateNodeData } from '../state/canvas-store';
import { fetchFile, renderMarkdown, updateNodeFromClient } from '../state/intent-bridge';
import type { CanvasNodeState } from '../types';
import { activeBoard, setBoardReadme, openMemoryTarget, boardList } from '../state/boards-store';
import { showToast } from '../state/attention-bridge';
import { MdFormatBar } from './MdFormatBar';
import { handleFormatShortcut, handleTab } from './md-format';
import { InlineMarkdownEditor } from './InlineMarkdownEditor';
import { isHostedWorkbench } from '../state/workbench-transport';
import { activeBoardId, boardIncarnation } from '../state/boards-store';
import { sanitizeMarkdownHtml } from './markdown-sanitize';

function handleWikiClick(e: MouseEvent, nodeId: string): boolean {
  const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a.wiki-link');
  if (!link) return false;
  e.preventDefault();
  e.stopPropagation();
  if (link.dataset.wikiBoard) {
    void openMemoryTarget({
      boardId: link.dataset.wikiBoard,
      ...(link.dataset.wikiCard ? { cardId: link.dataset.wikiCard } : {}),
    });
  } else {
    const ref = link.dataset.wikiRef ?? '';
    const name = ref.split('#')[0];
    if (
      link.dataset.wikiMissing ||
      ref.includes('#') ||
      boardList.value.some((board) => board.name.toLocaleLowerCase() === name.toLocaleLowerCase() || board.id === name)
    ) {
      showToast(
        'remove',
        'Link unavailable',
        'The target is missing or ambiguous. Use a board/card ID in the wiki link to choose it explicitly.',
      );
    } else {
      window.dispatchEvent(new CustomEvent('pmx-open-board-link', { detail: { sourceNodeId: nodeId, wikiRef: name } }));
    }
  }
  return true;
}

function RenderedMarkdown({
  html,
  className,
  style,
  onTaskToggle,
  nodeId,
}: {
  html: string;
  nodeId: string;
  className?: string;
  style?: string | JSX.CSSProperties;
  /** Enables the GFM task checkboxes and reports which one was clicked (document order). */
  onTaskToggle?: (index: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // The handler lives in a ref so the DOM effect depends on `html` ALONE. With
  // the inline prop in the deps, every unrelated re-render (bring-to-front on
  // pointerdown, presence frames) replaced the children — and a HUMAN press is
  // ~100ms, so the checkbox under the finger was swapped mid-press and the
  // click never fired. Synthetic test clicks are fast enough to win the race,
  // which is exactly why this shipped "verified".
  const onTaskToggleRef = useRef(onTaskToggle);
  onTaskToggleRef.current = onTaskToggle;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.replaceChildren();
    if (!html) return;
    const template = document.createElement('template');
    template.innerHTML = sanitizeMarkdownHtml(html);
    container.append(template.content.cloneNode(true));
    if (onTaskToggleRef.current) {
      for (const box of container.querySelectorAll('input[type="checkbox"][disabled]')) {
        box.removeAttribute('disabled');
      }
    }
  }, [html]);

  const handleClick = (e: MouseEvent) => {
    if (handleWikiClick(e, nodeId)) return;
    const target = e.target as HTMLElement;
    const onToggle = onTaskToggleRef.current;
    const container = containerRef.current;
    if (!container || !onToggle) return;
    // The box itself, or anywhere in the row's checkbox gutter — a 15px
    // input alone is a miserable target at zoom and in embedded panes
    // that forward clicks imprecisely.
    let box: HTMLInputElement | null = null;
    if (target instanceof HTMLInputElement && target.type === 'checkbox') {
      box = target;
    } else {
      const row = target.closest('li');
      const rowBox = row?.querySelector<HTMLInputElement>(':scope > input[type="checkbox"]');
      if (rowBox && e.clientX <= rowBox.getBoundingClientRect().right + 6) box = rowBox;
    }
    if (!box) return;
    e.stopPropagation();
    const index = [...container.querySelectorAll('input[type="checkbox"]')].indexOf(box);
    if (index >= 0) onToggle(index);
  };

  return <div ref={containerRef} class={className} style={style} onClick={handleClick} />;
}

/** Flip the index-th GFM task marker in the source (document order matches the rendered boxes). */
export function toggleTaskMarker(markdown: string, index: number): string {
  let seen = -1;
  return markdown.replace(/^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/gm, (match, pre, state, post) => {
    seen += 1;
    if (seen !== index) return match;
    return `${pre}${state === ' ' ? 'x' : ' '}${post}`;
  });
}

// A draft belongs to its qualified card, not the card/overlay component currently
// showing it. Keep dirty or in-flight work across close, expand and board switches.
type MarkdownDraft = {
  latestMdRef: { current: string };
  renderedMdRef: { current: { markdown: string; html: string } | null };
  dirty: Signal<boolean>;
  editBase: { current: { boardId: string | null; revision: number } };
  saveQueue: { current: Promise<void> };
  nativeSaveAttempts: Set<{ revision: number }>;
  pending: Signal<number>;
  owners: number;
};
const markdownDrafts = new Map<string, MarkdownDraft>();

/** Review must refer to persisted content, not an edited or saving preview. */
export function hasUnsavedMarkdown(boardId: string, nodeId: string): boolean {
  const draft = markdownDrafts.get(JSON.stringify([boardId, nodeId]));
  return !!draft && (draft.dirty.value || draft.pending.value > 0);
}

export function MarkdownNode({ node, expanded = false }: { node: CanvasNodeState; expanded?: boolean }) {
  const board = activeBoard();
  const boardId = activeBoardId.value;
  const draftKey = JSON.stringify([boardId, node.id]);
  const draft = useMemo(() => {
    const existing = markdownDrafts.get(draftKey);
    if (existing) return existing;
    const created: MarkdownDraft = {
      latestMdRef: { current: typeof node.data.content === 'string' ? node.data.content : '' },
      renderedMdRef: { current: null },
      dirty: signal(false),
      editBase: { current: { boardId, revision: node.contentRevision ?? 0 } },
      saveQueue: { current: Promise.resolve() },
      nativeSaveAttempts: new Set(),
      pending: signal(0),
      owners: 0,
    };
    markdownDrafts.set(draftKey, created);
    return created;
  }, [draftKey]);
  const { latestMdRef, renderedMdRef, editBase, saveQueue } = draft;
  const path = node.data.path as string;
  const [content, setContent] = useState('');
  const [rendered, setRendered] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [sourceMode, setSourceMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const dirty = draft.dirty.value;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const persistTimerRef = useMemo<{ current: number | null }>(() => ({ current: null }), [draft]);
  // Always-current md + saver, so the unmount cleanup can flush a pending
  // debounced save without borrowing another board's same-ID card.
  const persistFnRef = useMemo<{ current: ((md: string) => Promise<void>) | null }>(() => ({ current: null }), [draft]);
  const reviewActive = node.data.reviewActive as boolean | undefined;
  // Binding-only saves/restores and target availability changes invalidate HTML,
  // but position-only layouts must not trigger another render request.
  const savedWikiBindings = JSON.stringify(node.data.wikiLinks ?? []);

  useLayoutEffect(() => {
    draft.owners++;
    // Reattach when replacing the last clean card instance in the same commit.
    markdownDrafts.set(draftKey, draft);
    setContent(latestMdRef.current);
    const preview = renderedMdRef.current;
    const matches = preview?.markdown === latestMdRef.current;
    setRendered(matches ? preview.html : '');
    setLoaded(matches);
    return () => {
      draft.owners--;
      if (!draft.owners && !draft.pending.value && !draft.dirty.value && markdownDrafts.get(draftKey) === draft)
        markdownDrafts.delete(draftKey);
    };
  }, [draft]);

  useEffect(() => {
    const renderingDraft = draft.dirty.value || draft.pending.value > 0;
    if (!renderingDraft) editBase.current = { boardId, revision: node.contentRevision ?? 0 };
    let cancelled = false;
    (async () => {
      let raw: string;
      if (renderingDraft) {
        // Refresh link availability in the draft, never replace it with saved text.
        raw = latestMdRef.current;
      } else if (path) {
        const result = await fetchFile(path);
        if (cancelled) return;
        raw = result.content;
      } else if (typeof node.data.content === 'string') {
        raw = node.data.content;
      } else {
        setLoaded(true);
        return;
      }
      const html = await renderMarkdown(raw, node.id, boardId);
      if (
        html === null ||
        cancelled ||
        activeBoardId.value !== boardId ||
        (renderingDraft || draft.dirty.value
          ? latestMdRef.current !== raw
          : !path && nodes.value.get(node.id)?.data.content !== raw)
      )
        return;
      renderedMdRef.current = { markdown: raw, html };
      setRendered(html);
      setLoaded(true);
      if (!renderingDraft && !draft.dirty.value) {
        latestMdRef.current = raw;
        setContent(raw);
        updateNodeData(node.id, { content: raw, rendered: html });
      } else if (nodes.value.get(node.id)?.data.content === raw) {
        // A pending save may already contain this text; cache only its HTML.
        updateNodeData(node.id, { rendered: html });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [boardId, path, node.id, node.data.content, savedWikiBindings, node.linksRevision]);

  const handleInput = useCallback(
    async (e: Event) => {
      const value = (e.target as HTMLTextAreaElement).value;
      draft.dirty.value = true;
      latestMdRef.current = value;
      setContent(value);
      const html = await renderMarkdown(value, node.id, boardId);
      if (html === null || activeBoardId.value !== boardId || latestMdRef.current !== value) return;
      renderedMdRef.current = { markdown: value, html };
      setRendered(html);
    },
    [boardId, draft, node.id],
  );

  const persistContent = useCallback(
    async (newContent: string) => {
      // Human wins over already-observed work, not work arriving while this
      // particular attempt waits in the queue or for its rendered preview.
      const incarnation = boardIncarnation;
      const attempt = { revision: nodes.value.get(node.id)?.contentRevision ?? 0 };
      draft.nativeSaveAttempts.add(attempt);
      draft.pending.value++;
      // Order the complete save, including disk writes and rendering. A later
      // draft must not persist before an older render resumes and overwrites it.
      saveQueue.current = saveQueue.current.then(async () => {
        if (incarnation !== boardIncarnation || activeBoardId.value !== boardId || latestMdRef.current !== newContent)
          return;
        if (isHostedWorkbench()) {
          // Serialize autosaves against the captured source revision, not whatever
          // newer revision a background poll has delivered while typing.
          setSaving(true);
          const result = await updateNodeFromClient(node.id, {
            content: newContent,
            expectedBoardId: editBase.current.boardId,
            expectedContentRevision: editBase.current.revision,
          });
          setSaving(false);
          if (!result.ok || incarnation !== boardIncarnation) return; // Keep refused or obsolete drafts.
          editBase.current.revision = result.contentRevision ?? editBase.current.revision;
          const html = await renderMarkdown(newContent, node.id, boardId);
          if (incarnation !== boardIncarnation || activeBoardId.value !== boardId || latestMdRef.current !== newContent)
            return;
          const current = nodes.value.get(node.id);
          if (!current || (current.contentRevision ?? 0) > editBase.current.revision) return;
          nodes.value = new Map(nodes.value).set(node.id, {
            ...current,
            contentRevision: editBase.current.revision,
            lastEditedBy: result.lastEditedBy,
            data: { ...current.data, content: newContent, ...(html !== null ? { rendered: html } : {}) },
          });
          draft.dirty.value = false;
          if (html !== null) {
            renderedMdRef.current = { markdown: newContent, html };
            setRendered(html);
          }
          return;
        }
        const html = await renderMarkdown(newContent, node.id, boardId);
        if (
          html === null ||
          incarnation !== boardIncarnation ||
          activeBoardId.value !== boardId ||
          latestMdRef.current !== newContent
        )
          return;
        // Preview the local draft independently of persistence. Switching Source
        // back to Document must not resurrect saved text while PATCH is pending.
        if (
          activeBoardId.value === boardId &&
          latestMdRef.current === newContent &&
          renderedMdRef.current?.markdown !== newContent
        ) {
          renderedMdRef.current = { markdown: newContent, html };
          setRendered(html);
        }
        const expectedContentRevision = attempt.revision;
        const result = await updateNodeFromClient(node.id, {
          content: newContent,
          data: { rendered: html },
          expectedBoardId: boardId,
          expectedContentRevision,
          ...(path ? { persistFile: true } : {}),
        });
        // A restored/restarted library may reuse this ID with a lower revision.
        // The old ACK grants neither canonical state nor queued-save authority.
        if (incarnation !== boardIncarnation) return;
        if (result.ok && result.contentRevision !== undefined) {
          // Advance only through a successful predecessor in this board/card's
          // queue. An external revision or a refused save grants no retry.
          for (const queued of draft.nativeSaveAttempts) {
            if (queued.revision === expectedContentRevision) queued.revision = result.contentRevision;
          }
        }
        const current = nodes.value.get(node.id);
        if (
          result.ok &&
          result.contentRevision !== undefined &&
          current &&
          activeBoardId.value === boardId &&
          (current.contentRevision ?? 0) <= result.contentRevision
        ) {
          // ACK the canonical revision even while a newer local draft is dirty,
          // so a later save need not wait for polling to observe our own write.
          const preview = renderedMdRef.current;
          const replacePreview = preview?.markdown !== newContent;
          nodes.value = new Map(nodes.value).set(node.id, {
            ...current,
            contentRevision: result.contentRevision,
            lastEditedBy: result.lastEditedBy,
            data: {
              ...current.data,
              content: newContent,
              rendered: preview?.markdown === newContent ? preview.html : html,
            },
          });
          if (latestMdRef.current === newContent) {
            // A remounted editor must not initialize from another source's HTML
            // while the canonical post-save render is still pending.
            if (replacePreview) {
              renderedMdRef.current = { markdown: newContent, html };
              setRendered(html);
            }
            draft.dirty.value = false;
            setContent(newContent);
          }
        }
      });
      try {
        await saveQueue.current;
      } finally {
        draft.nativeSaveAttempts.delete(attempt);
        draft.pending.value--;
        if (!draft.owners && !draft.pending.value && !draft.dirty.value && markdownDrafts.get(draftKey) === draft)
          markdownDrafts.delete(draftKey);
      }
    },
    [boardId, path, node.id, draft],
  );

  const handleSave = useCallback(async () => {
    if (!dirty) return;
    await persistContent(content);
  }, [dirty, content, persistContent]);

  const handleDocumentMode = useCallback(async () => {
    if (renderedMdRef.current?.markdown !== content) {
      const html = await renderMarkdown(content, node.id, boardId);
      // Do not mount the rich editor from another source's HTML, including
      // while a draft render is pending or unavailable. Keep Source retryable.
      if (html === null || activeBoardId.value !== boardId || latestMdRef.current !== content) return;
      if (renderedMdRef.current?.markdown !== content) {
        renderedMdRef.current = { markdown: content, html };
      }
    }
    if (activeBoardId.value !== boardId || latestMdRef.current !== content) return;
    // Another instance may have populated the shared cache. The rich editor
    // mounts from this instance's HTML, which must match that cache as well.
    const preview = renderedMdRef.current;
    if (preview?.markdown !== content) return;
    setRendered(preview.html);
    setLoaded(true);
    setSourceMode(false);
  }, [boardId, content, node.id]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
        return;
      }
      const ta = textareaRef.current;
      if (ta && handleFormatShortcut(e, ta)) return;
      if (ta && e.key === 'Tab') {
        e.preventDefault();
        handleTab(ta, e.shiftKey);
      }
    },
    [handleSave],
  );

  // Keep refs in sync so the unmount-cleanup effect below can flush with
  // the freshest values instead of closure captures.
  persistFnRef.current = persistContent;

  // Editor fires onChange on every keystroke; debounce the server save so we
  // don't hit the backend on every letter.
  const handleInlineChange = useCallback(
    (md: string) => {
      draft.dirty.value = true;
      setContent(md);
      latestMdRef.current = md;
      if (persistTimerRef.current !== null) window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = window.setTimeout(() => {
        persistTimerRef.current = null;
        void persistContent(md);
      }, 800);
    },
    [persistContent, draft],
  );

  // Fires on ⌘S and blur — persist immediately with whatever markdown the
  // editor just serialized. Cancels any pending debounced save so we don't
  // write twice with slightly different content.
  const handleInlineSave = useCallback(
    (md: string) => {
      draft.dirty.value = true;
      setContent(md);
      latestMdRef.current = md;
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      void persistContent(md);
    },
    [persistContent, draft],
  );

  // On unmount / node switch, flush any pending debounced save so trailing
  // keystrokes aren't dropped when the user switches to another document.
  useEffect(() => {
    return () => {
      if (persistTimerRef.current === null) return;
      window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
      const fn = persistFnRef.current;
      if (fn) void fn(latestMdRef.current);
    };
  }, [draft]);

  const reviewBanner = reviewActive ? (
    <div
      style={{
        padding: '4px 8px',
        fontSize: '10px',
        background: 'color-mix(in srgb, var(--c-ok) 10%, transparent)',
        color: 'var(--c-ok)',
        borderBottom: '1px solid color-mix(in srgb, var(--c-ok) 20%, transparent)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        fontWeight: 600,
      }}
    >
      Review active
    </div>
  ) : null;

  // ── Raw source editor (escape hatch) ──────────────────────────

  if (sourceMode && expanded) {
    return (
      <div class="md-editor-expanded" onKeyDown={handleKeyDown}>
        <div class="md-editor-toolbar">
          <button type="button" class="md-toolbar-btn" onClick={handleDocumentMode}>
            <IconArrowLeft size={14} /> Back to document
          </button>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            {path && <span class="md-toolbar-path">{path.split('/').pop()}</span>}
            <button
              type="button"
              class={`md-toolbar-btn${dirty ? ' md-toolbar-btn-primary' : ''}`}
              onClick={handleSave}
              disabled={!dirty || saving}
            >
              {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
            </button>
          </div>
        </div>
        <div class="md-editor-split">
          <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>
            <textarea ref={textareaRef} value={content} onInput={handleInput} spellcheck={false} />
            <MdFormatBar textareaRef={textareaRef} />
          </div>
          <RenderedMarkdown nodeId={node.id} html={rendered} className="md-preview" />
        </div>
      </div>
    );
  }

  if (sourceMode) {
    return (
      <div class="md-editor-split" style={{ height: '100%' }} onKeyDown={handleKeyDown}>
        <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>
          <textarea ref={textareaRef} value={content} onInput={handleInput} spellcheck={false} />
          <MdFormatBar textareaRef={textareaRef} />
        </div>
        <RenderedMarkdown nodeId={node.id} html={rendered} className="md-preview" />
        <div
          style={{
            position: 'absolute',
            bottom: '8px',
            right: '8px',
            display: 'flex',
            gap: '6px',
          }}
        >
          <button
            type="button"
            onClick={handleDocumentMode}
            style={{
              padding: '4px 10px',
              fontSize: '11px',
              background: 'var(--c-input-bg)',
              border: '1px solid var(--c-line)',
              borderRadius: '6px',
              color: 'var(--c-text-soft)',
              cursor: 'pointer',
            }}
          >
            Document
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving}
            style={{
              padding: '4px 10px',
              fontSize: '11px',
              background: dirty ? 'color-mix(in srgb, var(--c-accent) 25%, transparent)' : 'var(--c-input-bg)',
              border: `1px solid ${dirty ? 'var(--c-accent)' : 'var(--c-line)'}`,
              borderRadius: '6px',
              color: dirty ? 'var(--c-text)' : 'var(--c-dim)',
              cursor: dirty ? 'pointer' : 'default',
            }}
          >
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </div>
      </div>
    );
  }

  // ── Expanded document mode (inline WYSIWYG) ───────────────────

  if (expanded) {
    return (
      <div
        style={{ height: '100%', position: 'relative' }}
        onClick={async (event) => {
          if (!(event.target as HTMLElement).closest('a.wiki-link')) return;
          event.preventDefault();
          event.stopPropagation();
          const incarnation = boardIncarnation;
          const focused = document.activeElement;
          // Blur serializes the rich document. Finish that save before the
          // link dialog captures its source or navigation changes boards.
          if (focused instanceof HTMLElement && event.currentTarget.contains(focused)) focused.blur();
          await saveQueue.current;
          if (incarnation !== boardIncarnation || activeBoardId.value !== boardId || draft.dirty.value) return;
          handleWikiClick(event, node.id);
        }}
      >
        {reviewBanner}
        <div class="md-reader">
          {loaded ? (
            <InlineMarkdownEditor
              key={node.id}
              initialHtml={rendered || '<p><br></p>'}
              className="md-reader-content md-reader-editable"
              onChange={handleInlineChange}
              onSave={handleInlineSave}
            />
          ) : (
            <div style={{ color: 'var(--c-dim)', fontStyle: 'italic', padding: '24px' }}>Loading…</div>
          )}
        </div>
        <button type="button" class="md-edit-fab" onClick={() => setSourceMode(true)}>
          {'</> Source'}
        </button>
      </div>
    );
  }

  // ── Card preview ──────────────────────────────────────────────

  return (
    <div class="md-card-preview">
      <div class="md-card-content">
        {reviewBanner}
        <RenderedMarkdown
          nodeId={node.id}
          html={rendered}
          style={{ padding: rendered ? '0' : '12px', color: rendered ? undefined : 'var(--c-dim)' }}
          // Task checkboxes are live on the card itself — no need to expand to tick one.
          onTaskToggle={(index) => {
            const next = toggleTaskMarker(content, index);
            if (next !== content) handleInlineSave(next);
          }}
        />
        {!loaded && <div style={{ color: 'var(--c-dim)', fontStyle: 'italic', padding: '12px' }}>Loading…</div>}
        {loaded && !rendered && (
          <div style={{ color: 'var(--c-dim)', fontStyle: 'italic', padding: '12px' }}>Empty node</div>
        )}
      </div>
      {node.data.source && typeof node.data.source === 'object' && 'attachmentId' in node.data.source && (
        <div class="md-import-source">
          Source material ·{' '}
          <a
            href={`/api/canvas/attachments/${encodeURIComponent(String(node.data.source.attachmentId))}/bytes`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {String((node.data.source as Record<string, unknown>).filename ?? 'Original')}
          </a>
          {' · '}
          {String((node.data.source as Record<string, unknown>).reference ?? 'Location not supplied')}
        </div>
      )}
      <div class="md-card-actions">
        {board && (
          <button
            type="button"
            class="md-readme-btn"
            aria-pressed={board.readmeNodeId === node.id}
            onClick={() => void setBoardReadme(board.id, board.readmeNodeId === node.id ? null : node.id)}
          >
            {board.readmeNodeId === node.id ? 'README' : 'Set as README'}
          </button>
        )}
        <button type="button" class="md-card-edit" onClick={() => expandNode(node.id)}>
          Edit
        </button>
      </div>
    </div>
  );
}
