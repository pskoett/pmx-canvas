import type { Signal } from '@preact/signals';
import { useCallback, useRef } from 'preact/hooks';
import type { ViewportState } from '../types';

const MIN_WIDTH = 200;
const MIN_HEIGHT = 100;

interface NodeResizeOptions {
  nodeId: string;
  viewport: Signal<ViewportState>;
  onResize: (id: string, width: number, height: number) => void;
  onResizeEnd: () => void;
}

/**
 * Hook for resizing canvas nodes via a corner drag handle.
 * Converts screen-space pointer delta to canvas-space size delta
 * (accounting for current viewport scale).
 */
export function useNodeResize({ nodeId, viewport, onResize, onResizeEnd }: NodeResizeOptions) {
  const isResizing = useRef(false);
  const startPointer = useRef({ x: 0, y: 0 });
  const startSize = useRef({ w: 0, h: 0 });

  const handlePointerDown = useCallback(
    (e: PointerEvent, currentWidth: number, currentHeight: number) => {
      e.stopPropagation();
      e.preventDefault();
      isResizing.current = true;
      startPointer.current = { x: e.clientX, y: e.clientY };
      startSize.current = { w: currentWidth, h: currentHeight };
      document.documentElement.classList.add('is-node-resizing');
      let pendingPointer: { x: number; y: number } | null = null;
      let frameId: number | null = null;

      const flushResize = () => {
        frameId = null;
        if (!isResizing.current || !pendingPointer) return;
        const pointer = pendingPointer;
        pendingPointer = null;
        const scale = viewport.value.scale;
        const dw = (pointer.x - startPointer.current.x) / scale;
        const dh = (pointer.y - startPointer.current.y) / scale;
        onResize(
          nodeId,
          Math.max(MIN_WIDTH, startSize.current.w + dw),
          Math.max(MIN_HEIGHT, startSize.current.h + dh),
        );
      };

      const onPointerMove = (ev: PointerEvent) => {
        if (!isResizing.current) return;
        pendingPointer = { x: ev.clientX, y: ev.clientY };
        if (frameId !== null) return;
        frameId = window.requestAnimationFrame(flushResize);
      };

      const finishResize = () => {
        if (frameId !== null) {
          window.cancelAnimationFrame(frameId);
          flushResize();
        }
        isResizing.current = false;
        document.documentElement.classList.remove('is-node-resizing');
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', finishResize);
        document.removeEventListener('pointercancel', finishResize);
        onResizeEnd();
      };

      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', finishResize);
      document.addEventListener('pointercancel', finishResize);
    },
    [nodeId, viewport, onResize, onResizeEnd],
  );

  return handlePointerDown;
}
