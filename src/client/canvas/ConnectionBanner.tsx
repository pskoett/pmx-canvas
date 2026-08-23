import { computed } from '@preact/signals';
import {
  connectionStatus,
  hasInitialServerLayout,
  reconnectAttempt,
  reconnectDelay,
  workbenchConnectionEpoch,
} from '../state/canvas-store';

/**
 * Degraded connection states (rail-chrome-v2 phase 7, design item 14), mapped
 * onto the transport the bridge already runs:
 * - reconnecting: the stream (SSE or the polling fallback) is down and the
 *   bridge is backing off. Edits still go over HTTP; the board may be stale.
 * - resyncing: a transport came back after a drop and the full `connected`
 *   snapshot is being applied — the seq cursor was dropped, the board reloads
 *   from the server's snapshot without touching local edits.
 * Neither shows on first boot; the top-bar dot carries the same state.
 */
export type DegradedState = 'reconnecting' | 'resyncing' | null;

export const degradedState = computed<DegradedState>(() => {
  if (connectionStatus.value === 'disconnected') return 'reconnecting';
  if (connectionStatus.value === 'connected' && !hasInitialServerLayout.value && workbenchConnectionEpoch.value > 1) {
    return 'resyncing';
  }
  return null;
});

export function ConnectionBanner() {
  const state = degradedState.value;
  if (!state) return null;
  if (state === 'reconnecting') {
    const attempt = reconnectAttempt.value;
    const delay = reconnectDelay.value;
    return (
      <div class="connection-banner is-reconnecting" role="status" data-testid="connection-banner">
        <span class="connection-banner-glyph" aria-hidden="true">
          ↻
        </span>
        <span class="connection-banner-text">
          <b>Reconnecting…</b> live updates are paused; edits still save, the board may be stale until the stream
          returns.
        </span>
        <span class="connection-banner-meta">
          {attempt > 0 ? `retry ${attempt}` : 'retrying'}
          {delay > 0 ? ` · ${Math.max(1, Math.round(delay / 1000))}s` : ''}
        </span>
      </div>
    );
  }
  return (
    <div class="connection-banner is-resyncing" role="status" data-testid="connection-banner">
      <span class="connection-banner-glyph" aria-hidden="true">
        ⟳
      </span>
      <span class="connection-banner-text">
        <b>Resyncing from snapshot</b> — the event cursor went stale; the board reloads without losing local edits.
      </span>
      <span class="connection-banner-progress" aria-hidden="true">
        <span class="connection-banner-progress-fill" />
      </span>
    </div>
  );
}
