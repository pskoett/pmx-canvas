/**
 * A ticking "now" for countdowns and relative ages. `intervalMs` 0 stops the
 * ticker (the value still reads as the mount time) — pass 0 while the surface
 * that needs it is hidden so an idle page runs no timers.
 */
export declare function useNow(intervalMs?: number): number;
