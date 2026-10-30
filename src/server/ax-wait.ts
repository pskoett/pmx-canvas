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
  opts.signal?.throwIfAborted();
  const read = canvasState.bindBoard(opts.read);
  const { isResolved } = opts;
  const timeoutMs = Math.max(0, Math.min(opts.timeoutMs, AX_WAIT_MAX_MS));
  const pendingOf = (v: T | null): boolean => (v ? !isResolved(v) : false);

  const current = read();
  if (!current || isResolved(current) || timeoutMs === 0) {
    return { value: current, pending: pendingOf(current) };
  }

  return new Promise<AxWaitResult<T>>((resolve, reject) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      dispose();
      disposeOwner();
      opts.signal?.removeEventListener('abort', onAbort);
      if (opts.signal?.aborted) {
        reject(opts.signal.reason);
        return;
      }
      try {
        const v = read();
        resolve({ value: v, pending: pendingOf(v) });
      } catch (error) {
        reject(error);
      }
    };
    const onAbort = finish;
    const check = (type: string): void => {
      if (type !== 'ax') return;
      const v = read();
      if (!v || isResolved(v)) finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    const dispose = canvasState.onChange(check);
    const disposeOwner = canvasState.onBoardDispose(() => {
      finish();
    });
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    if (opts.signal?.aborted) finish();
  });
}

/**
 * Block until `ready()` turns true after a change on `channel` (default
 * 'ax-timeline'), or the timeout elapses. The steering long-poll: the gate
 * waiter above is item/status-shaped; this one waits on a plain condition —
 * the reactive loop for agent hosts that cannot be woken from outside (their
 * model only runs while their host gives it a turn, so one call parks here
 * instead of burning that turn on tight polling).
 */
export async function waitForAxCondition(opts: {
  ready: () => boolean;
  timeoutMs: number;
  channel?: string;
  signal?: AbortSignal;
}): Promise<void> {
  opts.signal?.throwIfAborted();
  const timeoutMs = Math.max(0, Math.min(opts.timeoutMs, AX_WAIT_MAX_MS));
  const ready = canvasState.bindBoard(opts.ready);
  if (timeoutMs === 0 || ready()) return;
  const channel = opts.channel ?? 'ax-timeline';
  await new Promise<void>((resolve, reject) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      dispose();
      disposeOwner();
      opts.signal?.removeEventListener('abort', finish);
      if (opts.signal?.aborted) {
        reject(opts.signal.reason);
        return;
      }
      resolve();
    };
    const check = (type: string): void => {
      if (type === channel && ready()) finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    // Steering is workspace-wide and can be sent from another board. Keep
    // ready() bound to its owner but listen outside the board-specific filter.
    const dispose = canvasState.withVisibleBoard(() => canvasState.onChange(check));
    const disposeOwner = canvasState.onBoardDispose(finish);
    opts.signal?.addEventListener('abort', finish, { once: true });
    if (opts.signal?.aborted) finish();
  });
}
