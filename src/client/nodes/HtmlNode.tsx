import { useEffect, useMemo, useRef } from 'preact/hooks';
import { axSurfaceState, canvasTheme } from '../state/canvas-store';
import { submitAxInteractionFromClient } from '../state/intent-bridge';
import { showToast } from '../state/attention-bridge';
import type { CanvasNodeState } from '../types';
import { nodeSurfaceUrl, surfaceContentHash } from './surface-url';
import { useIframeContentHeight } from './use-iframe-content-height';

export function shouldShowPresentationControls(node: CanvasNodeState): boolean {
  return node.type === 'html' && node.data.presentation === true;
}

export function HtmlNode({
  node,
  expanded = false,
  presentation = false,
  presentationExitToken,
  autoFocus = false,
}: { node: CanvasNodeState; expanded?: boolean; presentation?: boolean; presentationExitToken?: string; autoFocus?: boolean }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const theme = canvasTheme.value;
  // Stable per-mount nonce that authorizes parent → iframe theme-update messages.
  const themeToken = useMemo(() => `theme-${crypto.randomUUID()}`, []);
  // Per-mount nonce authorizing iframe → parent AX emits (Phase 3 HTML bridge).
  const axToken = useMemo(() => `ax-${crypto.randomUUID()}`, []);
  // Per-mount nonce for the content-height reporter (node grows to fit content).
  const frameToken = useMemo(() => `frame-${crypto.randomUUID()}`, []);
  const html = typeof node.data.html === 'string'
    ? node.data.html
    : typeof node.data.content === 'string'
      ? node.data.content
      : '';
  const v = useMemo(() => surfaceContentHash(html), [html]);

  // The in-canvas iframe and the "Open as site" tab load the SAME server-rendered
  // surface URL (/api/canvas/surface/:id) — one render path, no content fork.
  // `theme` is intentionally excluded from the deps: live theme changes are pushed
  // via postMessage below (no reload), while `v` reloads the frame when the HTML
  // itself changes.
  const surfaceSrc = useMemo(
    () => (html
      ? nodeSurfaceUrl(node.id, { theme, themeToken, present: presentation, presentToken: presentationExitToken, v, axToken, frameToken })
      : ''),
    [html, presentation, presentationExitToken, themeToken, v, node.id, axToken, frameToken],
  );

  // Grow the node to fit the surface's reported content height (grow-only, gated).
  // Never in the expanded overlay — there the surface fills the large overlay frame.
  useIframeContentHeight(node, iframeRef, expanded ? '' : frameToken);

  // Phase 3 HTML bridge: receive window.PMX_AX.emit(...) messages from the
  // sandboxed iframe, validate the nonce + node id, and submit the interaction
  // through the capability-gated endpoint (the server re-validates capabilities).
  useEffect(() => {
    function onAxMessage(event: MessageEvent) {
      // Bind to THIS node's own iframe (matches the ext-app bridge); the nonce +
      // nodeId are a second gate, not the only one.
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as {
        source?: string; token?: string; nodeId?: string; correlationId?: string;
        interaction?: { type?: unknown; payload?: unknown };
      } | null;
      if (!data || data.source !== 'pmx-canvas-ax' || data.token !== axToken || data.nodeId !== node.id) return;
      const interaction = data.interaction;
      if (!interaction || typeof interaction.type !== 'string') return;
      const interactionType = interaction.type;
      void submitAxInteractionFromClient({
        type: interactionType,
        sourceNodeId: node.id,
        sourceSurface: 'html-node',
        ...(interaction.payload && typeof interaction.payload === 'object'
          ? { payload: interaction.payload as Record<string, unknown> }
          : {}),
      }).then((res) => {
        if (res.ok) showToast('context', 'AX interaction', interactionType, [node.id]);
        else showToast('remove', 'AX interaction rejected', res.error ?? res.code ?? '', [node.id]);
        // Report #55: ack back to the surface so it can self-confirm (e.g. "queued ✓").
        iframeRef.current?.contentWindow?.postMessage({
          source: 'pmx-canvas-ax-ack',
          token: axToken,
          ...(data.correlationId ? { correlationId: data.correlationId } : {}),
          interaction: { type: interactionType },
          result: res,
        }, '*');
      });
    }
    window.addEventListener('message', onAxMessage);
    return () => window.removeEventListener('message', onAxMessage);
  }, [axToken, node.id]);

  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({
      source: 'pmx-canvas-html-node',
      type: 'theme-update',
      token: themeToken,
      theme,
    }, '*');
    if (autoFocus) iframeRef.current?.focus();
  }, [theme, themeToken]);

  // Read-side AX bridge: push live AX state into the surface so an AX-enabled
  // board reflects the work queue / focus. Validated by the surface against axToken.
  // Gate matches the server's bridge-injection gate (enabled && allowed not empty)
  // so we never push state to a surface the server left without the bridge.
  const axCaps = node.data.axCapabilities as { enabled?: boolean; allowed?: unknown } | undefined;
  const axEnabled = axCaps?.enabled === true && (!Array.isArray(axCaps.allowed) || axCaps.allowed.length > 0);
  const axStateValue = axSurfaceState.value;
  useEffect(() => {
    if (!axEnabled || axStateValue == null) return;
    iframeRef.current?.contentWindow?.postMessage({
      source: 'pmx-canvas-html-node',
      type: 'ax-update',
      token: axToken,
      state: axStateValue,
    }, '*');
  }, [axEnabled, axStateValue, axToken]);

  useEffect(() => {
    if (!autoFocus) return;
    const id = window.setTimeout(() => iframeRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [autoFocus, surfaceSrc]);

  const handleFrameLoad = () => {
    iframeRef.current?.contentWindow?.postMessage({
      source: 'pmx-canvas-html-node',
      type: 'theme-update',
      token: themeToken,
      theme,
    }, '*');
    if (axEnabled && axSurfaceState.value != null) {
      iframeRef.current?.contentWindow?.postMessage({
        source: 'pmx-canvas-html-node',
        type: 'ax-update',
        token: axToken,
        state: axSurfaceState.value,
      }, '*');
    }
    if (autoFocus) iframeRef.current?.focus();
  };

  if (!html) {
    return (
      <div style={{ color: 'var(--c-dim)', fontStyle: 'italic', padding: '12px' }}>
        No HTML content set
      </div>
    );
  }

  // SECURITY: sandbox is intentionally `allow-scripts` ONLY. Do NOT add
  // `allow-same-origin` (would grant the iframe access to parent localStorage
  // and credentialed requests to the canvas origin), `allow-top-navigation`
  // (would let scripts redirect the parent window), or `allow-forms` (would
  // let the iframe POST back to the host). The surface route reinforces this
  // with a matching `Content-Security-Policy: sandbox allow-scripts` response
  // header, so the document stays on an opaque origin even when opened as a
  // standalone tab. The whole html-node tier assumes arbitrary author code runs
  // inside this exact sandbox.
  return (
    <iframe
      ref={iframeRef}
      class={presentation ? 'html-node-frame html-node-frame-presentation' : 'html-node-frame'}
      title={typeof node.data.title === 'string' ? node.data.title : 'HTML node'}
      sandbox="allow-scripts"
      src={surfaceSrc}
      tabIndex={autoFocus ? 0 : undefined}
      onLoad={handleFrameLoad}
      style={{
        width: '100%',
        height: '100%',
        minHeight: presentation ? 0 : expanded ? '70vh' : '300px',
        border: 'none',
        background: 'var(--c-bg)',
        borderRadius: presentation ? 0 : '6px',
        display: 'block',
      }}
    />
  );
}
