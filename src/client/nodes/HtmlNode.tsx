import { useEffect, useMemo, useRef } from 'preact/hooks';
import { canvasTheme } from '../state/canvas-store';
import type { CanvasNodeState } from '../types';
import { nodeSurfaceUrl, surfaceContentHash } from './surface-url';

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
  const themeToken = useMemo(() => `theme-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, []);
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
      ? nodeSurfaceUrl(node.id, { theme, themeToken, present: presentation, presentToken: presentationExitToken, v })
      : ''),
    [html, presentation, presentationExitToken, themeToken, v, node.id],
  );

  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({
      source: 'pmx-canvas-html-node',
      type: 'theme-update',
      token: themeToken,
      theme,
    }, '*');
    if (autoFocus) iframeRef.current?.focus();
  }, [theme, themeToken]);

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
