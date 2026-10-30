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
import {
  derivedTour,
  resolveStop,
  tourPresenterSchema,
  tourStopSchema,
  type Camera,
  type Tour,
  type TourPresenter,
  type TourStop,
} from '../shared/tour.js';
import { boardCatalogEpoch, canvasState } from './canvas-state.js';
import { getClientViewportSize } from './canvas-operations.js';
import { OperationError } from './operations/types.js';

export type TourStep = number | 'next' | 'previous';

export interface TourDelivery {
  catalogEpoch: string;
  boardGeneration: number;
  sequence: number;
}

export interface TourStepResult extends TourDelivery {
  index: number;
  total: number;
  stop: TourStop;
}

export interface TourSuperseded {
  superseded: true;
}

export interface TourState {
  tour: Tour;
  derived: boolean;
  position: number | null;
}

let cursor: { boardGeneration: number; tour: string; index: number } | null = null;
// One order for both HTTP acknowledgements and event delivery in this server run.
let sequence = 0;
let presenterGeneration = -1;
const presenterIntents = new Map<string, number>();

function claimPresenter(presenter: TourPresenter | undefined): boolean {
  if (presenter === undefined) return true;
  const { clientId, intent, catalogEpoch, boardGeneration } = tourPresenterSchema.parse(presenter);
  if (catalogEpoch !== boardCatalogEpoch || boardGeneration !== canvasState.boardGeneration) return false;
  if (presenterGeneration !== boardGeneration) {
    presenterIntents.clear();
    presenterGeneration = boardGeneration;
  }
  const previous = presenterIntents.get(clientId);
  if (previous !== undefined && intent <= previous) return false;
  // Never evict an identity: that would make its delayed requests valid again.
  if (previous === undefined && presenterIntents.size >= 4096)
    throw new OperationError(
      'Too many presentation documents on this board activation. Reopen the board to continue.',
      409,
    );
  // Even a later invalid stop supersedes older commands. Claim before resolving it.
  presenterIntents.set(clientId, intent);
  return true;
}

function nextDelivery(): TourDelivery {
  return { catalogEpoch: boardCatalogEpoch, boardGeneration: canvasState.boardGeneration, sequence: ++sequence };
}

export function currentTour(): TourState {
  const saved = canvasState.getTour();
  const tour = saved ?? derivedTour(canvasState.nodeGeometry());
  return { tour, derived: !saved, position: tourPosition(tour) };
}

/** The stop the tour is on for the active board, or null when not touring. */
function tourPosition(tour: Tour): number | null {
  if (cursor && (cursor.boardGeneration !== canvasState.boardGeneration || cursor.tour !== JSON.stringify(tour))) {
    cursor = null;
  }
  return cursor?.index ?? null;
}

/** Move the shared cursor. `next`/`previous` clamp at the ends; an explicit index must exist. */
export function goToTourStop(step: TourStep): TourStepResult;
export function goToTourStop(step: TourStep, presenter: TourPresenter | undefined): TourStepResult | TourSuperseded;
export function goToTourStop(step: TourStep, presenter?: TourPresenter): TourStepResult | TourSuperseded {
  if (!claimPresenter(presenter)) return { superseded: true };
  const { tour, position: at } = currentTour();
  const { stops } = tour;
  if (stops.length === 0) {
    throw new OperationError('This board has no tour stops. Save a tour or add groups.', 400);
  }
  let index: number;
  if (step === 'next') index = at === null ? 0 : Math.min(stops.length - 1, at + 1);
  else if (step === 'previous') index = at === null ? 0 : Math.max(0, Math.min(stops.length - 1, at - 1));
  else if (Number.isInteger(step) && step >= 0 && step < stops.length) index = step;
  else throw new OperationError(`Tour stop ${step} does not exist (stops 0–${stops.length - 1}).`, 400);
  cursor = { boardGeneration: canvasState.boardGeneration, tour: JSON.stringify(tour), index };
  return {
    ...nextDelivery(),
    index,
    total: stops.length,
    stop: stops[index] as TourStop,
  };
}

export function exitTour(): TourDelivery;
export function exitTour(presenter: TourPresenter | undefined): TourDelivery | TourSuperseded;
export function exitTour(presenter?: TourPresenter): TourDelivery | TourSuperseded {
  if (!claimPresenter(presenter)) return { superseded: true };
  cursor = null;
  return nextDelivery();
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
  const nodes = 'nodeId' in stop.target ? canvasState.nodeGeometry() : [];
  const target = stop.target;
  if ('nodeId' in target && !nodes.some((node) => node.id === target.nodeId)) {
    throw new OperationError(`Node "${target.nodeId}" not found.`, 404);
  }
  const size = getClientViewportSize() ?? { width: 1440, height: 900 };
  let viewport: Camera;
  try {
    viewport = resolveStop(stop, nodes, size.width, size.height);
  } catch (error) {
    throw new OperationError(error instanceof Error ? error.message : String(error), 400);
  }
  canvasState.withSuppressedRecording(() => canvasState.setViewport(viewport));
  return { stop, viewport };
}
