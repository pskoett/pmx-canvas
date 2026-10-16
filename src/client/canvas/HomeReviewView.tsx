import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import { knowledgeLifecycleEnabled } from '../state/workspace-settings';
import { memoryKey } from '../../shared/memory-graph.js';
import { boardList, openMemoryTarget } from '../state/boards-store';
import { knowledge, knowledgeUnavailable, refreshKnowledge } from '../state/knowledge-store';
import { isSelectionEscape } from '../utils/keyboard';

/** Queue metadata and qualification are one authoritative workspace observation. */
export function HomeReviewView({
  folder,
  folders,
  onScopeChange,
}: {
  folder: string;
  folders: string[];
  onScopeChange: (folder: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [sourcesOnly, setSourcesOnly] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState('');
  const enabled = knowledgeLifecycleEnabled.value;
  useEffect(() => {
    if (enabled) void refreshKnowledge();
  }, [enabled]);
  useLayoutEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (!knowledgeLifecycleEnabled.value) return;
      if (!isSelectionEscape(event)) return;
      event.preventDefault();
      setSearch('');
      setSourcesOnly(false);
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);
  const catalog = knowledge.value;
  const inScope = (path: string | null) => !folder || path === folder || !!path?.startsWith(`${folder}/`);
  const scoped = (catalog?.reviewCards ?? []).filter((card) => inScope(card.folder));
  const query = search.trim().toLocaleLowerCase();
  const rows = scoped.filter((card) => {
    const status = catalog?.cards[memoryKey(card)];
    return (
      status &&
      (!sourcesOnly || status.sources.length > 0) &&
      (!query ||
        `${card.title} ${card.boardTitle} ${status.reasons.join(' ')} ${status.sources.map((source) => source.title).join(' ')}`
          .toLocaleLowerCase()
          .includes(query))
    );
  });
  const scopedBoards = new Set(boardList.value.filter((board) => inScope(board.folder)).map((board) => board.id));
  const unknown = Object.entries(catalog?.cards ?? {}).filter(
    ([key, status]) => !status.retired && status.unknown && scopedBoards.has((JSON.parse(key) as [string, string])[0]),
  ).length;
  if (!enabled) return null;
  return (
    <section class="home-review-view" aria-label="Card review queue">
      <div class="home-main-head">
        <div class="home-main-title">
          <h1 class="home-view-title">Knowledge review</h1>
          <p>{folder ? `${folder} and descendants` : 'Whole library'}</p>
        </div>
        <label>
          Review scope
          <select value={folder} onChange={(event) => onScopeChange(event.currentTarget.value)}>
            <option value="">Whole library</option>
            {folders.map((path) => (
              <option key={path} value={path}>
                {path} and descendants
              </option>
            ))}
          </select>
        </label>
      </div>
      <div class="home-review-controls">
        <label>
          Find review cards
          <input type="search" value={search} onInput={(event) => setSearch(event.currentTarget.value)} />
        </label>
        <label>
          <input
            type="checkbox"
            checked={sourcesOnly}
            onChange={(event) => setSourcesOnly(event.currentTarget.checked)}
          />
          Source warnings only
        </label>
        <button type="button" class="home-button" onClick={() => void refreshKnowledge()}>
          Refresh queue
        </button>
      </div>
      {knowledgeUnavailable.value && (
        <p role="status">Queue unavailable. Retained results may be out of date. Refresh to retry.</p>
      )}
      {error && <p role="alert">{error}</p>}
      {!catalog ? (
        <p>Loading review cards…</p>
      ) : (
        <>
          <p class="home-review-count">
            Review needed: {scoped.length} {scoped.length === 1 ? 'card' : 'cards'} · Showing {rows.length}
          </p>
          <table class="home-review-table">
            <thead>
              <tr>
                <th>Card</th>
                <th>Board</th>
                <th>Why review</th>
                <th>Last checked</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((card) => {
                const key = memoryKey(card);
                const status = catalog.cards[key];
                const reasons = [
                  ...status.reasons,
                  ...status.sources.map(
                    (source) => `${source.title}: ${source.reasons.join(' ') || 'Source needs review.'}`,
                  ),
                ];
                return (
                  <tr key={key}>
                    <td data-label="Card">{card.title}</td>
                    <td data-label="Board">{card.boardTitle}</td>
                    <td data-label="Why review">{reasons.join(' ') || 'A source needs review.'}</td>
                    <td data-label="Last checked">
                      {status.lastValidatedAt ? new Date(status.lastValidatedAt).toLocaleString() : 'Never checked'}
                    </td>
                    <td>
                      <button
                        type="button"
                        class="home-button"
                        disabled={opening === key}
                        aria-label={`Open review: ${card.title} on ${card.boardTitle}`}
                        onClick={async () => {
                          if (!knowledgeLifecycleEnabled.value) return;
                          setOpening(key);
                          setError('');
                          const ok = await openMemoryTarget(card, { review: true });
                          setOpening(null);
                          if (!ok)
                            setError(
                              'Review did not open. The card may have moved or navigation was cancelled. Refresh and try again.',
                            );
                        }}
                      >
                        Open review
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <p>No actionable cards in these filters.</p>}
          <p class="home-review-neutral">
            No review policy: {unknown} {unknown === 1 ? 'card' : 'cards'}. Missing policy is neutral, not overdue.
            Explicit content or source warnings still enter the queue.
          </p>
        </>
      )}
    </section>
  );
}
