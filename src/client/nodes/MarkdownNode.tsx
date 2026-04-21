import type { JSX } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { expandNode, updateNodeData } from '../state/canvas-store';
import { fetchFile, renderMarkdown, saveFile, updateNodeFromClient } from '../state/intent-bridge';
import type { CanvasNodeState } from '../types';
import { MdFormatBar } from './MdFormatBar';
import { handleFormatShortcut, handleTab } from './md-format';
import { InlineMarkdownEditor } from './InlineMarkdownEditor';

function RenderedMarkdown({
  html,
  className,
  style,
}: {
  html: string;
  className?: string;
  style?: string | JSX.CSSProperties;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.replaceChildren();
    if (!html) return;
    const template = document.createElement('template');
    template.innerHTML = html;
    container.append(template.content.cloneNode(true));
  }, [html]);

  return <div ref={containerRef} class={className} style={style} />;
}

export function MarkdownNode({
  node,
  expanded = false,
}: { node: CanvasNodeState; expanded?: boolean }) {
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
  const reviewActive = node.data.reviewActive as boolean | undefined;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let raw: string;
      if (path) {
        const result = await fetchFile(path);
        if (cancelled) return;
        raw = result.content;
      } else if (node.data.content) {
        raw = node.data.content as string;
      } else {
        setLoaded(true);
        return;
      }
      setContent(raw);
      const html = await renderMarkdown(raw);
      if (cancelled) return;
      setRendered(html);
      setLoaded(true);
      updateNodeData(node.id, { content: raw, rendered: html });
    })();
    return () => {
      cancelled = true;
    };
  }, [path, node.id, node.data.content]);

  const handleInput = useCallback(async (e: Event) => {
    const value = (e.target as HTMLTextAreaElement).value;
    setContent(value);
    setDirty(true);
    const html = await renderMarkdown(value);
    setRendered(html);
  }, []);

  const persistContent = useCallback(
    async (newContent: string) => {
      if (!path) {
        const html = await renderMarkdown(newContent);
        setRendered(html);
        setDirty(false);
        updateNodeData(node.id, { content: newContent, rendered: html });
        void updateNodeFromClient(node.id, { content: newContent, data: { rendered: html } });
        return;
      }
      setSaving(true);
      const result = await saveFile(path, newContent);
      setSaving(false);
      if (result.ok) {
        const html = await renderMarkdown(newContent);
        setRendered(html);
        setDirty(false);
        updateNodeData(node.id, { content: newContent, rendered: html, savedAt: result.updatedAt });
        void updateNodeFromClient(node.id, {
          content: newContent,
          data: { rendered: html, savedAt: result.updatedAt },
        });
      }
    },
    [path, node.id],
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
        background: 'var(--c-ok-10)',
        color: 'var(--c-ok)',
        borderBottom: '1px solid var(--c-ok-20)',
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
            ← Back to document
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
          {/* D5/H4: Trust boundary — rendered HTML comes from server-side marked()
              on the user's own markdown files, served only on 127.0.0.1. No DOMPurify
              needed for this localhost-only rendering of user-owned content. */}
          <RenderedMarkdown html={rendered} className="md-preview" />
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
        <RenderedMarkdown html={rendered} className="md-preview" />
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
              background: dirty ? 'var(--c-accent-25)' : 'var(--c-input-bg)',
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
            <div style={{ color: 'var(--c-dim)', fontStyle: 'italic', padding: '24px' }}>
              Loading…
            </div>
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
    <div style={{ height: '100%', position: 'relative' }}>
      {reviewBanner}
      <RenderedMarkdown
        html={rendered}
        style={{ padding: rendered ? '0' : '12px', color: rendered ? undefined : 'var(--c-dim)' }}
      />
      {!loaded && (
        <div style={{ color: 'var(--c-dim)', fontStyle: 'italic', padding: '12px' }}>Loading…</div>
      )}
      {loaded && !rendered && (
        <div style={{ color: 'var(--c-dim)', fontStyle: 'italic', padding: '12px' }}>Empty node</div>
      )}
      <button
        type="button"
        onClick={() => expandNode(node.id)}
        style={{
          position: 'absolute',
          top: '4px',
          right: '4px',
          padding: '3px 8px',
          fontSize: '10px',
          background: 'var(--c-panel-overlay)',
          border: '1px solid var(--c-line)',
          borderRadius: '4px',
          color: 'var(--c-text-soft)',
          cursor: 'pointer',
          opacity: 0.7,
        }}
        onMouseEnter={(e) => {
          (e.target as HTMLElement).style.opacity = '1';
        }}
        onMouseLeave={(e) => {
          (e.target as HTMLElement).style.opacity = '0.7';
        }}
      >
        Edit
      </button>
    </div>
  );
}
