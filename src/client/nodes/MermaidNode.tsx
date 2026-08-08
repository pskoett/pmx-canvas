import { useEffect, useMemo, useRef } from 'preact/hooks';
import { HTML_SURFACE_PUSH_SOURCE } from '../../shared/ax-surface-protocol.js';
import { canvasTheme } from '../state/canvas-store';
import type { CanvasNodeState } from '../types';
import { nodeSurfaceUrl, surfaceContentHash } from './surface-url';
import { useIframeContentHeight } from './use-iframe-content-height';
import { useSurfaceFrame } from './use-surface-frame';

/**
 * Mermaid diagram node — a display-only iframe surface. The server renders the
 * surface document (escaped diagram source + /canvas/mermaid-entry.js) at
 * /api/canvas/surface/:id; the iframe and "Open as site" share that one render
 * path, exactly like html nodes. Minimal subset of HtmlNode: theme push and
 * content-height growth, no AX bridge, no presentation mode.
 */
export function MermaidNode({ node, expanded = false }: { node: CanvasNodeState; expanded?: boolean }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const theme = canvasTheme.value;
  // Stable per-mount nonce that authorizes parent → iframe theme-update messages.
  const themeToken = useMemo(() => `theme-${crypto.randomUUID()}`, []);
  // Per-mount nonce for the content-height reporter (node grows to fit content).
  const frameToken = useMemo(() => `frame-${crypto.randomUUID()}`, []);
  const source = typeof node.data.content === 'string' ? node.data.content : '';
  const v = useMemo(() => surfaceContentHash(source), [source]);

  // `theme` is intentionally excluded from the deps: live theme changes are
  // pushed via postMessage below (no reload), while `v` reloads the frame when
  // the diagram source changes.
  const surfaceSrc = useMemo(
    () => (source ? nodeSurfaceUrl(node.id, { theme, themeToken, v, frameToken }) : ''),
    [source, themeToken, v, node.id, frameToken],
  );

  // src vs fetch()+srcdoc, decided by the boot-wide embed probe (Amp portals).
  const surfaceFrame = useSurfaceFrame(surfaceSrc);

  // Grow the node to fit the surface's reported content height (grow-only, gated).
  // Never in the expanded overlay — there the surface fills the large overlay frame.
  useIframeContentHeight(node, iframeRef, expanded ? '' : frameToken);

  const pushTheme = () => {
    iframeRef.current?.contentWindow?.postMessage(
      {
        source: HTML_SURFACE_PUSH_SOURCE,
        type: 'theme-update',
        token: themeToken,
        theme,
      },
      '*',
    );
  };

  useEffect(pushTheme, [theme, themeToken]);

  if (!source) {
    return <div style={{ color: 'var(--c-dim)', fontStyle: 'italic', padding: '12px' }}>No diagram source set</div>;
  }

  // SECURITY: sandbox stays `allow-scripts` ONLY — same tier as html surfaces
  // (see HtmlNode for the full rationale); the surface route sends a matching
  // CSP sandbox header.
  return (
    <iframe
      ref={iframeRef}
      class="html-node-frame"
      title={typeof node.data.title === 'string' ? node.data.title : 'Mermaid diagram'}
      sandbox="allow-scripts"
      {...surfaceFrame}
      onLoad={pushTheme}
      style={{
        width: '100%',
        height: '100%',
        minHeight: expanded ? '70vh' : '300px',
        border: 'none',
        background: 'var(--c-bg)',
        borderRadius: '6px',
        display: 'block',
      }}
    />
  );
}
