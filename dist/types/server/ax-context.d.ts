import { type PmxAxContext, type PmxAxPinnedContext, type PmxAxWorkItem, type PmxAxApprovalGate, type PmxAxReviewAnnotation, type PmxAxElicitation, type PmxAxModeRequest, type PmxAxPolicy } from './ax-state.js';
/**
 * Compact, surface-safe view of the canvas-bound AX state, injected into (and
 * pushed to) AX-enabled surfaces so authored boards can RENDER the work queue /
 * focus, not just emit interactions. Deliberately excludes the timeline, pinned
 * preamble, and serialized node bodies to keep the payload small.
 */
export interface PmxAxSurfaceSnapshot {
    focus: string[];
    workItems: PmxAxWorkItem[];
    approvalGates: PmxAxApprovalGate[];
    reviewAnnotations: Array<Omit<PmxAxReviewAnnotation, 'body' | 'author'>>;
    elicitations: PmxAxElicitation[];
    modeRequests: PmxAxModeRequest[];
    policy: PmxAxPolicy;
}
/**
 * NOTE: this is whole-canvas AX state (every work item, etc.), exposed to ANY
 * AX-enabled surface — reads are board-wide while emits are node-scoped. Acceptable
 * under the single-workspace local-trust model, but author surfaces accordingly
 * (don't embed untrusted third-party scripts in an AX-enabled surface). Sensitive
 * human review text is redacted below.
 */
export declare function buildCanvasAxSurfaceSnapshot(): PmxAxSurfaceSnapshot;
export declare function buildCanvasAxPinnedContext(): PmxAxPinnedContext;
export declare function buildCanvasAxContext(consumer?: string): PmxAxContext;
