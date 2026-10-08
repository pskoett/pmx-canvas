import { age } from '../utils/time-ago';
import { useEffect, useRef, useState } from 'preact/hooks';
import { IconPin } from '../icons';
import { activeBoardId, boardList, setBoardPinned } from '../state/boards-store';
import { clearContextPins, contextPinnedNodeIds, nodes, toggleContextPin } from '../state/canvas-store';
import {
  approxTokens,
  briefSize,
  formatTokens,
  pinnedBoardReads,
  refreshContextChip,
} from '../state/context-chip-store';
import { contextPinMeta, linksChanged, pinnedReadState, writerName } from '../state/context-status-store';
import { nearPins } from '../state/near-pin-store';
import { activeSession } from '../state/presence-store';

/**
 * One context chip (docs/design/ContextChip.dc.html): everything in the agent's
 * context, in brief order — cards pinned on this board, near (derived, muted),
 * pinned boards (sent as maps) — with what the brief costs in tokens. Opened,
 * one list with read state and unpin.
 */

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
  const chip = useRef<HTMLButtonElement>(null);
  const boardId = activeBoardId.value;

  useEffect(() => {
    if (!open) return;
    refreshContextChip();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      chip.current?.focus();
    };
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

  const size = briefSize.value;
  const cost = size ? `≈ ${approxTokens(size.chars)} tokens` : '';
  const host = activeSession.value;

  const segments: Array<{ text: string; kind?: 'near' | 'agent' }> = [];
  if (cardIds.length) segments.push({ text: plural(cardIds.length, 'card') });
  if (near.length) segments.push({ text: `${near.length} near`, kind: 'near' });
  if (boards.length) segments.push({ text: plural(boards.length, 'board') });
  if (agentOnly) {
    const by = pinners.find((pinner) => pinner?.actor === 'agent');
    segments.push({ text: `by ${by ? writerName(by) : 'agent'}`, kind: 'agent' });
  }

  return (
    <div class="context-chip-wrap" ref={root}>
      <button
        ref={chip}
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
            <span class="context-chip-narrow">{cardIds.length + boards.length} in context</span>
            {cost && (
              <span class="context-chip-cost" data-testid="token-cost">
                {cost}
              </span>
            )}
          </>
        )}
      </button>
      {open && (
        <div class="context-panel" role="dialog" aria-label="In the agent's context">
          <div class="context-panel-head">
            <span class="context-panel-title">In the agent’s context</span>
            {cost && <span class="context-panel-mono">{cost}</span>}
          </div>
          {empty ? (
            <p class="context-panel-cap">
              Nothing is pinned. Pin a card or a board and the agent gets it first; it can still find and pull anything
              else on the board.
            </p>
          ) : (
            <>
              <p class="context-panel-cap">
                What the canvas sends the agent costs {cost || 'a few tokens'}.
                {host?.contextUsage
                  ? ` ${host.label}’s whole context holds ${formatTokens(host.contextUsage.used)} tokens.`
                  : ''}
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
                  const node = nodes.value.get(id);
                  const state = pinnedReadState(id, node?.contentRevision ?? 0);
                  const links = state.kind === 'read' && linksChanged(id, node?.linksRevision ?? 0);
                  const byAgent = contextPinMeta.value[id]?.pinnedBy.actor === 'agent';
                  return (
                    <li key={id} class="context-panel-row">
                      <span class="context-panel-pin">
                        <IconPin size={9} />
                        {byAgent && <span class="context-chip-agent-dot" aria-hidden="true" />}
                      </span>
                      <span class="context-panel-name">{nodeTitle(id)}</span>
                      {links ? (
                        <span class="context-tag is-links">
                          <svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true">
                            <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
                          </svg>
                          links changed
                        </span>
                      ) : (
                        <ReadTag state={state.kind} at={state.kind === 'not-read' ? null : state.at} />
                      )}
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
}

function ReadTag({ state, at }: { state: 'read' | 'not-read' | 'changed'; at: string | null }) {
  if (state === 'changed') return <span class="context-tag is-changed">△ changed</span>;
  if (state === 'read' && at) return <span class="context-tag is-read">read {age(at)}</span>;
  return <span class="context-tag is-not-read">not read yet</span>;
}
