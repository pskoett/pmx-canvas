import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { updateNodeData } from '../state/canvas-store';
import {
  fetchSlashCommands,
  renderMarkdown,
  submitCanvasPrompt,
  submitThreadReply,
} from '../state/intent-bridge';
import type { CanvasNodeState } from '../types';

// Cached slash commands — fetched once on first use.
let cachedCommands: Array<{ name: string; description: string }> | null = null;
async function getCommands() {
  if (!cachedCommands) cachedCommands = await fetchSlashCommands();
  return cachedCommands;
}

/** Find the best matching slash command for a query prefix. */
function matchSlashCommand(
  query: string,
  commands: Array<{ name: string }>,
): string | null {
  if (!query) return null;
  const lower = query.toLowerCase();
  const exact = commands.find((c) => c.name.toLowerCase() === lower);
  if (exact) return exact.name;
  const prefix = commands.filter((c) => c.name.toLowerCase().startsWith(lower));
  return prefix.length === 1 ? prefix[0].name : null;
}

interface ThreadTurn {
  role: 'user' | 'assistant';
  text: string;
  status?: string;
}

/** Strip dangerous HTML from rendered markdown to prevent XSS. */
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s>][\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s>][\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s>][\s\S]*?<\/object>/gi, '')
    .replace(/<embed[\s>][\s\S]*?(?:\/>|<\/embed>)/gi, '')
    .replace(/<link[\s>][\s\S]*?(?:\/>|<\/link>)/gi, '')
    .replace(/\bon\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/href\s*=\s*"javascript:[^"]*"/gi, 'href="#"')
    .replace(/href\s*=\s*'javascript:[^']*'/gi, "href='#'");
}

function RenderedMarkdown({ html }: { html: string }) {
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

  return <div ref={containerRef} />;
}

function getThreadTurnKey(turn: ThreadTurn, index: number): string {
  return `${turn.role}:${turn.status ?? 'none'}:${index}:${turn.text}`;
}

function ContextBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <div
      style={{
        padding: '4px 8px',
        fontSize: '11px',
        color: 'var(--c-accent)',
        background: 'rgba(70,182,255,0.08)',
        borderRadius: 'var(--radius-sm)',
        flexShrink: 0,
      }}
    >
      {'\u2726'} {count} context node{count !== 1 ? 's' : ''} attached
    </div>
  );
}

function ErrorBanner({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  if (!message) return null;
  return (
    <div
      style={{
        padding: '4px 8px',
        fontSize: '11px',
        color: 'var(--c-danger)',
        background: 'rgba(255,80,80,0.08)',
        borderRadius: 'var(--radius-sm)',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        flexShrink: 0,
      }}
    >
      <span style={{ flex: 1 }}>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--c-danger)',
          cursor: 'pointer',
          fontSize: '13px',
          padding: '0 2px',
        }}
      >
        {'\u00d7'}
      </button>
    </div>
  );
}

