/**
 * Driving a board tour: the shared stop cursor and eased camera moves.
 *
 * Navigation, not editing: nothing here records undo history, and the cursor
 * is in-memory (like presence) — a restart or board switch starts over at the
 * first stop. The browser animates; the server only decides WHERE to go and
 * broadcasts it, so an agent and every presenting viewer agree on the stop.
 *
 * This module must never import server.ts or index.ts.
 */
import { derivedTour, resolveStop, tourStopSchema, type Camera, type Tour, type TourStop } from '../shared/tour.js';
import { canvasState } from './canvas-state.js';
import { getClientViewportSize } from './canvas-operations.js';
import { OperationError } from './operations/types.js';

export type TourStep = number | 'next' | 'previous';

export interface TourStepResult {
  index: number;
  total: number;
  stop: TourStop;
}

let cursor: { boardId: string | null; index: number } | null = null;

export function currentTour(): Tour {
  return canvasState.getTour() ?? derivedTour(canvasState.getLayout().nodes);
}

/** The stop the tour is on for the active board, or null when not touring. */
export function tourPosition(): number | null {
  return cursor && cursor.boardId === canvasState.activeBoardId ? cursor.index : null;
}

/** Move the shared cursor. `next`/`previous` clamp at the ends; an explicit index must exist. */
export function goToTourStop(step: TourStep): TourStepResult {
  const { stops } = currentTour();
  if (stops.length === 0) {
    throw new OperationError('This board has no tour stops. Save a tour or add groups.', 400);
  }
  const at = tourPosition();
  let index: number;
  if (step === 'next') index = at === null ? 0 : Math.min(stops.length - 1, at + 1);
  else if (step === 'previous') index = at === null ? 0 : Math.max(0, at - 1);
  else if (Number.isInteger(step) && step >= 0 && step < stops.length) index = step;
  else throw new OperationError(`Tour stop ${step} does not exist (stops 0–${stops.length - 1}).`, 400);
  cursor = { boardId: canvasState.activeBoardId, index };
  return { index, total: stops.length, stop: stops[index] as TourStop };
}

export function exitTour(): void {
  cursor = null;
}

/**
 * Resolve an eased camera move and store its end camera as the board viewport
 * (unrecorded). The size is the last window a browser reported, so this is the
 * server's best estimate; the browser re-resolves against its real canvas area.
 */
export function moveCamera(input: unknown): { stop: TourStop; viewport: Camera } {
  const parsed = tourStopSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationError('Give exactly one of nodeId, rect {x,y,width,height} or viewport {x,y,scale}.', 400);
  }
  const stop = parsed.data;
  if ('nodeId' in stop.target && !canvasState.getNode(stop.target.nodeId)) {
    throw new OperationError(`Node "${stop.target.nodeId}" not found.`, 404);
  }
  const size = getClientViewportSize() ?? { width: 1440, height: 900 };
  let viewport: Camera;
  try {
    viewport = resolveStop(stop, canvasState.getLayout().nodes, size.width, size.height);
  } catch (error) {
    throw new OperationError(error instanceof Error ? error.message : String(error), 400);
  }
  canvasState.withSuppressedRecording(() => canvasState.setViewport(viewport));
  return { stop, viewport };
}
