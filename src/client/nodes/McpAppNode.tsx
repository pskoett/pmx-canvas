import type { CanvasNodeState } from '../types';
import { canvasTheme } from '../state/canvas-store';
import { ExtAppFrame } from './ExtAppFrame';

function withTheme(url: string): string {
  if (!url) return url;
  try {
    const resolved = new URL(url, window.location.origin);
    resolved.searchParams.set('theme', canvasTheme.value === 'light' ? 'light' : 'dark');
    return resolved.toString();
  } catch {
    return url;
  }
}

export function McpAppNode({ node }: { node: CanvasNodeState }) {
  if (node.data.mode === 'ext-app') {
    return <ExtAppFrame node={node} />;
  }

  const url = withTheme((node.data.url as string) || '');
  const sourceServer = (node.data.sourceServer as string) || '';
  const hostMode = (node.data.hostMode as string) || 'hosted';
  const fallbackReason = node.data.fallbackReason as string | undefined;
  const trustedDomain = node.data.trustedDomain as boolean | undefined;

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
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
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
      {/* H7: Sandbox attrs mirror the legacy editor. allow-same-origin is required
          for MCP apps to communicate with their own backend via fetch/XHR. This is
          safe because MCP app URLs are only surfaced from trusted MCP servers running
          on localhost or explicitly trusted domains. */}
      <iframe
        src={url}
        class="mcp-app-frame"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        allow="clipboard-read; clipboard-write"
        loading="lazy"
        style={{ flex: 1 }}
        title={`MCP App: ${sourceServer}`}
      />
    </div>
  );
}
