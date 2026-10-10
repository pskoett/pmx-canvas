import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { BarHint } from './BarHint';
import { nodes, toggleContextPin } from '../state/canvas-store';
import { activeBoardId, boardList, openBoard } from '../state/boards-store';
import {
  activityLens,
  dismissSessionReceipt,
  type ReceiptNode,
  receiptNodeKey,
  type SessionContextActivity,
  sendSteering,
  sessionReceipt,
  setActivityLens,
  undoSessionEdits,
} from '../state/session-store';
import { IconClose, IconPin } from '../icons';
import { GLYPHS } from './NodeContextMark';
import { workbenchFetch } from '../state/workbench-transport';

/**
 * Session receipt (rail-chrome-v2 phase 5, design item 2): a dismissible card
 * at the canvas region's top-right after a session ends — what the session did
 * (items / done / vetoed), the pre-session snapshot (taken at attach, so View
 * diff shows the session's changes and a restore undoes them), and History
 * (the snapshots panel). Client-side state, cleared on dismiss (see
 * applySessionReceipt for which endings show at all and how a burst merges
 * into one card).
 */

export interface DiffSummary {
  added: number;
  removed: number;
  modified: number;
}

/** The wire shape is SnapshotDiffResult (addedNodes/removedNodes/modifiedNodes/addedEdges/removedEdges). */
export function summarizeDiff(diff: unknown): DiffSummary | null {
  if (!diff || typeof diff !== 'object') return null;
  const d = diff as Record<string, unknown>;
  const count = (value: unknown): number => (Array.isArray(value) ? value.length : 0);
  return {
    added: count(d.addedNodes) + count(d.addedEdges),
    removed: count(d.removedNodes) + count(d.removedEdges),
    modified: count(d.modifiedNodes),
  };
}

const titles = (nodes: ReceiptNode[]) => nodes.map((node) => node.title).join(', ');

