import { type TourStop } from '../../shared/tour.js';
import type { ViewportState } from '../types';
export declare const presenting: import("@preact/signals-core").Signal<boolean>;
export declare const recordingCamera: import("@preact/signals-core").Signal<boolean>;
/** Why the current stop cannot be shown (missing target, no stops, server unreachable). */
export declare const presentationError: import("@preact/signals-core").Signal<string>;
export declare function ownsCamera(): boolean;
/**
 * Ease this viewer's camera to a stop: log-space zoom, optional pull-back.
 * Reduced motion jumps straight to the end. Throws when the target is missing.
 */
export declare function playStop(stop: TourStop, onDone?: (end: ViewportState) => void): void;
/**
 * Show a tour stop, entering presentation if needed. Entering hides the
 * chrome, so the canvas area is measured only after that layout has
 * committed (two frames); the latest step always wins.
 */
export declare function presentStop(stop: TourStop): void;
/**
 * Move the server's shared tour cursor. The `canvas-tour-step` echo does the
 * animating, here and in every other presenting viewer, so a human's keys and
 * an agent's `tour.go` always agree on where the tour is.
 */
export declare function stepTour(to: {
    stop: number;
} | {
    step: 'next' | 'previous';
}): Promise<void>;
/** Present from the first stop, or resume where the tour already is (`?present=1`). */
export declare function startPresentation(resume?: boolean): Promise<void>;
export declare function endPresentation(): void;
