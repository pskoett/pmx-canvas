import type { CanvasNodeState } from './canvas-state.js';
/** "See change" shows this much of each side, centred on the first difference. */
export declare const CHANGE_EXCERPT = 1200;
export declare function cardText(node: CanvasNodeState): string;
/**
 * What an agent's edit did to a card, in a few words, from the card before
 * the session and now (AgentContext.dc.html: "rewrote the second paragraph").
 * Paragraphs are aligned on their shared start and end, so a paragraph added
 * at the top reads as added, not as everything rewritten.
 */
export declare function describeEdit(before: CanvasNodeState, after: CanvasNodeState): string;
/**
 * Before and after for "See change": each side cut to CHANGE_EXCERPT around
 * the first character that differs, with "…" where text was cut, so a change
 * deep in a long card is what shows.
 */
export declare function changeExcerpts(was: string, now: string): {
    before: string;
    after: string;
};
