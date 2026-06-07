import type { CanvasNodeState } from '../types';
/**
 * Submit a native-node AX interaction (plan-004 Phase 2) and surface the outcome
 * as a transient toast. Inline node controls call this; the server enforces the
 * node's capabilities, so a denied interaction simply shows an error toast.
 */
export declare function runNodeAxInteraction(node: CanvasNodeState, type: string, payload: Record<string, unknown> | undefined, successTitle: string): Promise<void>;
/** Shared style for the small inline AX action button on native nodes. */
export declare const axNodeActionButtonStyle: {
    readonly padding: "3px 8px";
    readonly fontSize: "10px";
    readonly background: "var(--c-accent-12)";
    readonly border: "1px solid var(--c-accent-25)";
    readonly borderRadius: "4px";
    readonly color: "var(--c-text-soft)";
    readonly cursor: "pointer";
    readonly flexShrink: 0;
};
