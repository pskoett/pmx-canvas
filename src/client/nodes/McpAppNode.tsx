import { useEffect, useMemo, useRef } from 'preact/hooks';
import type { CanvasNodeState } from '../types';
import { axSurfaceState, canvasTheme } from '../state/canvas-store';
import { shouldContentFitIframeNode } from '../canvas/auto-fit';
import { submitAxInteractionFromClient } from '../state/intent-bridge';
import { showToast } from '../state/attention-bridge';
import { ExtAppFrame } from './ExtAppFrame';
import { useIframeContentHeight } from './use-iframe-content-height';

function withViewerParams(
  url: string,
  expanded: boolean,
  specVersion?: number,
  axToken?: string,
  axNodeId?: string,
  frameToken?: string,
  fitContent?: boolean,
): string {
  if (!url) return url;
  try {
    const resolved = new URL(url, window.location.origin);
    resolved.searchParams.set('theme', canvasTheme.value === 'light' ? 'light' : 'dark');
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

  // Receive AX emits forwarded by the json-render viewer; validate (bound to this
  // node's iframe + nonce + node id) and submit through the capability-gated
  // endpoint, which re-validates server-side.
  useEffect(() => {
    if (!isAxViewer || !axToken) return;
    function onAxMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as {
        source?: string;
        token?: string;
        nodeId?: string;
        correlationId?: string;
        interaction?: { type?: unknown; payload?: unknown };
      } | null;
      if (!data || data.source !== 'pmx-canvas-ax' || data.token !== axToken || data.nodeId !== node.id) return;
      const interaction = data.interaction;
      if (!interaction || typeof interaction.type !== 'string') return;
      const interactionType = interaction.type;
      void submitAxInteractionFromClient({
        type: interactionType,
        sourceNodeId: node.id,
        sourceSurface: axSurface,
        ...(interaction.payload && typeof interaction.payload === 'object'
          ? { payload: interaction.payload as Record<string, unknown> }
          : {}),
      }).then((res) => {
        if (res.ok) showToast('context', 'AX interaction', interactionType, [node.id]);
        else showToast('remove', 'AX interaction rejected', res.error ?? res.code ?? '', [node.id]);
        // Report #55: ack back to the viewer so the surface can self-confirm.
        iframeRef.current?.contentWindow?.postMessage(
          {
            source: 'pmx-canvas-ax-ack',
            token: axToken,
            ...(data.correlationId ? { correlationId: data.correlationId } : {}),
            interaction: { type: interactionType },
            result: res,
          },
          '*',
        );
      });
    }
    window.addEventListener('message', onAxMessage);
    return () => window.removeEventListener('message', onAxMessage);
  }, [isAxViewer, axToken, node.id]);

  // Read-side: push live AX state into the json-render viewer so a spec bound to
  // /ax reflects the work queue. Validated by the viewer against axToken.
  const axStateValue = axSurfaceState.value;
  const pushAxState = () => {
    if (!isAxViewer || !axToken || axStateValue == null) return;
    iframeRef.current?.contentWindow?.postMessage(
      {
        source: 'pmx-canvas-html-node',
        type: 'ax-update',
        token: axToken,
        state: axStateValue,
      },
      '*',
    );
  };
  useEffect(pushAxState, [isAxViewer, axToken, axStateValue]);

  const specVersion = typeof node.data.specVersion === 'number' ? node.data.specVersion : undefined;
  const url = withViewerParams(
    (node.data.url as string) || '',
    expanded,
    specVersion,
    axToken || undefined,
    isAxViewer ? node.id : undefined,
    frameToken || undefined,
    contentFit,
  );
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
        {sourceServer && <div style={{ color: 'var(--c-dim)', fontSize: '10px' }}>Source: {sourceServer}</div>}
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
        ref={iframeRef}
        src={url}
        class="mcp-app-frame"
        sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
        allow="clipboard-read; clipboard-write"
        loading="lazy"
        onLoad={pushAxState}
        style={{ flex: 1, minHeight: 0, width: '100%' }}
        title={`MCP App: ${sourceServer}`}
      />
    </div>
  );
}
