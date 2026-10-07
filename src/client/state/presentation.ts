import { signal } from '@preact/signals';
import { interpolateCamera, resolveStop, type TourStop } from '../../shared/tour.js';
import { canvasArea } from '../canvas/canvas-area';
import type { ViewportState } from '../types';
import { animateCameraPath, nodes, viewport } from './canvas-store';
import { requestBestEffort, requestJson } from './intent-bridge';

export const presenting = signal(false);
export const recordingCamera = signal(false);
/** Why the current stop cannot be shown (missing target, no stops, server unreachable). */
export const presentationError = signal('');

export function ownsCamera(): boolean {
  return presenting.value || recordingCamera.value;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Ease this viewer's camera to a stop: log-space zoom, optional pull-back.
 * Reduced motion jumps straight to the end. Throws when the target is missing.
 */
export function playStop(stop: TourStop, onDone?: (end: ViewportState) => void): void {
  const area = canvasArea();
  const target = resolveStop(stop, [...nodes.value.values()], area.width, area.height);
  const from = { ...viewport.value };
  const duration = prefersReducedMotion() ? 0 : (stop.duration ?? 1) * 1000;
  animateCameraPath(
    (t) => interpolateCamera(from, target, t, area.width, area.height, stop.easing, stop.pullback),
    duration,
    onDone,
  );
}

let stepSeq = 0;

/**
 * Show a tour stop, entering presentation if needed. Entering hides the
 * chrome, so the canvas area is measured only after that layout has
 * committed (two frames); the latest step always wins.
 */
export function presentStop(stop: TourStop): void {
  const seq = ++stepSeq;
  const entering = !presenting.value;
  presenting.value = true;
  presentationError.value = '';
  const play = () => {
    if (seq !== stepSeq) return;
    try {
      playStop(stop);
    } catch (error) {
      presentationError.value = error instanceof Error ? error.message : String(error);
    }
  };
  if (entering) requestAnimationFrame(() => requestAnimationFrame(play));
  else play();
}

/**
 * Move the server's shared tour cursor. The `canvas-tour-step` echo does the
 * animating, here and in every other presenting viewer, so a human's keys and
 * an agent's `tour.go` always agree on where the tour is.
 */
export async function stepTour(to: { stop: number } | { step: 'next' | 'previous' }): Promise<void> {
  const result = await requestJson<{ ok: boolean; error?: string }>(
    'step tour',
    '/api/canvas/tour/go',
    { ok: false, error: 'Could not reach the canvas server.' },
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...to, present: false }),
    },
  );
  if (!result.ok) presentationError.value = result.error ?? 'Could not change the tour stop.';
}

/** Present from the first stop, or resume where the tour already is (`?present=1`). */
export async function startPresentation(resume = false): Promise<void> {
  presenting.value = true;
  presentationError.value = '';
  const at = resume
    ? (await requestJson<{ position?: number | null }>('read tour', '/api/canvas/tour', {})).position
    : null;
  await stepTour({ stop: typeof at === 'number' ? at : 0 });
}

export function endPresentation(): void {
  presenting.value = false;
  presentationError.value = '';
  void requestBestEffort('exit tour', '/api/canvas/tour/exit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}
