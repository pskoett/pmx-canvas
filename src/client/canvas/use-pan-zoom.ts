import type { Signal } from '@preact/signals';
import { useCallback, useEffect, useRef } from 'preact/hooks';
import type { ViewportState } from '../types';

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;
const PAN_SPEED = 1;

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

interface PanZoomOptions {
  viewport: Signal<ViewportState>;
  onViewportChange: (v: ViewportState) => void;
  onViewportCommit: (v: ViewportState) => void;
}

/**
 * Hook that wires up pan/zoom interactions on a container element.
 * - Wheel + Ctrl/Cmd: zoom centered on pointer
 * - Wheel without modifier: pan
 * - Pointer drag on background: pan
 * - Pinch (touch): zoom
 */
export function usePanZoom({ viewport, onViewportChange, onViewportCommit }: PanZoomOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isPanning = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });
  const lastPinchDist = useRef(0);
  const wheelCommitTimer = useRef<number | null>(null);

  const scheduleViewportCommit = useCallback((next: ViewportState) => {
    if (wheelCommitTimer.current !== null) {
      window.clearTimeout(wheelCommitTimer.current);
    }
    wheelCommitTimer.current = window.setTimeout(() => {
      wheelCommitTimer.current = null;
      onViewportCommit(next);
    }, 140);
  }, [onViewportCommit]);

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const v = viewport.value;

      if (e.ctrlKey || e.metaKey) {
        // Zoom centered on pointer
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;

        const delta = -e.deltaY * 0.002;
        const newScale = clampScale(v.scale * (1 + delta));
        const ratio = newScale / v.scale;

        const next = {
          x: px - ratio * (px - v.x),
          y: py - ratio * (py - v.y),
          scale: newScale,
        };
        onViewportChange(next);
        scheduleViewportCommit(next);
      } else {
        // Pan
        const next = {
          x: v.x - e.deltaX * PAN_SPEED,
          y: v.y - e.deltaY * PAN_SPEED,
          scale: v.scale,
        };
        onViewportChange(next);
        scheduleViewportCommit(next);
      }
    },
    [viewport, onViewportChange, scheduleViewportCommit],
  );

  const handlePointerDown = useCallback((e: PointerEvent) => {
    // Only pan when clicking the canvas background (not nodes)
    const container = containerRef.current;
    if (!container || e.target !== container) return;
    isPanning.current = true;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    container.setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!isPanning.current) return;
      const dx = e.clientX - lastPointer.current.x;
      const dy = e.clientY - lastPointer.current.y;
      lastPointer.current = { x: e.clientX, y: e.clientY };

      const v = viewport.value;
      onViewportChange({ x: v.x + dx, y: v.y + dy, scale: v.scale });
    },
    [viewport, onViewportChange],
  );

  const handlePointerUp = useCallback(() => {
    if (isPanning.current) {
      onViewportCommit(viewport.value);
    }
    isPanning.current = false;
  }, [onViewportCommit, viewport]);

  // Touch pinch
  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (e.touches.length !== 2) {
        lastPinchDist.current = 0;
        return;
      }
      e.preventDefault();

      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const cx = (t1.clientX + t2.clientX) / 2;
      const cy = (t1.clientY + t2.clientY) / 2;

      if (lastPinchDist.current > 0) {
        const v = viewport.value;
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const px = cx - rect.left;
        const py = cy - rect.top;

        const ratio = dist / lastPinchDist.current;
        const newScale = clampScale(v.scale * ratio);
        const scaleRatio = newScale / v.scale;

        const next = {
          x: px - scaleRatio * (px - v.x),
          y: py - scaleRatio * (py - v.y),
          scale: newScale,
        };
        onViewportChange(next);
        scheduleViewportCommit(next);
      }
      lastPinchDist.current = dist;
    },
    [viewport, onViewportChange, scheduleViewportCommit],
  );

  const handleTouchEnd = useCallback(() => {
    if (wheelCommitTimer.current !== null) {
      window.clearTimeout(wheelCommitTimer.current);
      wheelCommitTimer.current = null;
    }
    onViewportCommit(viewport.value);
    lastPinchDist.current = 0;
  }, [onViewportCommit, viewport]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('pointerdown', handlePointerDown);
    el.addEventListener('pointermove', handlePointerMove);
    el.addEventListener('pointerup', handlePointerUp);
    el.addEventListener('pointercancel', handlePointerUp);
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd);

    return () => {
      if (wheelCommitTimer.current !== null) {
        window.clearTimeout(wheelCommitTimer.current);
      }
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('pointerdown', handlePointerDown);
      el.removeEventListener('pointermove', handlePointerMove);
      el.removeEventListener('pointerup', handlePointerUp);
      el.removeEventListener('pointercancel', handlePointerUp);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [
    handleWheel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleTouchMove,
    handleTouchEnd,
  ]);

  return containerRef;
}
