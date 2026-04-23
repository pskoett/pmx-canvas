import {
  attentionHistory,
  attentionHistoryOpen,
  attentionHistoryUnread,
  closeAttentionHistory,
  openAttentionHistory,
} from '../state/attention-store';

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function AttentionHistory() {
  const entries = attentionHistory.value;
  if (entries.length === 0) return null;

  const isOpen = attentionHistoryOpen.value;
  const unread = attentionHistoryUnread.value;

  if (!isOpen) {
    return (
      <button
        type="button"
        class="attention-history-tab"
        onClick={openAttentionHistory}
        aria-label={unread > 0 ? `Recent updates — ${unread} new` : 'Recent updates'}
        title={unread > 0 ? `${unread} new updates since last viewed` : 'Recent updates'}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
          <circle cx="4.5" cy="8" r="1.1" fill="currentColor" stroke="none" />
          <line x1="6.5" y1="6.5" x2="12.5" y2="6.5" />
          <line x1="6.5" y1="8" x2="11" y2="8" />
          <line x1="6.5" y1="9.5" x2="12" y2="9.5" />
        </svg>
        <span class="attention-history-tab-label">Updates</span>
        {unread > 0 && (
          <span class="attention-history-tab-badge" aria-hidden="true">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
    );
  }

  return (
    <aside class="attention-history" aria-label="Recent semantic changes">
      <div class="attention-history-header">
        <div class="attention-history-header-text">
          <span class="attention-history-title">Recent Updates</span>
          <span class="attention-history-subtitle">Focus and meaning shifts</span>
        </div>
        <button
          type="button"
          class="attention-history-close"
          onClick={closeAttentionHistory}
          aria-label="Collapse changes panel"
          title="Collapse"
        >
          ×
        </button>
      </div>
      <div class="attention-history-list">
        {entries.map((entry) => (
          <article key={entry.id} class={`attention-history-entry attention-tone-${entry.tone}`}>
            <div class="attention-history-meta">
              <span class="attention-history-kind">{entry.title}</span>
              <time class="attention-history-time" dateTime={new Date(entry.createdAt).toISOString()}>
                {formatTimestamp(entry.createdAt)}
              </time>
            </div>
            <p class="attention-history-detail">{entry.detail}</p>
          </article>
        ))}
      </div>
    </aside>
  );
}
