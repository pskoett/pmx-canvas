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
): void {
  useEffect(() => {
    if (!frameToken) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pendingHeight: number | null = null;
    const held = () =>
      grabbingNodeId.value === node.id || otherHumans.value.some((human) => human.grabbingNodeId === node.id);
    function apply() {
      timer = null;
      if (held() || pendingHeight === null) return;
      const reported = pendingHeight;
      pendingHeight = null;
      const current = nodes.value.get(node.id);
      if (!current) return;
      const target = computeContentGrowHeight(current, reported);
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
      timer = pendingHeight !== null && !held() ? setTimeout(apply, 300) : null;
    }
    const dispose = effect(() => {
      held();
      schedule();
    });
    function onMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const d = event.data as { source?: string; type?: string; token?: string; height?: unknown } | null;
      if (!d || d.source !== 'pmx-canvas-frame' || d.type !== 'content-height' || d.token !== frameToken) return;
      if (typeof d.height !== 'number' || !Number.isFinite(d.height) || d.height <= 0) return;
      pendingHeight = d.height;
      schedule();
    }
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      dispose();
      if (timer !== null) clearTimeout(timer);
    };
  }, [node.id, frameToken]);
}
