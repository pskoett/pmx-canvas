import { signal } from '@preact/signals';
import { DEFAULT_CONTEXT_BRIEF_BUDGET } from '../../shared/context-brief-budget.js';
import { boardList } from './boards-store';
import { requestJson } from './intent-bridge';

/**
 * The context chip (docs/design/ContextChip.dc.html): how big the agent's brief
 * is against its budget, whether it was clipped, and when each pinned board was
 * last read. The workbench's own brief fetch carries the workbench marker, so it
 * is never booked as an agent read.
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

/** Debounced: pins, reads and board changes arrive in bursts. */
export function refreshContextChip(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void load();
  }, 250);
}

async function load(): Promise<void> {
  const brief = await requestJson<{
    delivery?: { truncated?: boolean };
    entries?: unknown[];
  } | null>('fetchBriefSize', '/api/canvas/context', null);
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
  pinnedBoardReads.value = reads;
}
