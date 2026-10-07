import { describe, expect, test } from 'bun:test';
import { compileContextBrief, type ContextBriefInput } from '../../src/server/context-brief.ts';
import type { CanvasNodeState } from '../../src/server/canvas-state.ts';
import { DEFAULT_CONTEXT_BRIEF_BUDGET } from '../../src/server/operations/ops/query.ts';
import { CARD_SIZE, CARDS, KEY_CARDS, PINNED_KEYS, cardPosition } from '../../scripts/eval-curation/board.ts';

// The curation-effect eval (docs/evals/curation-effect.md) is only informative if,
// at the default budget, pins change which key cards reach the agent. These checks
// guard the fixed board against edits that would make both conditions identical.

const nodes: CanvasNodeState[] = CARDS.map((card, index) => ({
  id: card.key,
  type: 'markdown',
  position: cardPosition(index),
  size: CARD_SIZE,
  zIndex: index,
  collapsed: false,
  pinned: false,
  data: { title: card.title, content: card.content },
  contentRevision: index + 1,
}));

function firstRead(pinnedNodeIds: string[], budget: number): Map<string, string> {
  const input: ContextBriefInput = {
    activeBoard: { boardId: 'eval', name: 'eval', category: null },
    nodes,
    pinnedNodeIds,
    contentRevision: nodes.length,
    retentionFloor: 0,
    tombstones: [],
    since: null,
    libraryBoards: [],
    budget,
  };
  const { document } = compileContextBrief(input);
  if (!document) throw new Error('The brief did not fit its own budget.');
  return new Map(document.entries.filter((entry) => !entry.truncated).map((entry) => [entry.nodeId, entry.reason]));
}

describe('curation eval board', () => {
  test('cards are listed oldest first and every pinned key exists', () => {
    const keys = CARDS.map((card) => card.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of [...PINNED_KEYS, ...Object.values(KEY_CARDS)]) expect(keys).toContain(key);
    expect(keys.indexOf(KEY_CARDS.superseded)).toBeLessThan(keys.indexOf(KEY_CARDS.current));
  });

  test('both briefs carry the whole board as a map; curation marks and orders what matters', () => {
    const curated = firstRead(PINNED_KEYS, DEFAULT_CONTEXT_BRIEF_BUDGET);
    const uncurated = firstRead([], DEFAULT_CONTEXT_BRIEF_BUDGET);
    // Every card arrives as a summary in both; the agent pulls what it wants in full.
    for (const card of CARDS) {
      expect(curated.has(card.key)).toBe(true);
      expect(uncurated.has(card.key)).toBe(true);
    }
    // Curated: the four pins lead, marked pinned. Uncurated: oldest first, so the
    // superseded decision comes before the current one and nothing is marked.
    expect([...curated.keys()].slice(0, PINNED_KEYS.length).sort()).toEqual([...PINNED_KEYS].sort());
    expect(PINNED_KEYS.every((key) => curated.get(key) === 'pinned')).toBe(true);
    expect([...uncurated.values()].includes('pinned')).toBe(false);
    const order = [...uncurated.keys()];
    expect(order.indexOf(KEY_CARDS.superseded)).toBeLessThan(order.indexOf(KEY_CARDS.current));
  });
});
