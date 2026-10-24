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
import { type Camera, type Tour, type TourStop } from '../shared/tour.js';
export type TourStep = number | 'next' | 'previous';
export interface TourStepResult {
    index: number;
    total: number;
    stop: TourStop;
}
export interface TourState {
    tour: Tour;
    derived: boolean;
    position: number | null;
}
export declare function currentTour(): TourState;
/** Move the shared cursor. `next`/`previous` clamp at the ends; an explicit index must exist. */
export declare function goToTourStop(step: TourStep): TourStepResult;
export declare function exitTour(): void;
/**
 * Resolve an eased camera move and store its end camera as the board viewport
 * (unrecorded). The size is the last window a browser reported, so this is the
 * server's best estimate; the browser re-resolves against its real canvas area.
 */
export declare function moveCamera(input: unknown): {
    stop: TourStop;
    viewport: Camera;
};
