import { signal } from '@preact/signals';
import { DEFAULT_CONTEXT_BRIEF_BUDGET } from '../../shared/context-brief-budget.js';
import { activeBoardId, boardList } from './boards-store';
import { requestJson } from './intent-bridge';

/**
 * The context chip (docs/design/ContextChip.dc.html): how big the agent's brief
 * is against its budget, whether it was clipped, and when each pinned board was
 * last read. The brief fetch is a measurement, not a delivery: it says so with
 * `x-pmx-proxied-read`, so it is never booked as an agent read — not even from
 * an `?agent=` tab, whose requests carry no workbench marker. Otherwise the
 * recorded read would announce itself and refetch the chip in a loop.
 */

export interface BriefSize {
  chars: number;
  budget: number;
  clipped: boolean;
}

export interface BoardRead {
  lastReadAt: string;
  lastReadBy: string;
}

export const briefSize = signal<BriefSize | null>(null);
export const pinnedBoardReads = signal<Map<string, BoardRead | null>>(new Map());

/** ≈ tokens for a character count; the brief budget is UTF-16 characters. */
export function approxTokens(chars: number): string {
  const tokens = chars / 4;
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${Math.round(tokens)}`;
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
  const brief = await requestJson<{
    delivery?: { truncated?: boolean };
    entries?: unknown[];
  } | null>('fetchBriefSize', '/api/canvas/context', null, { headers: { 'x-pmx-proxied-read': '1' } });
  if (!current()) return;
  if (brief?.entries) {
    briefSize.value = {
      chars: JSON.stringify(brief).length,
      budget: DEFAULT_CONTEXT_BRIEF_BUDGET,
      clipped: !!brief.delivery?.truncated,
    };
  }
  const pinned = boardList.value.filter((board) => board.pin);
  const reads = new Map<string, BoardRead | null>();
  await Promise.all(
    pinned.map(async (board) => {
      const status = await requestJson<{ board?: BoardRead | null } | null>(
        'fetchBoardReadStatus',
        `/api/canvas/ax/context-status?board=${encodeURIComponent(board.id)}`,
        null,
      );
      reads.set(board.id, status?.board ?? null);
    }),
  );
  if (current()) pinnedBoardReads.value = reads;
}
