import { useEffect, useState } from 'preact/hooks';
import { cameraSchema, interpolateCamera, resolveStop, type Camera, type Tour } from '../../shared/tour.js';
import { canvasArea } from './canvas-area';
import { cancelViewportAnimation, hasInitialServerLayout, nodes, viewport } from '../state/canvas-store';
import { presenting, recordingCamera } from '../state/presentation';
import { requestJson } from '../state/intent-bridge';

declare global {
  interface Window {
    pmxCapture?: {
      ready: () => boolean;
      area: typeof canvasArea;
      camera: () => Camera;
      frame: (camera: Camera) => Promise<Camera>;
    };
  }
}

export function Presentation() {
  const [tour, setTour] = useState<Tour>({ stops: [] });
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const active = presenting.value;
  const ready = hasInitialServerLayout.value;
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    presenting.value = params.get('present') === '1';
    recordingCamera.value = params.get('capture') === '1';
    window.pmxCapture = {
      ready: () => hasInitialServerLayout.value,
      area: canvasArea,
      camera: () => ({ ...viewport.value }),
      frame: async (camera) => {
        recordingCamera.value = true;
        cancelViewportAnimation();
        viewport.value = cameraSchema.parse(camera);
        // Two animation frames: Preact has committed and the browser has had
        // a paint opportunity before the screenshot command is acknowledged.
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        return { ...viewport.value };
      },
    };
    return () => {
      delete window.pmxCapture;
      presenting.value = false;
      recordingCamera.value = false;
    };
  }, []);
  useEffect(() => {
    if (!active || !ready) return;
    let cancelled = false;
    void requestJson('read tour', '/api/canvas/tour', { tour: { stops: [] } as Tour }).then((result) => {
      if (!cancelled) {
        setTour(result.tour);
        setIndex(0);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [active, ready]);
  useEffect(() => {
    if (!active || recordingCamera.value) return;
    const stop = tour.stops[index];
    if (!stop) return;
    const area = canvasArea();
    let target: Camera;
    try {
      target = resolveStop(stop, [...nodes.value.values()], area.width, area.height);
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      return;
    }
    cancelViewportAnimation();
    const from = { ...viewport.value };
    const start = performance.now();
    const duration = (stop.duration ?? 1) * 1000;
    let frame = 0;
    const tick = (now: number) => {
      if (recordingCamera.value) return;
      const t = duration === 0 ? 1 : Math.min(1, (now - start) / duration);
      viewport.value = interpolateCamera(from, target, t, area.width, area.height, stop.easing, stop.pullback);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, index, tour]);
  useEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => {
      event.stopImmediatePropagation();
      if (['Escape', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', ' '].includes(event.key))
        event.preventDefault();
      if (event.key === 'Escape') presenting.value = false;
      if (['ArrowRight', 'ArrowDown', ' '].includes(event.key))
        setIndex((i) => Math.max(0, Math.min(tour.stops.length - 1, i + 1)));
      if (['ArrowLeft', 'ArrowUp'].includes(event.key)) setIndex((i) => Math.max(0, i - 1));
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [active, tour]);
  return active && error ? (
    <div class="presentation-error" role="alert">
      {error}
    </div>
  ) : null;
}
