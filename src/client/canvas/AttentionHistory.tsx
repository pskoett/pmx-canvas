import { attentionHistory } from '../state/attention-store';

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function AttentionHistory() {
  const entries = attentionHistory.value;
  if (entries.length === 0) return null;

  return (
    <aside class="attention-history" aria-label="Recent semantic changes">
      <div class="attention-history-header">
        <span class="attention-history-title">What Changed</span>
        <span class="attention-history-subtitle">Recent meaning shifts</span>
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
