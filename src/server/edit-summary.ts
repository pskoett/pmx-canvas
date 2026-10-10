import type { CanvasNodeState } from './canvas-state.js';

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
/** "See change" shows this much of each side, centred on the first difference. */
export const CHANGE_EXCERPT = 1200;

export function cardText(node: CanvasNodeState): string {
  const { content, text } = node.data;
  return typeof content === 'string' ? content : typeof text === 'string' ? text : '';
}

function cardTitle(node: CanvasNodeState): string {
  return typeof node.data.title === 'string' ? node.data.title : '';
}

const paragraphs = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim().replace(/\s+/g, ' '))
    .filter(Boolean);

/**
 * What an agent's edit did to a card, in a few words, from the card before
 * the session and now (AgentContext.dc.html: "rewrote the second paragraph").
 * Paragraphs are aligned on their shared start and end, so a paragraph added
 * at the top reads as added, not as everything rewritten.
 */
export function describeEdit(before: CanvasNodeState, after: CanvasNodeState): string {
  const parts: string[] = [];
  if (cardTitle(before) !== cardTitle(after)) parts.push(`renamed it “${cardTitle(after)}”`);
  const was = cardText(before);
  const now = cardText(after);
  if (was !== now) {
    const a = paragraphs(was);
    const b = paragraphs(now);
    let head = 0;
    while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
    let tail = 0;
    while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail])
      tail += 1;
    const removed = a.length - head - tail;
    const added = b.length - head - tail;
    const count = (n: number) => `${n} paragraph${n === 1 ? '' : 's'}`;
    if (removed === 0 && added === 0) parts.push('reformatted its text');
    else if (a.length === 0) parts.push('wrote its text');
    else if (b.length === 0) parts.push('cleared its text');
    else if (removed === 0) parts.push(`added ${count(added)}`);
    else if (added === 0) parts.push(`removed ${count(removed)}`);
    else if (removed === 1 && added === 1) parts.push(`rewrote the ${ORDINALS[head] ?? `#${head + 1}`} paragraph`);
    else if (Math.max(removed, added) > Math.max(a.length, b.length) / 2) parts.push('rewrote most of it');
    else parts.push(`changed ${count(Math.max(removed, added))} of ${Math.max(a.length, b.length)}`);
  }
  return parts.join(' and ') || 'changed its settings';
}

/**
 * Before and after for "See change": each side cut to CHANGE_EXCERPT around
 * the first character that differs, with "…" where text was cut, so a change
 * deep in a long card is what shows.
 */
export function changeExcerpts(was: string, now: string): { before: string; after: string } {
  let at = 0;
  while (at < was.length && at < now.length && was[at] === now[at]) at += 1;
  const from = Math.max(0, at - Math.floor(CHANGE_EXCERPT / 4));
  // Never cut between the two halves of a surrogate pair (an emoji).
  const low = (text: string, index: number) => /[\uDC00-\uDFFF]/.test(text[index] ?? '');
  const cut = (text: string) => {
    const start = low(text, from) ? from - 1 : from;
    let end = start + CHANGE_EXCERPT;
    if (low(text, end)) end -= 1;
    return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
  };
  return { before: cut(was), after: cut(now) };
}
