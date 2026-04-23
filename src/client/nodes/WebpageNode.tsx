import { useCallback, useEffect, useState } from 'preact/hooks';
import { refreshWebpageNodeFromClient } from '../state/intent-bridge';
import type { CanvasNodeState } from '../types';

function formatHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function formatFetchedAt(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

export function WebpageNode({ node, expanded = false }: { node: CanvasNodeState; expanded?: boolean }) {
  const url = typeof node.data.url === 'string' ? node.data.url : '';
  const pageTitle = typeof node.data.pageTitle === 'string' ? node.data.pageTitle : '';
  const description = typeof node.data.description === 'string' ? node.data.description : '';
  const excerpt = typeof node.data.excerpt === 'string'
    ? node.data.excerpt
    : typeof node.data.content === 'string'
      ? node.data.content
      : '';
  const status = typeof node.data.status === 'string' ? node.data.status : 'idle';
  const error = typeof node.data.error === 'string' ? node.data.error : '';
  const fetchedAt = formatFetchedAt(typeof node.data.fetchedAt === 'string' ? node.data.fetchedAt : undefined);
  const statusCode = typeof node.data.statusCode === 'number' ? node.data.statusCode : null;
  const imageUrl = typeof node.data.imageUrl === 'string' ? node.data.imageUrl : '';
  const frameBlocked = node.data.frameBlocked === true;
  const frameBlockedReason = typeof node.data.frameBlockedReason === 'string' ? node.data.frameBlockedReason : '';
  const [refreshing, setRefreshing] = useState(false);
  const [showEmbed, setShowEmbed] = useState(expanded);

  useEffect(() => {
    if (expanded) {
      setShowEmbed(true);
    }
  }, [expanded]);

  const handleRefresh = useCallback(async () => {
    if (!url || refreshing) return;
    setRefreshing(true);
    try {
      await refreshWebpageNodeFromClient(node.id);
    } finally {
      setRefreshing(false);
    }
  }, [node.id, refreshing, url]);

  if (!url) {
    return <div style={{ color: 'var(--c-dim)', fontStyle: 'italic', padding: '12px' }}>No webpage URL set</div>;
  }

  const statusTone =
    status === 'ready'
      ? 'var(--c-ok)'
      : status === 'error'
        ? 'var(--c-danger)'
        : 'var(--c-warn)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: '12px', color: 'var(--c-muted)' }}>{formatHost(url)}</div>
          <div style={{ fontSize: expanded ? '18px' : '15px', fontWeight: 700, color: 'var(--c-text)' }}>
            {pageTitle || (node.data.title as string) || url}
          </div>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--c-accent)', fontSize: '12px', wordBreak: 'break-all', textDecoration: 'none' }}
          >
            {url}
          </a>
        </div>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 8px',
            borderRadius: '999px',
            background: 'rgba(255,255,255,0.04)',
            color: statusTone,
            fontSize: '11px',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            flexShrink: 0,
          }}
        >
          <span style={{ width: '7px', height: '7px', borderRadius: '999px', background: statusTone }} />
          {status}
        </div>
      </div>

      {(description || imageUrl) && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: imageUrl && expanded ? '160px 1fr' : '1fr',
            gap: '12px',
            alignItems: 'start',
          }}
        >
          {imageUrl && expanded && (
            <img
              src={imageUrl}
              alt={pageTitle || 'Webpage preview image'}
              style={{
                width: '160px',
                height: '96px',
                objectFit: 'cover',
                borderRadius: '10px',
                border: '1px solid var(--c-line)',
                background: 'var(--c-panel-soft)',
              }}
            />
          )}
          {description && (
            <p style={{ margin: 0, color: 'var(--c-text-soft)', lineHeight: 1.5, fontSize: expanded ? '14px' : '12px' }}>
              {description}
            </p>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          style={{
            border: '1px solid var(--c-line)',
            background: 'var(--c-panel-soft)',
            color: 'var(--c-text)',
            borderRadius: '8px',
            padding: '6px 10px',
            cursor: refreshing ? 'progress' : 'pointer',
            fontSize: '12px',
          }}
        >
          {refreshing || status === 'fetching' ? 'Refreshing…' : 'Refresh'}
        </button>
        {expanded && !frameBlocked && (
          <button
            type="button"
            onClick={() => setShowEmbed((current) => !current)}
            style={{
              border: '1px solid var(--c-line)',
              background: 'var(--c-panel-soft)',
              color: 'var(--c-text)',
              borderRadius: '8px',
              padding: '6px 10px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            {showEmbed ? 'Hide live preview' : 'Show live preview'}
          </button>
        )}
        <button
          type="button"
          onClick={() => window.open(url, '_blank', 'noopener')}
          style={{
            border: '1px solid var(--c-line)',
            background: 'transparent',
            color: 'var(--c-accent)',
            borderRadius: '8px',
            padding: '6px 10px',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          Open in browser
        </button>
      </div>

      {expanded && frameBlocked && (
        <div
          style={{
            border: '1px solid var(--c-line)',
            borderRadius: '12px',
            overflow: 'hidden',
            background: 'var(--c-panel-soft)',
          }}
        >
          <div
            style={{
              padding: '8px 12px',
              fontSize: '11px',
              color: 'var(--c-muted)',
              borderBottom: '1px solid var(--c-line)',
              background: 'rgba(255,255,255,0.03)',
            }}
          >
            Live preview unavailable. This site refuses embedding, so PMX Canvas cannot show it inline.
          </div>
          <div
            style={{
              padding: '20px',
              color: 'var(--c-text-soft)',
              lineHeight: 1.6,
              fontSize: '13px',
            }}
          >
            {frameBlockedReason || 'The remote site blocks iframe embedding.'}
          </div>
        </div>
      )}

      {expanded && showEmbed && !frameBlocked && (
        <div
          style={{
            border: '1px solid var(--c-line)',
            borderRadius: '12px',
            overflow: 'hidden',
            background: 'var(--c-panel-soft)',
          }}
        >
          <div
            style={{
              padding: '8px 12px',
              fontSize: '11px',
              color: 'var(--c-muted)',
              borderBottom: '1px solid var(--c-line)',
              background: 'rgba(255,255,255,0.03)',
            }}
          >
            Live preview (best effort). If this stays blank, the site likely blocks framing. The cached text snapshot below still works.
          </div>
          <iframe
            class="webpage-node-iframe"
            title={pageTitle || (node.data.title as string) || url}
            src={url}
            loading="lazy"
            referrerPolicy="no-referrer"
            sandbox="allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-presentation allow-scripts"
            style={{
              display: 'block',
              width: '100%',
              height: expanded ? '320px' : '180px',
              border: 'none',
              background: '#fff',
            }}
          />
        </div>
      )}

      {(fetchedAt || statusCode !== null) && (
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', color: 'var(--c-muted)', fontSize: '11px' }}>
          {fetchedAt && <span>Fetched {fetchedAt}</span>}
          {statusCode !== null && <span>HTTP {statusCode}</span>}
          {frameBlocked && <span>Preview blocked by site</span>}
        </div>
      )}

      {error && <div style={{ color: 'var(--c-danger)', fontSize: '12px', lineHeight: 1.5 }}>{error}</div>}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          border: '1px solid var(--c-line)',
          borderRadius: '10px',
          background: 'var(--c-panel-soft)',
          padding: expanded ? '14px' : '10px',
        }}
      >
        {excerpt ? (
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55, color: 'var(--c-text)', fontSize: expanded ? '14px' : '12px' }}>
            {excerpt}
          </div>
        ) : (
          <div style={{ color: 'var(--c-dim)', fontStyle: 'italic' }}>
            {status === 'error' ? 'No cached page text available.' : 'Waiting for page text...'}
          </div>
        )}
      </div>
    </div>
  );
}