function clock(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? ''
    : `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

/**
 * What the session did with context (docs/design/AgentContext.dc.html): an
 * amber line for pins it read that changed since, one row per kind of touch,
 * and the lens switch that dims every node the session did not touch.
 */
function ReceiptContext({
  context,
  label,
  snapshotId,
}: {
  context: SessionContextActivity;
  label: string;
  /** The pre-session snapshot: what Undo on an edit restores from (single sessions only). */
  snapshotId: string | null;
}) {
  const [told, setTold] = useState(false);
  const [restoredIds, setRestoredIds] = useState<string[]>([]);
  const [keptEdits, setKeptEdits] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const rowUndo =
    context.edited.length > 0 && context.edited.every((node) => restoredIds.includes(node.id))
      ? 'undone'
      : keptEdits
        ? 'kept'
        : null;
  useEffect(() => {
    setRestoredIds([]);
    setKeptEdits(false);
    setOpenId(null);
  }, [context]);
  const undo = async (edits: ReceiptNode[]) => {
    if (!snapshotId || undoing) return;
    setUndoing(true);
    try {
      const result = await undoSessionEdits(
        snapshotId,
        edits.filter((node) => !restoredIds.includes(node.id)),
      );
      setRestoredIds((previous) => [...previous, ...result.restored]);
      return result;
    } finally {
      setUndoing(false);
    }
  };
  const rows: Array<{ key: keyof SessionContextActivity; name: string; glyph: keyof typeof GLYPHS | 'pin' }> = [
    { key: 'read', name: 'Read', glyph: 'eye' },
    { key: 'pinned', name: 'Pinned', glyph: 'pin' },
    { key: 'created', name: 'Created', glyph: 'spark' },
    { key: 'edited', name: 'Edited', glyph: 'pen' },
  ];
  const present = rows.filter((row) => context[row.key].length > 0);
  if (present.length === 0 && context.changedSinceRead.length === 0) return null;
  const lensOn = activityLens.value?.kind === 'receipt';
  return (
    <div class="session-receipt-context" data-testid="session-receipt-context">
      {context.changedSinceRead.length > 0 && (
        <div class="session-receipt-warn">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={GLYPHS.warn} />
          </svg>
          <span>
            {titles(context.changedSinceRead)} changed after {label} read{' '}
            {context.changedSinceRead.length === 1 ? 'it' : 'them'}.
          </span>
          <button
            type="button"
            class="session-receipt-mini"
            disabled={told}
            onClick={() => {
              const them = context.changedSinceRead.length === 1 ? 'it' : 'them';
              void sendSteering(
                `${context.changedSinceRead.map((node) => `“${node.title}”`).join(', ')} changed after you read ${them} — read ${them} again before relying on ${them}.`,
              ).then((ok) => setTold(ok));
            }}
          >
            {told ? 'Told' : `Tell ${label}`}
          </button>
        </div>
      )}
      {present.map((row) => (
        <div key={row.key} class="session-receipt-context-row" data-row={row.key}>
          <div class="session-receipt-context-head">
            {row.glyph === 'pin' ? (
              <IconPin />
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={GLYPHS[row.glyph]} />
              </svg>
            )}
            <span class="session-receipt-context-name">{row.name}</span>
            <span class="session-receipt-context-count">{context[row.key].length}</span>
            {row.key === 'pinned' && (
              <button
                type="button"
                class="session-receipt-mini"
                disabled={context.pinned.some((node) => node.boardId && node.boardId !== activeBoardId.value)}
                onClick={() => {
                  for (const node of context.pinned) toggleContextPin(node.id);
                }}
              >
                Unpin
              </button>
            )}
            {row.key === 'edited' && snapshotId && (
              <button
                type="button"
                class="session-receipt-mini"
                disabled={
                  rowUndo !== null ||
                  undoing ||
                  context.edited.some((node) => node.boardId && node.boardId !== activeBoardId.value)
                }
                onClick={() => {
                  void undo(context.edited).then((result) => {
                    if (result?.ok) setKeptEdits(true);
                  });
                }}
              >
                {rowUndo === 'undone' ? '✓ Undone' : rowUndo === 'kept' ? 'Kept your edits' : 'Undo'}
              </button>
            )}
          </div>
          {row.key === 'edited' && rowUndo && (
            <div class="session-receipt-context-items">
              {rowUndo === 'undone' ? 'every card restored' : 'cards you edited since were left alone'}
            </div>
          )}
          {row.key === 'edited' ? (
            <ul class="session-receipt-edits">
              {context.edited.map((node) => (
                <EditLine
                  key={receiptNodeKey(node)}
                  node={node}
                  canUndo={snapshotId !== null}
                  undoing={undoing}
                  open={openId === receiptNodeKey(node)}
                  onToggle={() => setOpenId(openId === receiptNodeKey(node) ? null : receiptNodeKey(node))}
                  undone={restoredIds.includes(node.id)}
                  onUndo={() => void undo([node])}
                />
              ))}
            </ul>
          ) : (
            <div class="session-receipt-context-items">
              {row.key === 'pinned'
                ? context.pinned
                    .map((node) => (node.reason ? `${node.title} — “${node.reason}”` : node.title))
                    .join('; ')
                : titles(context[row.key])}
            </div>
          )}
        </div>
      ))}
      <button
        type="button"
        role="switch"
        aria-checked={lensOn}
        class={`session-receipt-lens${lensOn ? ' is-on' : ''}`}
        onClick={() => setActivityLens(!lensOn)}
      >
        <span class="session-receipt-lens-track" aria-hidden="true">
          <span class="session-receipt-lens-knob" />
        </span>
        Dim untouched nodes
      </button>
    </div>
  );
}

/** Align the bounded excerpts by word, preserving punctuation and whitespace verbatim. */
function changedWords(before: string, after: string) {
  const tokens = (text: string) => text.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
  const a = tokens(before);
  const b = tokens(after);
  const lengths = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const was: Array<{ text: string; changed: boolean }> = [];
  const now: Array<{ text: string; changed: boolean }> = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      was.push({ text: a[i++], changed: false });
      now.push({ text: b[j++], changed: false });
    } else if (i < a.length && (j === b.length || lengths[i + 1][j] >= lengths[i][j + 1])) {
      was.push({ text: a[i++], changed: true });
    } else {
      now.push({ text: b[j++], changed: true });
    }
  }
  return [was, now];
}

/** SeeChange.dc.html: one stacked, word-marked change, with Undo for the whole card. */
function EditLine({
  node,
  canUndo,
  undoing,
  open,
  onToggle,
  undone,
  onUndo,
}: {
  node: ReceiptNode;
  canUndo: boolean;
  undoing: boolean;
  open: boolean;
  onToggle: () => void;
  undone: boolean;
  onUndo: () => void;
}) {
  const onBoard = !node.boardId || node.boardId === activeBoardId.value;
  const current = onBoard ? nodes.value.get(node.id) : undefined;
  const board = boardList.value.find((entry) => entry.id === node.boardId);
  const sides = useMemo(
    () => (open ? changedWords(node.before ?? '', node.after ?? '') : []),
    [open, node.before, node.after],
  );
  const pair = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    // Long excerpts retain context above the edit; start each scroll box at
    // the first changed word rather than a screenful of identical preamble.
    for (const text of pair.current?.querySelectorAll<HTMLElement>('.session-receipt-diff-text') ?? []) {
      const change = text.querySelector('del, ins');
      if (change) text.scrollTop = change.getBoundingClientRect().top - text.getBoundingClientRect().top - 24;
    }
  }, [sides]);
  // Your own later edit wins: Undo would leave it, so it is not offered.
  const yours = current?.lastEditedBy?.actor === 'human';
  return (
    <li class="session-receipt-edit">
      <span class="session-receipt-edit-line">
        <span>
          {node.title}
          {node.change ? <span class="session-receipt-edit-change"> — {node.change}</span> : null}
        </span>
        {node.before !== undefined && (
          <button type="button" class="session-receipt-link" aria-expanded={open} onClick={onToggle}>
            {open ? 'Hide change' : 'See change'}
          </button>
        )}
      </span>
      {open && (
        <span ref={pair} class="session-receipt-diff-pair">
          {sides.map((words, side) => (
            <span class="session-receipt-diff-side" key={side}>
              <span class="session-receipt-diff-label">{side === 0 ? 'Before' : 'After'}</span>
              <span class="session-receipt-diff-text">
                {words.length
                  ? words.map(({ text, changed }, index) =>
                      text === '…' && (index === 0 || index === words.length - 1) ? (
                        <span key={index} class="session-receipt-diff-cut">
                          {text}
                        </span>
                      ) : changed ? (
                        side === 0 ? (
                          <del key={index}>{text}</del>
                        ) : (
                          <ins key={index}>{text}</ins>
                        )
                      ) : (
                        text
                      ),
                    )
                  : 'Empty'}
              </span>
            </span>
          ))}
          {canUndo && (
            <span class="session-receipt-undo">
              {current ? (
                <button
                  type="button"
                  class="session-receipt-mini"
                  disabled={undone || yours || undoing}
                  onClick={onUndo}
                >
                  {undone ? '✓ Undone' : yours ? 'You edited it since' : 'Undo this card'}
                </button>
              ) : board && !onBoard ? (
                <button type="button" class="session-receipt-mini" onClick={() => void openBoard(board.id)}>
                  Open {board.name} to undo
                </button>
              ) : (
                <span class="session-receipt-edit-change">Card no longer on this board</span>
              )}
              <span class="session-receipt-edit-change">
                {current
                  ? undone
                    ? 'the card shows Before again'
                    : yours
                      ? 'undo would lose your edit'
                      : node.before?.includes('…') || node.after?.includes('…')
                        ? 'undoes the whole card'
                        : 'puts back the text from before'
                  : board && !onBoard
                    ? `it is on ${board.name}`
                    : ''}
              </span>
            </span>
          )}
        </span>
      )}
    </li>
  );
}

export function SessionReceipt({ onOpenSnapshots }: { onOpenSnapshots: () => void }) {
  const receipt = sessionReceipt.value;
  const [diff, setDiff] = useState<DiffSummary | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  // A new or merged receipt: the old diff no longer describes it.
  useEffect(() => setDiff(null), [receipt]);
  if (!receipt) return null;

  const onSnapshotBoard = receipt.snapshot?.boardId === activeBoardId.value;
  const snapshotBoard = boardList.value.find((board) => board.id === receipt.snapshot?.boardId);
  const viewDiff = async () => {
    if (!receipt.snapshot || !onSnapshotBoard) return;
    setLoadingDiff(true);
    try {
      const response = await workbenchFetch(`/api/canvas/snapshots/${encodeURIComponent(receipt.snapshot.id)}/diff`, {
        headers: { 'x-pmx-workbench': '1' },
      });
      if (response.ok) {
        const body = (await response.json()) as { diff?: unknown };
        setDiff(summarizeDiff(body.diff) ?? { added: 0, removed: 0, modified: 0 });
      }
    } finally {
      setLoadingDiff(false);
    }
  };

  const endedLabel = clock(receipt.endedAt);
  const startedLabel = receipt.startedAt ? clock(receipt.startedAt) : '';
  const endedBy =
    receipt.endedBy === 'human'
      ? 'ended by you'
      : receipt.endedBy === 'idle-timeout'
        ? 'ended on idle timeout'
        : receipt.endedBy === 'agent'
          ? 'ended by the agent'
          : '';

  return (
    <div class="session-receipt" data-testid="session-receipt" role="status">
      <div class="session-receipt-head">
        <span class="session-receipt-dot" aria-hidden="true" />
        <span class="session-receipt-title">
          {receipt.sessions > 1
            ? `${receipt.sessions} sessions ended${endedLabel ? ` · ${endedLabel}` : ''}`
            : `What ${receipt.labels[0]} did`}
        </span>
        <button
          type="button"
          class="session-receipt-close"
          onClick={dismissSessionReceipt}
          aria-label="Dismiss receipt"
        >
          <IconClose />
        </button>
      </div>
      {receipt.sessions > 1 ? (
        <div class="session-receipt-who">{receipt.labels.join(', ')}</div>
      ) : (
        // AgentContext.dc.html: "This session · 14:02–14:20 · saved as a snapshot".
        <div class="session-receipt-who" data-testid="session-receipt-span">
          {[
            `This session · ${startedLabel ? `${startedLabel}–` : ''}${endedLabel}`,
            receipt.snapshot ? 'saved as a snapshot' : '',
            endedBy,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      )}
      <div class="session-receipt-tiles">
        <div class="session-receipt-tile">
          <span class="session-receipt-tile-label">Items</span>
          <span class="session-receipt-tile-value">{receipt.counts.items}</span>
        </div>
        <div class="session-receipt-tile">
          <span class="session-receipt-tile-label">Done</span>
          <span class="session-receipt-tile-value tone-ok">{receipt.counts.done}</span>
        </div>
        {/* Three different outcomes, shown only when present — a cancelled
            duplicate is not a rejection, and neither is an unanswered gate. */}
        {receipt.counts.cancelled > 0 && (
          <div class="session-receipt-tile">
            <span class="session-receipt-tile-label">Cancelled</span>
            <span class="session-receipt-tile-value tone-muted">{receipt.counts.cancelled}</span>
          </div>
        )}
        {receipt.counts.rejected > 0 && (
          <div class="session-receipt-tile">
            <span class="session-receipt-tile-label">Rejected</span>
            <span class="session-receipt-tile-value tone-danger">{receipt.counts.rejected}</span>
          </div>
        )}
        {receipt.counts.held > 0 && (
          <div class="session-receipt-tile">
            <span class="session-receipt-tile-label">Held</span>
            <span class="session-receipt-tile-value tone-warn">{receipt.counts.held}</span>
          </div>
        )}
      </div>
      <ReceiptContext
        context={receipt.context}
        label={receipt.labels.join(', ')}
        snapshotId={receipt.sessions === 1 ? (receipt.snapshot?.id ?? null) : null}
      />
      <div class="session-receipt-note">
        {receipt.sessions > 1
          ? 'History has each session’s diff and the snapshot from before it.'
          : receipt.snapshot
            ? 'A snapshot of the board from before this session is saved — restore it to undo the session.'
            : receipt.context.created.length === 0 && receipt.context.edited.length === 0
              ? 'The board itself did not change — nothing to restore.'
              : 'The board was empty when the session started — nothing to restore.'}
      </div>
      {diff && (
        <div class="session-receipt-diff" data-testid="session-receipt-diff">
          This session: {diff.added} added · {diff.removed} removed · {diff.modified} modified
        </div>
      )}
      <div class="session-receipt-actions">
        {/* No snapshot → no diff will ever exist for this receipt; a forever-
            disabled button is noise (the note above says why). */}
        {receipt.snapshot && (
          <button
            type="button"
            class="session-receipt-primary"
            disabled={loadingDiff || (!onSnapshotBoard && !snapshotBoard)}
            onClick={() => (onSnapshotBoard ? void viewDiff() : snapshotBoard && void openBoard(snapshotBoard.id))}
          >
            {!onSnapshotBoard && snapshotBoard
              ? `Open ${snapshotBoard.name} to compare`
              : loadingDiff
                ? 'Comparing…'
                : 'View diff'}
          </button>
        )}
        <BarHint label="Open the History drawer" body="Saved boards and past sessions." side="up" align="end">
          <button type="button" class="session-receipt-secondary" onClick={onOpenSnapshots}>
            History
          </button>
        </BarHint>
      </div>
    </div>
  );
}
