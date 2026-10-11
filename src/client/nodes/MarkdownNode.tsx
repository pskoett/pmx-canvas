import type { JSX } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { IconArrowLeft } from '../icons';
import { expandNode, nodes, updateNodeData } from '../state/canvas-store';
import { fetchFile, renderMarkdown, saveFile, updateNodeFromClient } from '../state/intent-bridge';
import type { CanvasNodeState } from '../types';
import { activeBoard, setBoardReadme, openMemoryTarget, boardList } from '../state/boards-store';
import { showToast } from '../state/attention-bridge';
import { MdFormatBar } from './MdFormatBar';
import { handleFormatShortcut, handleTab } from './md-format';
import { InlineMarkdownEditor } from './InlineMarkdownEditor';
import { isHostedWorkbench } from '../state/workbench-transport';
import { activeBoardId } from '../state/boards-store';
import { sanitizeMarkdownHtml } from './markdown-sanitize';

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
    const target = e.target as HTMLElement;
    const link = target.closest<HTMLAnchorElement>('a.wiki-link');
    if (link) {
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
          boardList.value.some(
            (board) => board.name.toLocaleLowerCase() === name.toLocaleLowerCase() || board.id === name,
          )
        ) {
          showToast(
            'remove',
            'Link unavailable',
            'The target is missing or ambiguous. Use a board/card ID in the wiki link to choose it explicitly.',
          );
        } else {
          window.dispatchEvent(
            new CustomEvent('pmx-open-board-link', { detail: { sourceNodeId: nodeId, wikiRef: name } }),
          );
        }
      }
      return;
    }
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

export function MarkdownNode({ node, expanded = false }: { node: CanvasNodeState; expanded?: boolean }) {
  const board = activeBoard();
  const boardId = activeBoardId.value;
  const path = node.data.path as string;
  const [content, setContent] = useState('');
  const [rendered, setRendered] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [sourceMode, setSourceMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const persistTimerRef = useRef<number | null>(null);
  // Always-current md + saver, so the unmount cleanup can flush a pending
  // debounced save without capturing stale closures.
  const latestMdRef = useRef<string>('');
  const persistFnRef = useRef<((md: string) => Promise<void>) | null>(null);
  const dirtyRef = useRef(false);
  const editBase = useRef({ boardId, revision: node.contentRevision ?? 0 });
  const saveQueue = useRef(Promise.resolve());
  const reviewActive = node.data.reviewActive as boolean | undefined;
  // Binding-only saves/restores and target availability changes invalidate HTML,
  // but position-only layouts must not trigger another render request.
  const savedWikiBindings = JSON.stringify(node.data.wikiLinks ?? []);

  useEffect(() => {
    const renderingDraft = dirtyRef.current;
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
      } else if (node.data.content) {
        raw = node.data.content as string;
      } else {
        setLoaded(true);
        return;
      }
      const html = await renderMarkdown(raw, node.id);
      if (
        cancelled ||
        (renderingDraft || dirtyRef.current
          ? latestMdRef.current !== raw
          : !path && nodes.value.get(node.id)?.data.content !== raw)
      )
        return;
      setRendered(html);
      setLoaded(true);
      if (!dirtyRef.current) {
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

  const handleInput = useCallback(async (e: Event) => {
    const value = (e.target as HTMLTextAreaElement).value;
    dirtyRef.current = true;
    latestMdRef.current = value;
    setContent(value);
    setDirty(true);
    const html = await renderMarkdown(value, node.id);
    setRendered(html);
  }, []);

  const persistContent = useCallback(
    async (newContent: string) => {
      if (isHostedWorkbench()) {
        // Serialize autosaves against the captured source revision, not whatever
        // newer revision a background poll has delivered while typing.
        saveQueue.current = saveQueue.current.then(async () => {
          setSaving(true);
          const result = await updateNodeFromClient(node.id, {
            content: newContent,
            expectedBoardId: editBase.current.boardId,
            expectedContentRevision: editBase.current.revision,
          });
          setSaving(false);
          if (!result.ok) return; // Refusal toast is shown by the request helper; keep the draft.
          editBase.current.revision = result.contentRevision ?? editBase.current.revision;
          const current = nodes.value.get(node.id);
          if (current)
            nodes.value = new Map(nodes.value).set(node.id, { ...current, contentRevision: editBase.current.revision });
          if (latestMdRef.current !== newContent) return;
          dirtyRef.current = false;
          setDirty(false);
          const html = await renderMarkdown(newContent, node.id);
          setRendered(html);
          updateNodeData(node.id, { content: newContent, rendered: html });
        });
        await saveQueue.current;
        return;
      }
      if (!path) {
        const html = await renderMarkdown(newContent, node.id);
        if (activeBoardId.value === boardId && latestMdRef.current === newContent) {
          setRendered(html);
          setDirty(false);
          updateNodeData(node.id, { content: newContent, rendered: html });
        }
        const result = await updateNodeFromClient(node.id, {
          content: newContent,
          data: { rendered: html },
          expectedBoardId: boardId,
        });
        const current = nodes.value.get(node.id);
        if (
          result.ok &&
          result.contentRevision !== undefined &&
          current &&
          activeBoardId.value === boardId &&
          latestMdRef.current === newContent &&
          (current.contentRevision ?? 0) <= result.contentRevision
        ) {
          // Reconcile the text and acknowledgement atomically: an older poll
          // may already have replaced our optimistic content while saving.
          nodes.value = new Map(nodes.value).set(node.id, {
            ...current,
            contentRevision: result.contentRevision,
            lastEditedBy: { actor: 'human', source: 'browser' },
            // A newer binding-aware render may already have arrived via layout.
            // The acknowledgement owns text/revision, not pre-save preview HTML.
            data: { ...current.data, content: newContent },
          });
          dirtyRef.current = false;
          setContent(newContent);
        }
        return;
      }
      setSaving(true);
      const result = await saveFile(path, newContent);
      setSaving(false);
      if (result.ok) {
        const html = await renderMarkdown(newContent, node.id);
        if (latestMdRef.current === newContent) {
          dirtyRef.current = false;
          setRendered(html);
          setDirty(false);
          updateNodeData(node.id, { content: newContent, rendered: html, savedAt: result.updatedAt });
        }
        await updateNodeFromClient(node.id, {
          content: newContent,
          data: { rendered: html, savedAt: result.updatedAt },
        });
      }
    },
    [boardId, path, node.id],
  );

  const handleSave = useCallback(async () => {
    if (!dirty) return;
    await persistContent(content);
  }, [dirty, content, persistContent]);

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
      dirtyRef.current = true;
      setContent(md);
      setDirty(true);
      latestMdRef.current = md;
      if (persistTimerRef.current !== null) window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = window.setTimeout(() => {
        persistTimerRef.current = null;
        void persistContent(md);
      }, 800);
    },
    [persistContent],
  );

  // Fires on ⌘S and blur — persist immediately with whatever markdown the
  // editor just serialized. Cancels any pending debounced save so we don't
  // write twice with slightly different content.
  const handleInlineSave = useCallback(
    (md: string) => {
      dirtyRef.current = true;
      setContent(md);
      latestMdRef.current = md;
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      void persistContent(md);
    },
    [persistContent],
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
  }, [node.id]);

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
          <button type="button" class="md-toolbar-btn" onClick={() => setSourceMode(false)}>
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
            onClick={() => setSourceMode(false)}
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
      <div style={{ height: '100%', position: 'relative' }}>
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