export function PromptNode({
  node,
  expanded = false,
}: { node: CanvasNodeState; expanded?: boolean }) {
  // Backward compat: old canvas states have flat { text, status } data.
  // New threads use { turns[], threadStatus }. Detect format by presence of turns array.
  const turns: ThreadTurn[] = Array.isArray(node.data.turns)
    ? (node.data.turns as ThreadTurn[])
    : [];
  const isLegacy = turns.length === 0;
  const legacyText = (node.data.text as string) || '';
  const legacyStatus = (node.data.status as string) || 'draft';

  const threadStatus = isLegacy ? legacyStatus : (node.data.threadStatus as string) || 'draft';
  const isDraft = threadStatus === 'draft';
  const isPending = threadStatus === 'pending' || threadStatus === 'sending';
  const isStreaming = threadStatus === 'streaming';
  const isAnswered = threadStatus === 'answered';

  const [draft, setDraft] = useState('');
  const [replyDraft, setReplyDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [renderedTurns, setRenderedTurns] = useState<Map<number, string>>(new Map());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Lightweight scroll key: tracks turn count + last turn length bucket (every 200 chars)
  // to avoid re-scrolling on every single token delta.
  const lastTurn = turns[turns.length - 1];
  const threadScrollKey = `${turns.length}:${lastTurn?.role ?? ''}:${lastTurn?.status ?? ''}:${Math.floor((lastTurn?.text?.length ?? 0) / 200)}`;

  // Auto-focus textarea when expanded
  useEffect(() => {
    if (expanded && isDraft && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [expanded, isDraft]);

  // Auto-scroll to bottom when turns change, with smooth behavior
  useEffect(() => {
    if (!threadScrollKey) return;
    if (bodyRef.current) {
      bodyRef.current.scrollTo({
        top: bodyRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [threadScrollKey]);

  // Debounced markdown rendering for assistant turns.
  // During streaming, coalesce rapid deltas and re-render at most every 400ms
  // to keep formatting visible without per-token render overhead.
  // Completed turns render immediately.
  const renderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;

  useEffect(() => {
    const hasStreaming = turns.some((t) => t.role === 'assistant' && t.status === 'streaming');

    const doRender = () => {
      let cancelled = false;
      const current = turnsRef.current;
      const assistantTurns = current
        .map((t, i) => ({ turn: t, index: i }))
        .filter(({ turn }) => turn.role === 'assistant' && turn.text);

      if (assistantTurns.length === 0) return;

      Promise.all(
        assistantTurns.map(async ({ turn, index }) => {
          const html = await renderMarkdown(turn.text);
          return { index, html: sanitizeHtml(html) };
        }),
      ).then((results) => {
        if (cancelled) return;
        const next = new Map<number, string>();
        for (const r of results) next.set(r.index, r.html);
        setRenderedTurns(next);
      });

      return () => { cancelled = true; };
    };

    if (!hasStreaming) {
      // Not streaming — render immediately, cancel any pending debounce
      if (renderTimerRef.current) {
        clearTimeout(renderTimerRef.current);
        renderTimerRef.current = null;
      }
      return doRender();
    }

    // Streaming — trailing-edge debounce: reset timer on each delta,
    // render 400ms after the last one.
    if (renderTimerRef.current) {
      clearTimeout(renderTimerRef.current);
    }
    renderTimerRef.current = setTimeout(() => {
      renderTimerRef.current = null;
      doRender();
    }, 400);

    return () => {
      if (renderTimerRef.current) {
        clearTimeout(renderTimerRef.current);
        renderTimerRef.current = null;
      }
    };
  }, [turns]);

  const handleSubmit = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const savedDraft = draft;
    setError(null);
    // Transition to turns-based model on first submit
    updateNodeData(node.id, {
      turns: [{ role: 'user', text: trimmed, status: 'pending' }],
      threadStatus: 'pending',
      text: trimmed, // keep for backward compat display
    });
    setDraft('');
    const ctxIds = Array.isArray(node.data.contextNodeIds)
      ? (node.data.contextNodeIds as string[])
      : undefined;
    const result = await submitCanvasPrompt(trimmed, node.position, node.id, ctxIds, node.id);
    if (!result.ok) {
      updateNodeData(node.id, { turns: [], threadStatus: 'draft', text: '', status: 'draft' });
      setDraft(savedDraft);
      setError('Failed to send prompt. Your draft has been restored.');
    }
  }, [draft, node.id, node.position, node.data.contextNodeIds]);

  const handleReplySubmit = useCallback(async () => {
    const trimmed = replyDraft.trim();
    if (!trimmed) return;
    const savedReply = replyDraft;
    setError(null);
    // Optimistically add user turn
    const currentTurns = Array.isArray(node.data.turns)
      ? [...(node.data.turns as ThreadTurn[])]
      : [];
    currentTurns.push({ role: 'user', text: trimmed, status: 'pending' });
    updateNodeData(node.id, { turns: currentTurns, threadStatus: 'pending' });
    setReplyDraft('');
    const result = await submitThreadReply(node.id, trimmed);
    if (!result.ok) {
      // Remove the optimistic turn
      currentTurns.pop();
      updateNodeData(node.id, { turns: currentTurns, threadStatus: 'answered' });
      setReplyDraft(savedReply);
      setError('Failed to send reply. Your draft has been restored.');
    }
  }, [replyDraft, node.id, node.data.turns]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
        return;
      }
      // Tab completes slash commands (e.g. "/rev" → "/review")
      if (e.key === 'Tab' && draft.startsWith('/')) {
        e.preventDefault();
        const query = draft.slice(1).split(/\s/)[0];
        if (query) {
          getCommands().then((cmds) => {
            const match = matchSlashCommand(query, cmds);
            if (match) setDraft(`/${match}`);
          });
        }
      }
    },
    [handleSubmit, draft],
  );

  const handleReplyKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleReplySubmit();
        return;
      }
      if (e.key === 'Tab' && replyDraft.startsWith('/')) {
        e.preventDefault();
        const query = replyDraft.slice(1).split(/\s/)[0];
        if (query) {
          getCommands().then((cmds) => {
            const match = matchSlashCommand(query, cmds);
            if (match) setReplyDraft(`/${match}`);
          });
        }
      }
    },
    [handleReplySubmit, replyDraft],
  );

  const ctxCount = Array.isArray(node.data.contextNodeIds)
    ? (node.data.contextNodeIds as string[]).length
    : 0;

  // ── Draft mode (no turns yet): show initial textarea ──
  if (isDraft && turns.length === 0) {
    return (
      <div
        class="prompt-node-inner"
        style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '8px' }}
      >
        <ContextBadge count={ctxCount} />
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
        <textarea
          ref={textareaRef}
          value={draft}
          onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask the agent something…"
          spellcheck={false}
          style={{
            flex: 1,
            resize: 'none',
            background: 'rgba(10,14,30,0.4)',
            border: '1px solid var(--c-line)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--c-text)',
            fontFamily: 'var(--font)',
            fontSize: '13px',
            lineHeight: '1.5',
            padding: '8px 10px',
            outline: 'none',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '10px', color: 'var(--c-muted)' }}>{'\u2318'}+Enter to send</span>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!draft.trim()}
            style={{
              padding: '5px 14px',
              fontSize: '12px',
              fontWeight: 600,
              background: draft.trim() ? 'var(--c-accent)' : 'var(--c-line)',
              color: draft.trim() ? 'var(--c-contrast-fg)' : 'var(--c-muted)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: draft.trim() ? 'pointer' : 'default',
            }}
          >
            Send
          </button>
        </div>
      </div>
    );
  }

  // ── Legacy flat format (old nodes without turns) ──
  if (isLegacy) {
    return (
      <div
        class="prompt-node-inner"
        style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
      >
        <div
          style={{
            flex: 1,
            padding: '2px 0',
            fontSize: '13px',
            lineHeight: '1.55',
            color: 'var(--c-text)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflow: 'auto',
          }}
        >
          {legacyText}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: '6px',
            borderTop: '1px solid var(--c-line)',
            marginTop: '4px',
          }}
        >
          <span
            style={{
              fontSize: '10px',
              textTransform: 'uppercase',
              fontWeight: 600,
              color: isPending ? 'var(--c-warn)' : isAnswered ? 'var(--c-ok)' : 'var(--c-muted)',
            }}
          >
            {isPending ? 'Sending…' : isAnswered ? 'Answered' : legacyStatus}
          </span>
        </div>
      </div>
    );
  }

  // ── Thread view: render all turns ──
  return (
    <div
      class="prompt-node-inner"
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      <ContextBadge count={ctxCount} />
      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {/* Conversation turns */}
      <div ref={bodyRef} style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {turns.map((turn, i) => (
          <div key={getThreadTurnKey(turn, i)}>
            {i > 0 && <div class="thread-turn-divider" />}
            {turn.role === 'user' ? (
              <div class="thread-turn-user">
                <div class="thread-turn-role"><span class="status-dot" />You</div>
                <div
                  style={{
                    fontSize: expanded ? '15px' : '13px',
                    lineHeight: expanded ? '1.7' : '1.55',
                    color: 'var(--c-text)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {turn.text}
                </div>
              </div>
            ) : (
              <div class="thread-turn-assistant">
                <div class="thread-turn-role"><span class={`status-dot${turn.status === 'streaming' ? ' pulsing' : ''}`} />PMX</div>
                {turn.status === 'streaming' && !turn.text && (
                  <div
                    style={{
                      height: '2px',
                      background: 'linear-gradient(90deg, transparent, var(--c-ok), transparent)',
                      animation: 'response-stream-pulse 1.5s ease-in-out infinite',
                      borderRadius: '1px',
                      marginBottom: '4px',
                    }}
                  />
                )}
                <div
                  class={expanded ? 'md-reader-content' : undefined}
                  style={{
                    fontSize: expanded ? undefined : '13px',
                    lineHeight: expanded ? undefined : '1.55',
                    opacity: turn.text ? 1 : 0.4,
                  }}
                >
                  {renderedTurns.get(i) ? (
                    <>
                      <RenderedMarkdown html={renderedTurns.get(i) ?? ''} />
                      {turn.status === 'streaming' && <span class="streaming-cursor" />}
                    </>
                  ) : (
                    <div style={{ color: 'var(--c-muted)', fontStyle: 'italic' }}>
                      {turn.status === 'streaming'
                        ? 'Waiting for response…'
                        : turn.text || 'Empty response'}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer: status + reply area */}
      <div
        style={{
          flexShrink: 0,
          borderTop: '1px solid var(--c-line)',
          marginTop: '4px',
          paddingTop: '6px',
        }}
      >
        {/* Status bar */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: isAnswered ? '6px' : 0,
          }}
        >
          <span
            style={{
              fontSize: '10px',
              textTransform: 'uppercase',
              fontWeight: 600,
              color: isStreaming
                ? 'var(--c-accent)'
                : isPending
                  ? 'var(--c-warn)'
                  : isAnswered
                    ? 'var(--c-ok)'
                    : 'var(--c-muted)',
            }}
          >
            {isStreaming
              ? 'Streaming…'
              : isPending
                ? 'Sending…'
                : isAnswered
                  ? 'Answered'
                  : threadStatus}
          </span>
          <span style={{ fontSize: '10px', color: 'var(--c-muted)' }}>
            {turns.length} turn{turns.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Reply textarea when answered */}
        {isAnswered && (
          <div class="thread-reply-area">
            <textarea
              value={replyDraft}
              onInput={(e) => setReplyDraft((e.target as HTMLTextAreaElement).value)}
              onKeyDown={handleReplyKeyDown}
              placeholder="Reply…"
              spellcheck={false}
              rows={2}
              style={{
                width: '100%',
                resize: 'none',
                background: 'rgba(10,14,30,0.4)',
                border: '1px solid var(--c-line)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--c-text)',
                fontFamily: 'var(--font)',
                fontSize: '12px',
                lineHeight: '1.5',
                padding: '6px 8px',
                outline: 'none',
              }}
            />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: '4px',
              }}
            >
              <span style={{ fontSize: '10px', color: 'var(--c-muted)' }}>{'\u2318'}+Enter</span>
              <button
                type="button"
                onClick={handleReplySubmit}
                disabled={!replyDraft.trim()}
                style={{
                  padding: '3px 10px',
                  fontSize: '11px',
                  fontWeight: 600,
                  background: replyDraft.trim() ? 'var(--c-accent)' : 'var(--c-line)',
                  color: replyDraft.trim() ? 'var(--c-contrast-fg)' : 'var(--c-muted)',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: replyDraft.trim() ? 'pointer' : 'default',
                }}
              >
                Reply
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
