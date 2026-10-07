import { useEffect } from 'preact/hooks';
import { cameraSchema, type Camera } from '../../shared/tour.js';
import { canvasArea } from './canvas-area';
import { cancelViewportAnimation, hasInitialServerLayout, viewport } from '../state/canvas-store';
import {
  endPresentation,
  presentationError,
  presenting,
  recordingCamera,
  startPresentation,
  stepTour,
} from '../state/presentation';
import { usePanZoom } from './use-pan-zoom';

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
  const active = presenting.value;
  const ready = hasInitialServerLayout.value;
  const moveCamera = (camera: Camera) => {
    cancelViewportAnimation();
    viewport.value = camera;
  };
  // A separate gesture surface keeps cards read-only and camera changes local.
  const navigationRef = usePanZoom({
    viewport,
    onViewportChange: moveCamera,
    onViewportCommit: moveCamera,
  });
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
  // `?present=1` joins the tour where it is (an agent may already be driving it).
  useEffect(() => {
    if (ready && presenting.value && !recordingCamera.value) void startPresentation(true);
  }, [ready]);
  useEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => {
      event.stopImmediatePropagation();
      if (event.target instanceof HTMLButtonElement && ['Enter', ' '].includes(event.key)) return;
      if (['Escape', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', ' '].includes(event.key))
        event.preventDefault();
      if (event.key === 'Escape') endPresentation();
      if (['ArrowRight', 'ArrowDown', ' '].includes(event.key)) void stepTour({ step: 'next' });
      if (['ArrowLeft', 'ArrowUp'].includes(event.key)) void stepTour({ step: 'previous' });
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [active]);
  return active ? (
    <>
      {!recordingCamera.value && (
        <div
          class="presentation-navigation"
          ref={navigationRef}
          onPointerDown={(event) => {
            if (event.button === 1 || event.button === 2) cancelViewportAnimation();
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button type="button" class="presentation-exit" onClick={endPresentation}>
            Exit presentation
          </button>
        </div>
      )}
      {presentationError.value && (
        <div class="presentation-error" role="alert">
          {presentationError.value}
        </div>
      )}
    </>
  ) : null;
}
