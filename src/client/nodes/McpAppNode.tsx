import { useEffect, useMemo, useRef } from 'preact/hooks';
import { HTML_SURFACE_PUSH_SOURCE } from '../../shared/ax-surface-protocol.js';
import { canvasThemeScheme } from '../../shared/themes.js';
import type { CanvasNodeState } from '../types';
import { axSurfaceState, canvasTheme } from '../state/canvas-store';
import { RefreshingViewerFrame } from './ViewerFrame';
import { shouldContentFitIframeNode } from '../canvas/auto-fit';
import { ExtAppFrame } from './ExtAppFrame';
import { useAxSurfaceBridge } from './use-ax-surface-bridge';
import { useIframeContentHeight } from './use-iframe-content-height';
import { useSurfaceFrame } from './use-surface-frame';
import { restoreViewerRuntimeState } from './viewer-runtime-state';
import { isHostedWorkbench } from '../state/workbench-transport';

function withViewerParams(
  url: string,
  theme: string,
  expanded: boolean,
  specVersion?: number,
  axToken?: string,
  axNodeId?: string,
  frameToken?: string,
  fitContent?: boolean,
  stateToken?: string,
): string {
  if (!url) return url;
  try {
    const hosted = isHostedWorkbench() && url.startsWith('/');
    const resolved = new URL(url, hosted ? 'https://pmx.invalid' : window.location.origin);
    resolved.searchParams.set('theme', theme);
    if (expanded) resolved.searchParams.set('display', 'expanded');
    // Streaming json-render nodes bump specVersion as patches accumulate; including
    // it in the src reloads the iframe so it re-reads the latest accumulated spec.
    if (typeof specVersion === 'number') resolved.searchParams.set('v', String(specVersion));
    // AX bridge nonce for json-render/graph + web-artifact viewer nodes.
    if (axToken) resolved.searchParams.set('axToken', axToken);
    // The /artifact route needs the node id to inject the AX/content bridges (the
    // json-render view route already gets nodeId from its own query param).
    if (axNodeId) resolved.searchParams.set('axNodeId', axNodeId);
    // Content-fit: report natural height (charts render intrinsic) so the node grows.
    if (frameToken) resolved.searchParams.set('frameToken', frameToken);
    if (fitContent) resolved.searchParams.set('fit', 'content');
    if (stateToken) resolved.searchParams.set('stateToken', stateToken);
    return hosted ? `${resolved.pathname}${resolved.search}` : resolved.toString();
  } catch {
    return url;
  }
}

export function isSameOriginFrameDocumentUrl(url: string, origin = window.location.origin): boolean {
  if (!url) return false;
  try {
    const baseOrigin = new URL(origin).origin;
    const resolved = new URL(url, baseOrigin);
    return resolved.origin === baseOrigin && resolved.pathname.startsWith('/api/canvas/frame-documents/');
  } catch {
    return false;
  }
}

export function McpAppNode({ node, expanded = false }: { node: CanvasNodeState; expanded?: boolean }) {
  if (node.data.mode === 'ext-app') {
    return <ExtAppFrame node={node} expanded={expanded} />;
  }
  return <McpAppViewer node={node} expanded={expanded} />;
}

