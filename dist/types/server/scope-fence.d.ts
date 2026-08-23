/**
 * Scope fence enforcement (rail-chrome-v2 phase 4, design item 4).
 *
 * When the AX policy carries a scope fence, an attached agent may only WRITE
 * inside it: existing-node writes must target fenced nodes, new nodes must
 * land inside the fence's bounding box (fenced nodes + padding), and
 * board-wide writes (arrange, clear, restore) are refused. Reads are never
 * fenced, and neither are the human's own workbench writes — the fence is the
 * human's tool, not a cage for the human.
 *
 * Safe default: a mutating op this module does not know how to scope is
 * refused while a fence is set, rather than silently allowed.
 */
import { type FenceRect } from '../shared/scope-fence.js';
import type { Operation } from './operations/types.js';
/** Bounding box of the fenced nodes plus padding; null when none of them exist. */
export declare function scopeFenceRect(fence: {
    nodeIds: string[];
    padding: number;
}): FenceRect | null;
/**
 * Returns a human-readable refusal, or null when the write is inside the
 * fence. Only call for mutating, agent-originated ops.
 */
export declare function checkScopeFence(op: Operation, rawInput: unknown): string | null;
