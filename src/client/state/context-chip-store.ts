import { signal } from '@preact/signals';
import { activeBoardId, boardList } from './boards-store';
import { requestJson } from './intent-bridge';

/**
 * The context chip (docs/design/ContextChip.dc.html): what the agent's brief
 * costs in tokens, and when each pinned board was last read. The brief fetch is a measurement, not a delivery: it says so with
 * `x-pmx-proxied-read`, so it is never booked as an agent read — not even from
 * an `?agent=` tab, whose requests carry no workbench marker. Otherwise the
 * recorded read would announce itself and refetch the chip in a loop.
 */

export interface BriefSize {
  chars: number;
}

export interface BoardRead {
  lastReadAt: string;
  lastReadBy: string;
}

export const briefSize = signal<BriefSize | null>(null);
export const pinnedBoardReads = signal<Map<string, BoardRead | null>>(new Map());

/** A token count for display: 873, 1.1k. */
export function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${Math.round(tokens)}`;
}

/** ≈ tokens for a character count (about four characters per token). */
export function approxTokens(chars: number): string {
  return formatTokens(chars / 4);
}

let timer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;

/** Debounced: pins, reads and board changes arrive in bursts; content edits wait longer. */
export function refreshContextChip(delayMs = 250): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void load();
  }, delayMs);
}

async function load(): Promise<void> {
  const request = ++generation;
  const boardId = activeBoardId.value;
  // A late answer for a board you have since left, or an older request, must not paint the chip.
  const current = () => request === generation && boardId === activeBoardId.value;
  const brief = await requestJson<{ entries?: unknown[] } | null>('fetchBriefSize', '/api/canvas/context', null, {
    headers: { 'x-pmx-proxied-read': '1' },
  });
  if (!current()) return;
  if (brief?.entries) briefSize.value = { chars: JSON.stringify(brief).length };
  const pinned = boardList.value.filter((board) => board.pin);
  if (pinned.length === 0) {
    if (current()) pinnedBoardReads.value = new Map();
    return;
  }
  // One request for every pinned board's latest read.
  const status = await requestJson<{ boards?: Record<string, BoardRead | null> } | null>(
    'fetchBoardReadStatus',
    `/api/canvas/ax/context-status?boards=${pinned.map((board) => encodeURIComponent(board.id)).join(',')}`,
    null,
  );
  if (current())
    pinnedBoardReads.value = new Map(pinned.map((board) => [board.id, status?.boards?.[board.id] ?? null]));
}
