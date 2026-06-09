import { canvasState } from './canvas-state.js';

/** Hard ceiling on a single blocking wait, regardless of the requested timeout. */
export const AX_WAIT_MAX_MS = 120000;

export interface AxWaitResult<T> {
  /** Latest value, or null if the item does not exist / vanished mid-wait. */
  value: T | null;
  /** True only when the item still exists and is still pending after the wait. */
  pending: boolean;
}

/**
 * Block until a canvas-bound AX item resolves (its status leaves `pending`), the
 * timeout elapses, or the request aborts — the server side of report primitive D
 * ("gates that actually gate"). Resolves immediately when the item is already
 * resolved, missing, or `timeoutMs <= 0` (a plain single read). Subscribes to the
 * `ax` change channel and always disposes the listener + timer.
 */
export async function waitForAxResolution<T extends { status: string }>(opts: {
  read: () => T | null;
  isResolved: (value: T) => boolean;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<AxWaitResult<T>> {
  const { read, isResolved } = opts;
  const timeoutMs = Math.max(0, Math.min(opts.timeoutMs, AX_WAIT_MAX_MS));
  const pendingOf = (v: T | null): boolean => (v ? !isResolved(v) : false);

  const current = read();
  if (!current || isResolved(current) || timeoutMs === 0 || opts.signal?.aborted) {
    return { value: current, pending: pendingOf(current) };
  }

  return new Promise<AxWaitResult<T>>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      dispose();
      opts.signal?.removeEventListener('abort', onSettle);
      const v = read();
      resolve({ value: v, pending: pendingOf(v) });
    };
    const onSettle = finish;
    const check = (type: string): void => {
      if (type !== 'ax') return;
      const v = read();
      if (!v || isResolved(v)) finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    const dispose = canvasState.onChange(check);
    opts.signal?.addEventListener('abort', onSettle, { once: true });
  });
}
