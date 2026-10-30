import { signal } from '@preact/signals';
import {
  interpolateCamera,
  resolveStop,
  tourStopSchema,
  type TourPresenter,
  type TourStop,
} from '../../shared/tour.js';
import { canvasArea } from '../canvas/canvas-area';
import type { ViewportState } from '../types';
import { boardGeneration, catalogEpoch } from './boards-store';
import { animateCameraPath, cancelViewportAnimation, nodes, viewport } from './canvas-store';
import { requestBestEffort, requestJson } from './intent-bridge';

export const presenting = signal(false);
export const recordingCamera = signal(false);
/** Why the current stop cannot be shown (missing target, no stops, server unreachable). */
export const presentationError = signal('');
/** Read-only mirror of the server's shared cursor, never advanced optimistically. */
export const presentationCursor = signal<{ index: number; total: number } | null>(null);

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
  let target: ViewportState;
  if (presenting.value && !recordingCamera.value && !('viewport' in stop.target)) {
    const padding = stop.padding ?? 40;
    const controls = document.querySelector('.presentation-controls')?.getBoundingClientRect();
    const top = Math.max(padding, controls ? controls.bottom - area.top + 12 : 0);
    target = resolveStop(
      { ...stop, padding: 0 },
      [...nodes.value.values()],
      area.width - 2 * padding,
      area.height - top - padding,
    );
    target = { ...target, x: target.x + padding, y: target.y + top };
  } else {
    target = resolveStop(stop, [...nodes.value.values()], area.width, area.height);
  }
  const from = { ...viewport.value };
  const duration = prefersReducedMotion() ? 0 : (stop.duration ?? 1) * 1000;
  animateCameraPath(
    (t) => interpolateCamera(from, target, t, area.width, area.height, stop.easing, stop.pullback),
    duration,
    onDone,
  );
}

let stepSeq = 0;
let presentationRun = 0;

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

let requestSeq = 0;
const presenterId = crypto.randomUUID();
let lastDelivery: { catalogEpoch: string; sequence: number; applied: boolean } | null = null;

function nextPresenter(): TourPresenter | null {
  if (catalogEpoch === null || boardGeneration === null) {
    presentationError.value = 'The board is still connecting. Try presenting again when it is ready.';
    return null;
  }
  return { clientId: presenterId, intent: ++requestSeq, catalogEpoch, boardGeneration };
}

function isCurrentPresenter(presenter: TourPresenter): boolean {
  return (
    presenter.intent === requestSeq &&
    presenter.catalogEpoch === catalogEpoch &&
    presenter.boardGeneration === boardGeneration
  );
}

function acceptDelivery(data: Record<string, unknown>, apply: boolean): boolean {
  if (
    typeof data.catalogEpoch !== 'string' ||
    data.catalogEpoch !== catalogEpoch ||
    data.boardGeneration !== boardGeneration ||
    typeof data.sequence !== 'number' ||
    (lastDelivery?.catalogEpoch === catalogEpoch &&
      (data.sequence < lastDelivery.sequence ||
        (data.sequence === lastDelivery.sequence && (!apply || lastDelivery.applied))))
  )
    return false;
  lastDelivery = { catalogEpoch: data.catalogEpoch, sequence: data.sequence, applied: apply };
  return true;
}

/** Apply either delivery of the server's shared cursor, without replaying its echo. */
export function applyTourStep(data: Record<string, unknown>): void {
  if (recordingCamera.value) return;
  const stop = tourStopSchema.safeParse(data.stop);
  const display = presenting.value || data.present === true;
  // Observe hidden steps too. The same operation's HTTP acknowledgement may
  // authorize local presentation later, but an older acknowledgement must not.
  if (!stop.success || !acceptDelivery(data, display) || !display) return;
  if (typeof data.index === 'number' && typeof data.total === 'number') {
    presentationCursor.value = { index: data.index, total: data.total };
  }
  presentStop(stop.data);
}

export function applyTourExit(data: Record<string, unknown>): void {
  if (!recordingCamera.value && acceptDelivery(data, true)) hidePresentation();
}

/** Move the shared cursor. A successful response also works while events are delayed or disconnected. */
export async function stepTour(
  to: { stop: number } | { step: 'next' | 'previous' },
  presenter = nextPresenter(),
): Promise<void> {
  if (!presenter) return;
  const run = presentationRun;
  const previous = lastDelivery;
  const result = await requestJson<
    | {
        ok: true;
        catalogEpoch: string;
        boardGeneration: number;
        sequence: number;
        index: number;
        total: number;
        stop: TourStop;
      }
    | { ok: true; superseded: true }
    | { ok: false; error?: string }
  >(
    'step tour',
    '/api/canvas/tour/go',
    { ok: false, error: 'Could not reach the canvas server.' },
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...to, present: false, presenter }),
    },
  );
  // Only a local cancellation invalidates this intent. Remote steps/exits are
  // ordered by the server stamp, even if an older exit hid the pending restart.
  if (run !== presentationRun || !isCurrentPresenter(presenter)) return;
  if (result.ok) {
    if ('superseded' in result) {
      if (previous === lastDelivery)
        presentationError.value = 'The presentation request was superseded. Exit and present again.';
    } else applyTourStep({ ...result, present: true });
  } else if (previous === lastDelivery) presentationError.value = result.error ?? 'Could not change the tour stop.';
}

/** Present from the first stop, or resume where the tour already is (`?present=1`). */
export async function startPresentation(resume = false): Promise<void> {
  const run = ++presentationRun;
  presenting.value = true;
  presentationError.value = '';
  presentationCursor.value = null;
  // Reserve the gesture before the read: an older resume cannot overtake Next.
  const presenter = nextPresenter();
  if (!presenter) return;
  const at = resume
    ? (await requestJson<{ position?: number | null }>('read tour', '/api/canvas/tour', {})).position
    : null;
  if (run !== presentationRun || !isCurrentPresenter(presenter)) return;
  await stepTour({ stop: typeof at === 'number' ? at : 0 }, presenter);
}

function hidePresentation(): void {
  stepSeq++;
  cancelViewportAnimation();
  presenting.value = false;
  presentationError.value = '';
  presentationCursor.value = null;
}

/** Local cancellation also fences pending requests from this presentation. */
export function dismissPresentation(): void {
  presentationRun++;
  hidePresentation();
}

export function endPresentation(): void {
  dismissPresentation();
  const presenter = nextPresenter();
  if (!presenter) return;
  void requestBestEffort('exit tour', '/api/canvas/tour/exit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ presenter }),
  });
}
