import { type MemoryTarget } from '../shared/memory-graph.js';
import type { LifecycleQualification } from '../shared/lifecycle-status.js';
import type { ReviewCardSummary } from './knowledge-lifecycle.js';
/** A read-only qualification, shared by briefs, search, Home and card review. No clock is renewed. */
export declare function lifecycleQualifications(now?: number, atUse?: MemoryTarget[]): Record<string, LifecycleQualification>;
/** Compact queue metadata and qualifications come from the same authoritative read. */
export declare function lifecycleSnapshot(now?: number, atUse?: MemoryTarget[]): {
    cards: Record<string, LifecycleQualification>;
    reviewCards: ReviewCardSummary[];
};
