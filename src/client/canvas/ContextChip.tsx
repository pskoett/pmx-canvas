import { useEffect, useRef, useState } from 'preact/hooks';
import { IconPin } from '../icons';
import { activeBoardId, boardList, setBoardPinned } from '../state/boards-store';
import { clearContextPins, contextPinnedNodeIds, nodes, toggleContextPin } from '../state/canvas-store';
import { approxTokens, briefSize, pinnedBoardReads, refreshContextChip } from '../state/context-chip-store';
import { contextPinMeta, pinnedReadState, writerName } from '../state/context-status-store';
import { nearPins } from '../state/near-pin-store';
import { activeSession } from '../state/presence-store';

/**
 * One context chip (docs/design/ContextChip.dc.html): everything in the agent's
 * context, in brief order — cards pinned on this board, near (derived, muted),
 * pinned boards (sent as maps) — with the brief's share of its budget. Opened,
 * one list with read state and unpin.
 */

function ago(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function nodeTitle(id: string): string {
  const node = nodes.value.get(id);
  return typeof node?.data.title === 'string' && node.data.title ? node.data.title : id;
}

export function ContextChip() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const boardId = activeBoardId.value;

  useEffect(() => {
    if (!open) return;
    refreshContextChip();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    const onDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  if (!boardId) return null;

  const cardIds = [...contextPinnedNodeIds.value];
  const near = [...nearPins.value.entries()];
  const boards = boardList.value.filter((board) => board.pin && board.id !== boardId);
  const empty = cardIds.length === 0 && boards.length === 0;
  const pinners = [
    ...cardIds.map((id) => contextPinMeta.value[id]?.pinnedBy),
    ...boards.map((board) => board.pin?.pinnedBy),
  ];
  const agentOnly = !empty && pinners.every((by) => by?.actor === 'agent');

  const hostWindow = activeSession.value?.contextUsage;
  const size = briefSize.value;
  const clipped = !hostWindow && !!size?.clipped;
  const ratio = hostWindow ? hostWindow.used / Math.max(1, hostWindow.total) : size ? size.chars / size.budget : 0;
  const pct = Math.min(100, Math.round(ratio * 100));
  const meterText = hostWindow
    ? `${pct}% window`
    : clipped
      ? 'over'
      : size
        ? `≈ ${approxTokens(size.chars)} tokens`
        : '';

  const segments: Array<{ text: string; kind?: 'near' | 'warn' | 'agent' }> = [];
  if (cardIds.length) segments.push({ text: plural(cardIds.length, 'card') });
  if (near.length) segments.push({ text: `${near.length} near`, kind: 'near' });
  if (boards.length) segments.push({ text: plural(boards.length, 'board') });
  if (agentOnly) {
    const by = pinners.find((pinner) => pinner?.actor === 'agent');
    segments.push({ text: `by ${by ? writerName(by) : 'agent'}`, kind: 'agent' });
  }
  if (clipped) segments.push({ text: '△ brief clipped', kind: 'warn' });

  return (
    <div class="context-chip-wrap" ref={root}>
      <button
        type="button"
        class={`context-chip${empty ? ' is-empty' : ''}${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="context-chip"
        onClick={() => setOpen(!open)}
      >
        <span class="context-chip-pin">
          <IconPin size={13} />
          {agentOnly && <span class="context-chip-agent-dot" aria-hidden="true" />}
        </span>
        {empty ? (
          <span>Nothing in context</span>
        ) : (
          <>
            <span class="context-chip-wide">
              {segments.map((segment, index) => (
                <span key={segment.text} class={segment.kind ? `is-${segment.kind}` : undefined}>
                  {index > 0 ? ' · ' : ''}
                  {segment.text}
                </span>
              ))}
            </span>
            <span class="context-chip-narrow">
              {cardIds.length + boards.length} in context{clipped ? ' · △' : ''}
            </span>
            {meterText && (
              <>
                <span class={`context-chip-track${clipped ? ' is-over' : ''}`} aria-hidden="true">
                  <span style={{ width: `${pct}%` }} />
                </span>
                <span class={`context-chip-meter${clipped ? ' is-over' : ''}`} data-testid="budget-label">
                  {meterText}
                </span>
              </>
            )}
          </>
        )}
      </button>
      {open && (
        <div class="context-panel" role="dialog" aria-label="In the agent's context">
          <div class="context-panel-head">
            <span class="context-panel-title">In the agent’s context</span>
            {meterText && (
              <span class="context-panel-mono">
                {hostWindow ? `${session()}’s window · ${pct}%` : `${meterText} · ${pct}%`}
              </span>
            )}
          </div>
          {empty ? (
            <p class="context-panel-cap">
              Nothing is pinned. Pin a card or a board and the agent gets it first; it can still find and pull anything
              else on the board.
            </p>
          ) : (
            <>
              <span class={`context-panel-track${clipped ? ' is-over' : ''}`} aria-hidden="true">
                <span style={{ width: `${pct}%` }} />
              </span>
              <p class="context-panel-cap">
                Share of the brief budget ({size?.budget.toLocaleString('en-US') ?? '16,000'} characters), shown as
                tokens. When the host reports the agent’s real window this shows that instead. Amber: the brief went
                over and was clipped.
              </p>

              <div class="context-panel-section">
                <span>Cards on this board · {cardIds.length}</span>
                {cardIds.length > 0 && (
                  <button type="button" class="context-panel-link" onClick={() => clearContextPins()}>
                    Clear all
                  </button>
                )}
              </div>
              <ul class="context-panel-list">
                {cardIds.map((id) => {
                  const state = pinnedReadState(id, nodes.value.get(id)?.contentRevision ?? 0);
                  const byAgent = contextPinMeta.value[id]?.pinnedBy.actor === 'agent';
                  return (
                    <li key={id} class="context-panel-row">
                      <span class="context-panel-pin">
                        <IconPin size={9} />
                        {byAgent && <span class="context-chip-agent-dot" aria-hidden="true" />}
                      </span>
                      <span class="context-panel-name">{nodeTitle(id)}</span>
                      <ReadTag state={state.kind} at={state.kind === 'not-read' ? null : state.at} />
                      <button
                        type="button"
                        class="context-panel-x"
                        aria-label={`Unpin ${nodeTitle(id)}`}
                        onClick={() => toggleContextPin(id)}
                      >
                        ×
                      </button>
                    </li>
                  );
                })}
              </ul>

              {near.length > 0 && (
                <>
                  <div class="context-panel-section">
                    <span>Near · {near.length}</span>
                    <span class="context-panel-cap-inline">derived · sent as title + summary</span>
                  </div>
                  <ul class="context-panel-list">
                    {near.map(([id, pins]) => (
                      <li key={id} class="context-panel-row is-near">
                        <span class="context-panel-near-ring" aria-hidden="true" />
                        <span class="context-panel-name is-soft">{nodeTitle(id)}</span>
                        <span class="context-panel-cap-inline">near {pins[0]?.pinTitle}</span>
                        <button type="button" class="context-panel-promote" onClick={() => toggleContextPin(id)}>
                          Pin
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {boards.length > 0 && (
                <>
                  <div class="context-panel-section">
                    <span>Boards · {boards.length}</span>
                    <span class="context-panel-cap-inline">sent as a map</span>
                  </div>
                  <ul class="context-panel-list">
                    {boards.map((board) => {
                      const read = pinnedBoardReads.value.get(board.id);
                      return (
                        <li key={board.id} class="context-panel-row">
                          <svg
                            class="context-panel-board"
                            viewBox="0 0 24 24"
                            width="14"
                            height="14"
                            aria-hidden="true"
                          >
                            <path d="M4 4h16v16H4zM9 9h6v6H9z" />
                          </svg>
                          <span class="context-panel-name">{board.name}</span>
                          <ReadTag state={read ? 'read' : 'not-read'} at={read?.lastReadAt ?? null} />
                          <span class="context-panel-cap-inline">map</span>
                          <button
                            type="button"
                            class="context-panel-x"
                            aria-label={`Unpin ${board.name}`}
                            onClick={() => void setBoardPinned(board.id, false)}
                          >
                            ×
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <p class="context-panel-cap">
                    A pinned board travels as a map: its folder, README summary, each pinned card’s title and summary,
                    and its links and backlinks. The agent pulls a card or the whole board in full when it decides it
                    needs to.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );

  function session(): string {
    return activeSession.value?.label ?? 'Agent';
  }
}

function ReadTag({ state, at }: { state: 'read' | 'not-read' | 'changed'; at: string | null }) {
  if (state === 'changed') return <span class="context-tag is-changed">△ changed</span>;
  if (state === 'read' && at) return <span class="context-tag is-read">read {ago(at)}</span>;
  return <span class="context-tag is-not-read">not read yet</span>;
}
