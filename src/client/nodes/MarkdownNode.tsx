import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { updateNodeData } from '../state/canvas-store';
import { fetchFile, renderMarkdown, saveFile } from '../state/intent-bridge';
import type { CanvasNodeState } from '../types';
import { MdFormatBar } from './MdFormatBar';
import { handleFormatShortcut, handleTab } from './md-format';

/** Split markdown into blocks, respecting fenced code blocks and tables. */
function splitMarkdownBlocks(md: string): string[] {
  const lines = md.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;

  for (const line of lines) {
    // Track fenced code blocks (``` or ~~~)
    if (/^(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
      current.push(line);
      continue;
    }
    if (inFence) {
      current.push(line);
      continue;
    }
    // Blank line outside fence = block boundary
    if (line.trim() === '') {
      if (current.length > 0) {
        blocks.push(current.join('\n'));
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) {
    blocks.push(current.join('\n'));
  }
  return blocks;
}

function RenderedMarkdown({
  html,
  className,
  style,
  onBlockClick,
}: {
  html: string;
  className?: string;
  style?: string | JSX.CSSProperties;
  onBlockClick?: (blockIndex: number) => void;
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

    // If block-click is enabled, annotate top-level children
    if (onBlockClick) {
      const children = container.children;
      for (let i = 0; i < children.length; i++) {
        const el = children[i] as HTMLElement;
        el.dataset.blockIdx = String(i);
      }
    }
  }, [html, onBlockClick]);

  const handleClick = useCallback(
    (e: MouseEvent) => {
      if (!onBlockClick) return;
      // Walk up from target to find a top-level child with data-block-idx
      let el = e.target as HTMLElement | null;
      const container = containerRef.current;
      while (el && el !== container) {
        if (el.parentElement === container && el.dataset.blockIdx) {
          onBlockClick(Number(el.dataset.blockIdx));
          return;
        }
        el = el.parentElement;
      }
    },
    [onBlockClick],
  );

  return (
    <div
      ref={containerRef}
      class={className}
      style={style}
      onClick={onBlockClick ? handleClick : undefined}
    />
  );
}

export function MarkdownNode({
  node,
  expanded = false,
}: { node: CanvasNodeState; expanded?: boolean }) {
  const path = node.data.path as string;
  const [content, setContent] = useState('');
  const [rendered, setRendered] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editingBlock, setEditingBlock] = useState<number | null>(null);
  const [blockDraft, setBlockDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const blockTextareaRef = useRef<HTMLTextAreaElement>(null);
  const reviewActive = node.data.reviewActive as boolean | undefined;

  const blocks = useMemo(() => splitMarkdownBlocks(content), [content]);

  // Load content: from file (path) or inline (data.content)
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

  // Re-render on content change (for full editor)
  const handleInput = useCallback(async (e: Event) => {
    const value = (e.target as HTMLTextAreaElement).value;
    setContent(value);
    setDirty(true);
    const html = await renderMarkdown(value);
    setRendered(html);
  }, []);

  const persistContent = useCallback(
    async (newContent: string) => {
      if (!path) return;
      setSaving(true);
      const result = await saveFile(path, newContent);
      setSaving(false);
      if (result.ok) {
        setDirty(false);
        updateNodeData(node.id, { content: newContent, savedAt: result.updatedAt });
      }
    },
    [path, node.id],
  );

  const handleSave = useCallback(async () => {
    if (!path || !dirty) return;
    await persistContent(content);
  }, [path, dirty, content, persistContent]);

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

  // ── Inline block editing ──────────────────────────────────────

  const handleBlockClick = useCallback(
    (blockIndex: number) => {
      if (editingBlock !== null) return; // already editing
      if (blockIndex >= blocks.length) return;
      setEditingBlock(blockIndex);
      setBlockDraft(blocks[blockIndex]);
      requestAnimationFrame(() => {
        const ta = blockTextareaRef.current;
        if (ta) {
          ta.focus();
          ta.style.height = 'auto';
          ta.style.height = `${ta.scrollHeight}px`;
        }
      });
    },
    [editingBlock, blocks],
  );

  const handleBlockSave = useCallback(async () => {
    if (editingBlock === null) return;
    const newBlocks = [...blocks];
    newBlocks[editingBlock] = blockDraft;
    const newContent = newBlocks.join('\n\n');
    setContent(newContent);
    setEditingBlock(null);
    setDirty(true);
    const html = await renderMarkdown(newContent);
    setRendered(html);
    if (path) {
      await persistContent(newContent);
    }
  }, [editingBlock, blockDraft, blocks, path, persistContent]);

  const handleBlockCancel = useCallback(() => {
    setEditingBlock(null);
  }, []);

  const handleBlockKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleBlockCancel();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleBlockSave();
        return;
      }
      const ta = blockTextareaRef.current;
      if (ta && handleFormatShortcut(e, ta)) return;
      if (ta && e.key === 'Tab') {
        e.preventDefault();
        handleTab(ta, e.shiftKey);
      }
    },
    [handleBlockCancel, handleBlockSave],
  );

  const handleBlockInput = useCallback((e: Event) => {
    const ta = e.target as HTMLTextAreaElement;
    setBlockDraft(ta.value);
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, []);

  // ── Render helpers ────────────────────────────────────────────

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

  // ── Editing mode (full editor) ────────────────────────────────

  if (editing && expanded) {
    return (
      <div class="md-editor-expanded" onKeyDown={handleKeyDown}>
        <div class="md-editor-toolbar">
          <button type="button" class="md-toolbar-btn" onClick={() => setEditing(false)}>
            ← Preview
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

  if (editing) {
    return (
      <div class="md-editor-split" style={{ height: '100%' }} onKeyDown={handleKeyDown}>
        <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>
          <textarea ref={textareaRef} value={content} onInput={handleInput} spellcheck={false} />
          <MdFormatBar textareaRef={textareaRef} />
        </div>
        {/* D5/H4: Trust boundary — same as above */}
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
            onClick={() => setEditing(false)}
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
            Preview
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

  // ── Expanded reader mode (with inline block editing) ──────────

  if (expanded) {
    // Render per-block: each block gets its own rendered HTML for inline editing
    // When a block is being edited, show textarea instead of rendered content
    return (
      <div style={{ height: '100%', position: 'relative' }}>
        {reviewBanner}
        <div class="md-reader">
          <div class="md-reader-content md-reader-inline-editable">
            {editingBlock !== null ? (
              // Render blocks individually: show textarea for the editing block
              <>
                {blocks.map((_, i) =>
                  i === editingBlock ? (
                    <div key={`block-${i}`} class="md-block-edit-wrap">
                      <textarea
                        ref={blockTextareaRef}
                        class="md-block-edit"
                        value={blockDraft}
                        onInput={handleBlockInput}
                        onKeyDown={handleBlockKeyDown}
                        spellcheck={false}
                      />
                      <MdFormatBar textareaRef={blockTextareaRef} />
                      <div class="md-block-edit-actions">
                        <span style={{ fontSize: '10px', color: 'var(--c-muted)' }}>
                          Esc cancel · ⌘Enter save
                        </span>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button type="button" class="md-toolbar-btn" onClick={handleBlockCancel}>
                            Cancel
                          </button>
                          <button
                            type="button"
                            class="md-toolbar-btn md-toolbar-btn-primary"
                            onClick={handleBlockSave}
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <BlockPreview key={`block-${i}`} block={blocks[i]} index={i} />
                  ),
                )}
              </>
            ) : (
              // Normal reader: full rendered HTML with click-to-edit
              <>
                {/* D5/H4: Same trust boundary as the split-editor preview above */}
                <RenderedMarkdown html={rendered} onBlockClick={handleBlockClick} />
                {!loaded && (
                  <div style={{ color: 'var(--c-dim)', fontStyle: 'italic', padding: '24px' }}>
                    Loading…
                  </div>
                )}
                {loaded && !rendered && (
                  <div style={{ color: 'var(--c-dim)', fontStyle: 'italic', padding: '24px' }}>
                    Empty node
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        <button type="button" class="md-edit-fab" onClick={() => setEditing(true)}>
          ✎ Full Editor
        </button>
      </div>
    );
  }

  // ── Card preview ──────────────────────────────────────────────

  return (
    <div style={{ height: '100%', position: 'relative' }}>
      {reviewBanner}
      {/* D5/H4: Same trust boundary as the split-editor preview above */}
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
        onClick={() => setEditing(true)}
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

/** Render a single markdown block as a read-only preview (used when another block is being edited). */
function BlockPreview({ block, index }: { block: string; index: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState('');

  useEffect(() => {
    renderMarkdown(block).then(setHtml);
  }, [block]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.replaceChildren();
    if (!html) return;
    const template = document.createElement('template');
    template.innerHTML = html;
    container.append(template.content.cloneNode(true));
  }, [html]);

  return (
    <div
      ref={containerRef}
      class="md-block-preview"
      data-block-idx={index}
      style={{ opacity: 0.6 }}
    />
  );
}
