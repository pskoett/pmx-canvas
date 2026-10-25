import { type TourStop } from '../../shared/tour.js';
import type { ViewportState } from '../types';
export declare const presenting: import("@preact/signals-core").Signal<boolean>;
export declare const recordingCamera: import("@preact/signals-core").Signal<boolean>;
/** Why the current stop cannot be shown (missing target, no stops, server unreachable). */
export declare const presentationError: import("@preact/signals-core").Signal<string>;
/** Read-only mirror of the server's shared cursor, never advanced optimistically. */
export declare const presentationCursor: import("@preact/signals-core").Signal<{
    index: number;
    total: number;
} | null>;
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
/** Apply either delivery of the server's shared cursor, without replaying its echo. */
export declare function applyTourStep(data: Record<string, unknown>): void;
export declare function applyTourExit(data: Record<string, unknown>): void;
/** Move the shared cursor. A successful response also works while events are delayed or disconnected. */
export declare function stepTour(to: {
    stop: number;
} | {
    step: 'next' | 'previous';
}, presenter?: {
    clientId: string;
    intent: number;
    catalogEpoch: string;
    boardGeneration: number;
} | null): Promise<void>;
/** Present from the first stop, or resume where the tour already is (`?present=1`). */
export declare function startPresentation(resume?: boolean): Promise<void>;
/** Local cancellation also fences pending requests from this presentation. */
export declare function dismissPresentation(): void;
export declare function endPresentation(): void;
