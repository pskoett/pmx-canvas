import type { CanvasNodeState } from '../types';
import { canvasTheme } from '../state/canvas-store';
import { ExtAppFrame } from './ExtAppFrame';

function withViewerParams(url: string, expanded: boolean, specVersion?: number): string {
  if (!url) return url;
  try {
    const resolved = new URL(url, window.location.origin);
    resolved.searchParams.set('theme', canvasTheme.value === 'light' ? 'light' : 'dark');
    if (expanded) resolved.searchParams.set('display', 'expanded');
    // Streaming json-render nodes bump specVersion as patches accumulate; including
    // it in the src reloads the iframe so it re-reads the latest accumulated spec.
    if (typeof specVersion === 'number') resolved.searchParams.set('v', String(specVersion));
    return resolved.toString();
  } catch {
    return url;
  }
}

export function isSameOriginFrameDocumentUrl(url: string, origin = window.location.origin): boolean {
  if (!url) return false;
  try {
    const baseOrigin = new URL(origin).origin;
    const resolved = new URL(url, baseOrigin);
    return resolved.origin === baseOrigin &&
      resolved.pathname.startsWith('/api/canvas/frame-documents/');
  } catch {
    return false;
  }
}

export function McpAppNode({ node, expanded = false }: { node: CanvasNodeState; expanded?: boolean }) {
  if (node.data.mode === 'ext-app') {
    return <ExtAppFrame node={node} expanded={expanded} />;
  }

  const specVersion = typeof node.data.specVersion === 'number' ? node.data.specVersion : undefined;
  const url = withViewerParams((node.data.url as string) || '', expanded, specVersion);
  const sourceServer = (node.data.sourceServer as string) || '';
  const hostMode = (node.data.hostMode as string) || 'hosted';
  const fallbackReason = node.data.fallbackReason as string | undefined;
  const trustedDomain = node.data.trustedDomain === true || isSameOriginFrameDocumentUrl(url);

  if (hostMode === 'fallback') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
        <div style={{ color: 'var(--c-warn)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>⚠</span>
          <span>Cannot embed — opened externally</span>
        </div>
        {fallbackReason && (
          <div style={{ color: 'var(--c-muted)', fontSize: '11px' }}>Reason: {fallbackReason}</div>
        )}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: 'var(--c-accent)',
            fontSize: '12px',
            wordBreak: 'break-all',
          }}
        >
          {url}
        </a>
        {sourceServer && (
          <div style={{ color: 'var(--c-dim)', fontSize: '10px' }}>Source: {sourceServer}</div>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        ...(expanded ? { flex: 1, minHeight: 0, width: '100%' } : {}),
      }}
    >
      {!trustedDomain && (
        <div
          style={{
            padding: '4px 8px',
            fontSize: '10px',
            background: 'var(--c-warn-10)',
            color: 'var(--c-warn)',
            borderBottom: '1px solid var(--c-warn-15)',
          }}
        >
          Unverified domain
        </div>
      )}
      {/* Plain iframe-backed viewers stay on an opaque origin. Hosted ext-apps use
          the explicit postMessage bridge instead, which is the only path that needs
          app/host RPC and broader capabilities. */}
      <iframe
        src={url}
        class="mcp-app-frame"
        sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
        allow="clipboard-read; clipboard-write"
        loading="lazy"
        style={{ flex: 1, minHeight: 0, width: '100%' }}
        title={`MCP App: ${sourceServer}`}
      />
    </div>
  );
}
