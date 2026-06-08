import { useEffect, useRef } from 'preact/hooks';
import { persistLayout, resizeNode } from '../state/canvas-store';
import { computeContentGrowHeight } from '../canvas/auto-fit';
import type { CanvasNodeState } from '../types';

/**
 * Grow an iframe-surface node to fit the content height its surface reports over
 * the nonce-validated `content-height` postMessage bridge. Grow-only and gated
 * (see computeContentGrowHeight / shouldContentFitIframeNode), so it never clips,
 * never shrinks, never fights a manual resize / strictSize / docked node, and —
 * because growth is monotonic with a dead-band — cannot oscillate. This is the
 * fix for iframe nodes whose body scrollHeight the parent can't measure.
 *
 * The latest node is read through a ref so the effect stays mounted across the
 * grow (its deps are only id + token). Putting node.size in the deps would re-run
 * the effect on each grow and its cleanup would cancel the pending persist.
 */
export function useIframeContentHeight(
  node: CanvasNodeState,
  iframeRef: { current: HTMLIFrameElement | null },
  frameToken: string,
): void {
  const nodeRef = useRef(node);
  nodeRef.current = node;
  const persistTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!frameToken) return undefined;
    function onMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const d = event.data as { source?: string; type?: string; token?: string; height?: unknown } | null;
      if (!d || d.source !== 'pmx-canvas-frame' || d.type !== 'content-height' || d.token !== frameToken) return;
      const current = nodeRef.current;
      const reported = typeof d.height === 'number' ? d.height : 0;
      const target = computeContentGrowHeight(current, reported);
      if (target === null) return;
      resizeNode(current.id, { width: current.size.width, height: target });
      if (persistTimer.current !== null) window.clearTimeout(persistTimer.current);
      persistTimer.current = window.setTimeout(() => {
        persistLayout({ recordHistory: false });
        persistTimer.current = null;
      }, 300);
    }
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      if (persistTimer.current !== null) {
        window.clearTimeout(persistTimer.current);
        persistTimer.current = null;
      }
    };
  }, [node.id, frameToken]);
}
