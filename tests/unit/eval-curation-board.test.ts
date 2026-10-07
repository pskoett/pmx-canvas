import { describe, expect, test } from 'bun:test';
import { compileContextBrief, type ContextBriefInput } from '../../src/server/context-brief.ts';
import type { CanvasNodeState } from '../../src/server/canvas-state.ts';
import { DEFAULT_CONTEXT_BRIEF_BUDGET, MAX_CONTEXT_BRIEF_BUDGET } from '../../src/server/operations/ops/query.ts';
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

  test('at the default budget, pins decide which key facts arrive in full', () => {
    const curated = firstRead(PINNED_KEYS, DEFAULT_CONTEXT_BRIEF_BUDGET);
    const uncurated = firstRead([], DEFAULT_CONTEXT_BRIEF_BUDGET);
    for (const key of PINNED_KEYS) expect(curated.get(key)).toBe('pinned');
    // Without pins the oldest cards fill the brief: the superseded decision arrives, the
    // current decision and the finance ceiling do not.
    expect(uncurated.has(KEY_CARDS.superseded)).toBe(true);
    expect(uncurated.has(KEY_CARDS.current)).toBe(false);
    expect(uncurated.has(KEY_CARDS.constraint)).toBe(false);
  });

  test('at full budget both conditions deliver every card; only the pinned marking differs', () => {
    const curated = firstRead(PINNED_KEYS, MAX_CONTEXT_BRIEF_BUDGET);
    const uncurated = firstRead([], MAX_CONTEXT_BRIEF_BUDGET);
    for (const card of CARDS) {
      expect(curated.has(card.key)).toBe(true);
      expect(uncurated.has(card.key)).toBe(true);
    }
    expect(PINNED_KEYS.every((key) => curated.get(key) === 'pinned')).toBe(true);
    expect([...uncurated.values()].includes('pinned')).toBe(false);
  });
});
