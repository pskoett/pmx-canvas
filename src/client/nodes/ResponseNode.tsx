import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { renderMarkdown, submitCanvasPrompt } from '../state/intent-bridge';
import type { CanvasNodeState } from '../types';

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

export function ResponseNode({
  node,
  expanded = false,
}: { node: CanvasNodeState; expanded?: boolean }) {
  const content = (node.data.content as string) || '';
  const status = (node.data.status as string) || 'streaming';
  const [rendered, setRendered] = useState('');

  const isStreaming = status === 'streaming';
  const isComplete = status === 'complete';

  // Re-render markdown when content changes
  useEffect(() => {
    if (!content) {
      setRendered('');
      return;
    }
    let cancelled = false;
    renderMarkdown(content).then((html) => {
      if (!cancelled) setRendered(sanitizeHtml(html));
    });
    return () => {
      cancelled = true;
    };
  }, [content]);

  const handleReply = useCallback(() => {
    submitCanvasPrompt(
      '',
      { x: node.position.x, y: node.position.y + node.size.height + 24 },
      node.id,
    );
  }, [node]);

  return (
    <div
      class="response-node-inner"
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      {/* Streaming indicator */}
      {isStreaming && (
        <div
          class="response-streaming-bar"
          style={{
            height: '2px',
            background: 'linear-gradient(90deg, transparent, var(--c-accent), transparent)',
            animation: 'response-stream-pulse 1.5s ease-in-out infinite',
            borderRadius: '1px',
            marginBottom: '4px',
            flexShrink: 0,
          }}
        />
      )}

      {/* Rendered markdown content */}
      <div
        class={expanded ? 'md-reader' : undefined}
        style={{
          flex: 1,
          overflow: 'auto',
          minHeight: 0,
          opacity: content ? 1 : 0.4,
          transition: 'opacity 0.2s ease',
        }}
      >
        {rendered ? (
          <div class={expanded ? 'md-reader-content' : undefined}>
            <RenderedMarkdown html={rendered} />
          </div>
        ) : (
          <div style={{ color: 'var(--c-muted)', fontStyle: 'italic', fontSize: '13px' }}>
            {isStreaming ? 'Waiting for response…' : 'Empty response'}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingTop: '6px',
          borderTop: '1px solid var(--c-line)',
          marginTop: '4px',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: '10px',
            textTransform: 'uppercase',
            fontWeight: 600,
            color: isStreaming ? 'var(--c-accent)' : isComplete ? 'var(--c-ok)' : 'var(--c-muted)',
          }}
        >
          {isStreaming ? 'Streaming…' : isComplete ? 'Complete' : status}
        </span>
        {isComplete && (
          <button
            type="button"
            onClick={handleReply}
            style={{
              padding: '3px 10px',
              fontSize: '11px',
              background: 'rgba(70,182,255,0.1)',
              border: '1px solid rgba(70,182,255,0.3)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--c-accent)',
              cursor: 'pointer',
            }}
          >
            Reply
          </button>
        )}
      </div>
    </div>
  );
}