function McpAppViewer({ node, expanded }: { node: CanvasNodeState; expanded: boolean }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // json-render / graph viewers run the json-render bundle, which forwards spec
  // actions named ax.* to us. AX-enabled web-artifacts get the same emit+read
  // bridge injected at the /artifact route. Hosted URL viewers do not.
  const isWebArtifact = node.type === 'mcp-app' && node.data.viewerType === 'web-artifact';
  const isJsonViewer = node.type === 'json-render' || node.type === 'graph';
  const axFlag = (node.data.axCapabilities as { enabled?: boolean } | undefined)?.enabled;
  // json-render/graph are AX-enabled by default (opt OUT with enabled:false, matching
  // the server seed gate); web-artifacts opt IN. So an opted-out viewer is not treated
  // as an AX viewer — no token, no emit, no read-state push.
  const axOn = isWebArtifact ? axFlag === true : axFlag !== false;
  const isAxViewer = (isJsonViewer || isWebArtifact) && axOn;
  const axSurface: 'json-render' | 'mcp-app' = isWebArtifact ? 'mcp-app' : 'json-render';
  const axToken = useMemo(() => (isAxViewer ? `ax-${crypto.randomUUID()}` : ''), [isAxViewer]);
  // Content-fit: grow the node to the viewer's natural height (charts render
  // intrinsic via fit=content). Gated by shouldContentFitIframeNode (json-render /
  // graph / web-artifact, unless strictSize / user-resized / docked / collapsed).
  // NEVER in the expanded overlay — there the chart must stretch to fill the large
  // overlay frame (fill-down), not sit at its intrinsic in-canvas height.
  const contentFit = shouldContentFitIframeNode(node) && !expanded;
  const frameToken = useMemo(() => (contentFit ? `frame-${crypto.randomUUID()}` : ''), [contentFit]);
  useIframeContentHeight(node, iframeRef, frameToken);

  // AX emits forwarded by the json-render viewer — the shared sandboxed-surface
  // trust boundary (M2).
  useAxSurfaceBridge({
    enabled: isAxViewer && Boolean(axToken),
    token: axToken,
    nodeId: node.id,
    sourceSurface: axSurface,
    iframeRef,
  });

  // Read-side: push live AX state into the json-render viewer so a spec bound to
  // /ax reflects the work queue. Validated by the viewer against axToken.
  const axStateValue = axSurfaceState.value;
  const pushAxState = () => {
    if (!isAxViewer || !axToken || axStateValue == null) return;
    iframeRef.current?.contentWindow?.postMessage(
      {
        source: HTML_SURFACE_PUSH_SOURCE,
        type: 'ax-update',
        token: axToken,
        state: axStateValue,
      },
      '*',
    );
  };
  useEffect(pushAxState, [isAxViewer, axToken, axStateValue]);

  const specVersion = typeof node.data.specVersion === 'number' ? node.data.specVersion : undefined;
  const stateToken = useMemo(
    () => (isJsonViewer ? `ui-${crypto.randomUUID()}` : ''),
    [isJsonViewer, specVersion, node.data.url],
  );
  const theme = canvasTheme.value;
  const urlTheme = isJsonViewer ? null : canvasThemeScheme(theme);
  const pushTheme = () => {
    if (!isJsonViewer) return;
    iframeRef.current?.contentWindow?.postMessage(
      {
        source: HTML_SURFACE_PUSH_SOURCE,
        type: 'theme-update',
        token: stateToken,
        theme: node.data.theme ?? theme,
        title: node.data.title,
      },
      '*',
    );
  };
  useEffect(pushTheme, [theme, stateToken, node.data.theme, node.data.title]);
  // Only JSON/graph understand theme messages and retain drafts across themes.
  // Generic viewers consume a dark/light query and navigate when it changes.
  const url = useMemo(
    () =>
      withViewerParams(
        (node.data.url as string) || '',
        urlTheme ?? theme,
        expanded,
        specVersion,
        axToken || undefined,
        isAxViewer ? node.id : undefined,
        frameToken || undefined,
        contentFit,
        stateToken || undefined,
      ),
    [node.data.url, urlTheme, expanded, specVersion, axToken, node.id, frameToken, contentFit, stateToken],
  );
  // src vs fetch()+srcdoc, decided by the boot-wide embed probe (Amp portals).
  // External viewer URLs always stay src — the hook passes them through.
  const surfaceFrame = useSurfaceFrame(url);
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
        {fallbackReason && <div style={{ color: 'var(--c-muted)', fontSize: '11px' }}>Reason: {fallbackReason}</div>}
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
          <div style={{ color: 'var(--c-dim)', fontSize: 'var(--fs-meta)' }}>Source: {sourceServer}</div>
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
            fontSize: 'var(--fs-meta)',
            background: 'color-mix(in srgb, var(--c-warn) 10%, transparent)',
            color: 'var(--c-warn)',
            borderBottom: '1px solid color-mix(in srgb, var(--c-warn) 15%, transparent)',
          }}
        >
          Unverified domain
        </div>
      )}
      {/* Plain iframe-backed viewers stay on an opaque origin. Hosted ext-apps use
          the explicit postMessage bridge instead, which is the only path that needs
          app/host RPC and broader capabilities. */}
      <RefreshingViewerFrame
        source={surfaceFrame}
        iframeRef={iframeRef}
        allow="clipboard-read; clipboard-write"
        onDocumentLoad={(frame, signal) => {
          if (stateToken && frame.contentWindow)
            return restoreViewerRuntimeState(node, stateToken, frame.contentWindow, signal);
        }}
        onLoad={() => {
          pushAxState();
          pushTheme();
        }}
        title={`MCP App: ${sourceServer}`}
      />
    </div>
  );
}
