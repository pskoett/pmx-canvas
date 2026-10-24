import { type MemoryTarget } from '../shared/memory-graph.js';
import type { LifecycleQualification } from '../shared/lifecycle-status.js';
import type { ReviewCardSummary } from './knowledge-lifecycle.js';
/** A read-only qualification, shared by briefs, search, Home and card review. No clock is renewed. */
export declare function lifecycleQualifications(now?: number, atUse?: MemoryTarget[]): Record<string, LifecycleQualification>;
/** A card being inspected is in use, including its transitive sources and portal contents. */
export declare function lifecycleQualification(target: MemoryTarget, now?: number): LifecycleQualification | undefined;
/** Compact queue metadata and qualifications come from the same authoritative read. */
export declare function lifecycleSnapshot(now?: number, atUse?: MemoryTarget[], only?: MemoryTarget): {
    cards: Record<string, LifecycleQualification>;
    reviewCards: ReviewCardSummary[];
};
