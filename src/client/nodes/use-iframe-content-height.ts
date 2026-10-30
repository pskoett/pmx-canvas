import { effect } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { nodes, updateNode } from '../state/canvas-store';
import { grabbingNodeId, otherHumans } from '../state/human-store';
import { pushCanvasUpdate } from '../state/intent-bridge';
import { computeContentGrowHeight, contentFitPosition } from '../canvas/auto-fit';
import type { CanvasNodeState } from '../types';

/**
 * Grow an iframe-surface node to fit the content height its surface reports over
 * the nonce-validated `content-height` postMessage bridge. Grow-only and gated
 * (see computeContentGrowHeight / shouldContentFitIframeNode), so it never clips,
 * never shrinks, never fights a manual resize / strictSize / docked node, and —
 * because growth is monotonic with a dead-band — cannot oscillate. This is the
 * fix for iframe nodes whose body scrollHeight the parent can't measure.
 *
 * Debounce before changing geometry, retaining the latest measurement during a
 * human grab. Read current geometry at application time; persist only this node.
 * Relocations are undoable, height-only adjustments do not fill the undo stack.
 */
export function useIframeContentHeight(
  node: CanvasNodeState,
  iframeRef: { current: HTMLIFrameElement | null },
  frameToken: string,
): () => void {
  useEffect(() => {
    if (!frameToken) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: { frame: HTMLIFrameElement; height: number } | null = null;
    let lastMeasurement: { frame: HTMLIFrameElement; height: number; width: number; chrome: number } | null = null;
    const held = () =>
      grabbingNodeId.value === node.id || otherHumans.value.some((human) => human.grabbingNodeId === node.id);
    function apply() {
      timer = null;
      if (held() || pending === null) return;
      const { frame, height: reported } = pending;
      pending = null;
      if (frame !== iframeRef.current) return;
      const current = nodes.value.get(node.id);
      const card = frame.closest<HTMLElement>('.canvas-node');
      if (!current || !card) return;
      const chrome = card.offsetHeight - frame.clientHeight;
      // Undo changes the viewport, which makes the reporter resend unchanged
      // content. A replacement document owns a fresh fit even at the same size.
      if (
        lastMeasurement?.frame === frame &&
        lastMeasurement.height === reported &&
        lastMeasurement.width === current.size.width &&
        lastMeasurement.chrome === chrome
      )
        return;
      lastMeasurement = { frame, height: reported, width: current.size.width, chrome };
      const target = computeContentGrowHeight(current, reported, chrome);
      if (target === null) return;
      const position = contentFitPosition(current, target, Array.from(nodes.value.values()));
      const moved = position.x !== current.position.x || position.y !== current.position.y;
      const patch = {
        size: { width: current.size.width, height: target },
        ...(moved ? { position } : {}),
      };
      updateNode(current.id, patch);
      void pushCanvasUpdate([{ id: current.id, ...patch }], { recordHistory: moved });
    }
    function schedule() {
      if (timer !== null) clearTimeout(timer);
      timer = pending !== null && !held() ? setTimeout(apply, 300) : null;
    }
    const dispose = effect(() => {
      held();
      schedule();
    });
    function onMessage(event: MessageEvent) {
      const frame = iframeRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const d = event.data as { source?: string; type?: string; token?: string; height?: unknown } | null;
      if (!d || d.source !== 'pmx-canvas-frame' || d.type !== 'content-height' || d.token !== frameToken) return;
      if (typeof d.height !== 'number' || !Number.isFinite(d.height) || d.height <= 0) return;
      pending = { frame, height: d.height };
      schedule();
    }
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      dispose();
      if (timer !== null) clearTimeout(timer);
    };
  }, [node.id, frameToken]);
  // Pending documents can report before promotion, when they are deliberately
  // not the active ref. Ask the promoted document for a fresh measurement.
  return () => {
    if (!frameToken) return;
    iframeRef.current?.contentWindow?.postMessage(
      { source: 'pmx-canvas-frame', type: 'measure-content', token: frameToken },
      '*',
    );
  };
}
