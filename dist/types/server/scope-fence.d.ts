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
 * One core check (`checkFenceTarget`) serves two describers: the operation
 * registry (`checkScopeFence`, every HTTP/MCP/CLI write) and the sync SDK,
 * whose methods bypass the registry and describe their own targets.
 *
 * Safe default: a mutating op this module does not know how to scope is
 * refused while a fence is set, rather than silently allowed. Likewise a
 * write this module cannot resolve (an edge given by search, a missing id)
 * is refused — fail closed, never a bypass.
 *
 * Trust note: the workbench marker is a self-reported header. Under the
 * local single-workspace model that is by design (any local process may
 * write; the safety model is human veto plus this fence), so the fence holds
 * cooperating agents to the region the human granted — it is not an
 * authentication boundary.
 */
import { type FenceRect } from '../shared/scope-fence.js';
import type { Operation } from './operations/types.js';
/** Bounding box of the fenced nodes plus padding; null when none of them exist. */
export declare function scopeFenceRect(fence: {
    nodeIds: string[];
    padding: number;
}): FenceRect | null;
/** What a write touches, in fence terms. */
export interface FenceTarget {
    /** Existing nodes the write targets — every one must be fenced. */
    nodeIds?: string[];
    /** World points a write introduces (a new node, annotation points) — all must be inside the box. */
    points?: Array<{
        x: number;
        y: number;
    }>;
    /** A new node with no position: refused (it cannot be placed inside the fence). */
    unplacedCreate?: boolean;
    /** Rewrites the whole board — never allowed under a fence. */
    boardWide?: boolean;
    /** The op is not fence-aware — refused while a fence is set. */
    unknown?: string;
}
/** Returns a human-readable refusal, or null when the target is inside the fence. */
export declare function checkFenceTarget(target: FenceTarget, opName: string): string | null;
/** Describe what a registry op would write, in fence terms. */
export declare function describeOpTarget(op: Operation, rawInput: unknown): FenceTarget;
/** Registry entry point: refusal text or null. Only call for mutating, agent-originated ops. */
export declare function checkScopeFence(op: Operation, rawInput: unknown): string | null;
/**
 * The fence belongs to the human: an agent must not clear, widen, or replace
 * it through `ax.policy.set`. Returns a refusal when a non-workbench caller
 * touches `scope` while a fence is set (or tries to set one at all).
 */
export declare function checkScopeOwnership(rawInput: unknown): string | null;
