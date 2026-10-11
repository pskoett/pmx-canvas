import { type MemoryTarget } from '../shared/memory-graph.js';
import type { LifecycleQualification } from '../shared/lifecycle-status.js';
/** A read-only qualification, shared by briefs, search, Home and card review. No clock is renewed. */
export declare function lifecycleQualifications(now?: number, atUse?: MemoryTarget[]): Record<string, LifecycleQualification>;
