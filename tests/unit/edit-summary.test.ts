import { describe, expect, test } from 'bun:test';
import { CHANGE_EXCERPT, changeExcerpts, describeEdit } from '../../src/server/edit-summary.ts';
import type { CanvasNodeState } from '../../src/server/canvas-state.ts';

// The receipt's per-edit line (docs/design/AgentContext.dc.html): what an
// agent's edit did, from the card before the session and now.

const card = (content: string, title = 'SMB is price-sensitive'): CanvasNodeState => ({
  id: 'n1',
  type: 'markdown',
  position: { x: 0, y: 0 },
  size: { width: 300, height: 200 },
  zIndex: 1,
  collapsed: false,
  pinned: false,
  data: { title, content },
});

const three = 'Eight of twelve churned on price.\n\nThey asked for a smaller plan.\n\nTwo moved to a rival.';

describe('describeEdit', () => {
  test('names one rewritten paragraph by its place', () => {
    const after = three.replace('They asked for a smaller plan.', 'Six would downgrade instead.');
    expect(describeEdit(card(three), card(after))).toBe('rewrote the second paragraph');
  });

  test('counts paragraphs added or removed at the end', () => {
    expect(describeEdit(card(three), card(`${three}\n\nOne more.\n\nAnd another.`))).toBe('added 2 paragraphs');
    expect(describeEdit(card(three), card('Eight of twelve churned on price.\n\nThey asked for a smaller plan.'))).toBe(
      'removed 1 paragraph',
    );
  });

  test('a rename and a rewrite read together; most of the text changed reads as such', () => {
    expect(describeEdit(card(three), card('All new.\n\nEntirely.\n\nTwo moved to a rival.', 'SMB churn'))).toBe(
      'renamed it “SMB churn” and rewrote most of it',
    );
  });

  test('empty before or after, and a change outside the text', () => {
    expect(describeEdit(card(''), card(three))).toBe('wrote its text');
    expect(describeEdit(card(three), card(''))).toBe('cleared its text');
    expect(describeEdit(card(three), card(three))).toBe('changed its settings');
  });

  test('a paragraph added at the top reads as added, and whitespace alone as reformatted', () => {
    expect(describeEdit(card(three), card(`A new opening.\n\n${three}`))).toBe('added 1 paragraph');
    expect(describeEdit(card(three), card(three.replace('churned on', 'churned  on')))).toBe('reformatted its text');
  });
});

describe('changeExcerpts', () => {
  test('a change deep in a long card is what both sides show, with … where text was cut', () => {
    const long = `${'x'.repeat(5000)}OLD${'y'.repeat(5000)}`;
    const { before, after } = changeExcerpts(long, long.replace('OLD', 'NEW'));
    expect(before).toContain('OLD');
    expect(after).toContain('NEW');
    expect(before.startsWith('…') && before.endsWith('…')).toBe(true);
    expect(before.length).toBe(CHANGE_EXCERPT + 2);
  });

  test('an excerpt never splits an emoji', () => {
    const text = `${'x'.repeat(4700)}😀${'x'.repeat(299)}OLD`;
    const { before } = changeExcerpts(text, text.replace('OLD', 'NEW'));
    expect(before.includes('\uFFFD')).toBe(false);
    expect(/^…?[\uDC00-\uDFFF]/.test(before)).toBe(false);
  });

  test('short text is shown whole', () => {
    expect(changeExcerpts('One.', 'Two.')).toEqual({ before: 'One.', after: 'Two.' });
  });
});
