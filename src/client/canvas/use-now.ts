import { useEffect, useState } from 'preact/hooks';

/**
 * A ticking "now" for countdowns and relative ages. `intervalMs` 0 stops the
 * ticker (the value still reads as the mount time) — pass 0 while the surface
 * that needs it is hidden so an idle page runs no timers.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (intervalMs <= 0) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
