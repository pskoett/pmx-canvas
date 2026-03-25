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

      const onPointerMove = (ev: PointerEvent) => {
        if (!isDragging.current) return;
        const scale = viewport.value.scale;
        const dx = (ev.clientX - startPointer.current.x) / scale;
        const dy = (ev.clientY - startPointer.current.y) / scale;
        onMove(nodeId, startPosition.current.x + dx, startPosition.current.y + dy);
      };

      const onPointerUp = () => {
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
