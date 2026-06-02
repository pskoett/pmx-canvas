import type { Signal } from '@preact/signals';
import { useCallback, useRef } from 'preact/hooks';
import type { ViewportState } from '../types';

interface NodeDragOptions {
  nodeId: string;
  viewport: Signal<ViewportState>;
  onMove: (id: string, x: number, y: number) => void;
  onDragEnd: () => void;
}

/**
 * Hook for dragging canvas nodes by their title bar.
 * Converts screen-space pointer delta to canvas-space position delta
 * (accounting for current viewport scale).
 */
export function useNodeDrag({ nodeId, viewport, onMove, onDragEnd }: NodeDragOptions) {
  const isDragging = useRef(false);
  const startPointer = useRef({ x: 0, y: 0 });
  const startPosition = useRef({ x: 0, y: 0 });

  const handlePointerDown = useCallback(
    (e: PointerEvent, currentX: number, currentY: number) => {
      e.stopPropagation();
      isDragging.current = true;
      startPointer.current = { x: e.clientX, y: e.clientY };
      startPosition.current = { x: currentX, y: currentY };
      let pendingPointer: { x: number; y: number } | null = null;
      let frameId: number | null = null;

      const flushMove = () => {
        frameId = null;
        if (!isDragging.current || !pendingPointer) return;
        const pointer = pendingPointer;
        pendingPointer = null;
        const scale = viewport.value.scale;
        const dx = (pointer.x - startPointer.current.x) / scale;
        const dy = (pointer.y - startPointer.current.y) / scale;
        onMove(nodeId, startPosition.current.x + dx, startPosition.current.y + dy);
      };

      const onPointerMove = (ev: PointerEvent) => {
        if (!isDragging.current) return;
        pendingPointer = { x: ev.clientX, y: ev.clientY };
        if (frameId !== null) return;
        frameId = window.requestAnimationFrame(flushMove);
      };

      const onPointerUp = () => {
        if (frameId !== null) {
          window.cancelAnimationFrame(frameId);
          flushMove();
        }
        isDragging.current = false;
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
        onDragEnd();
      };

      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
    },
    [nodeId, viewport, onMove, onDragEnd],
  );

  return handlePointerDown;
}
