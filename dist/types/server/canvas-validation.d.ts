import type { CanvasLayout, CanvasNodeState } from './canvas-state.js';
/**
 * Per-type minimum node size (0.4.5 report follow-up): agents frequently
 * create nodes with explicit frames far too small for their content — clipped
 * markdown, charts squeezed behind inner scrollbars. Explicit sizes below the
 * floor are clamped UP at creation (canvas-operations.ts creators);
 * `strictSize: true` is the escape hatch for a genuinely small fixed frame.
 * Floors sit below every type default and above the point of unreadability.
 * Creation-only: later updates are untouched (the browser's drag-resize
 * enforces its own 200×100 floor client-side), but `validate` reports any
 * node below its floor as an advisory sizeWarning. Absent types (trace,
 * group, prompt/response) are intentionally unclamped — trace is small by
 * design, groups size to their children.
 */
export declare const NODE_MIN_CREATE_SIZES: Partial<Record<CanvasNodeState['type'], {
    width: number;
    height: number;
}>>;
export declare function clampCreateNodeSize(type: CanvasNodeState['type'], width: number, height: number, strictSize?: boolean): {
    width: number;
    height: number;
};
export interface CanvasValidationPair {
    aId: string;
    aTitle: string | null;
    bId: string;
    bTitle: string | null;
}
export interface CanvasContainmentIssue {
    groupId: string;
    groupTitle: string | null;
    childId: string;
    childTitle: string | null;
}
export interface CanvasSizeWarning {
    id: string;
    title: string | null;
    type: CanvasNodeState['type'];
    width: number;
    height: number;
    minWidth: number;
    minHeight: number;
}
export interface CanvasValidationResult {
    ok: boolean;
    collisions: CanvasValidationPair[];
    containments: CanvasContainmentIssue[];
    containmentViolations: CanvasContainmentIssue[];
    missingEdgeEndpoints: Array<{
        edgeId: string;
        from: string;
        to: string;
    }>;
    /** Nodes below their type's readable minimum (advisory — does not fail `ok`). */
    sizeWarnings: CanvasSizeWarning[];
    summary: {
        nodes: number;
        edges: number;
        collisions: number;
        containments: number;
        containmentViolations: number;
        missingEdgeEndpoints: number;
        sizeWarnings: number;
    };
}
export declare function validateCanvasLayout(layout: CanvasLayout): CanvasValidationResult;
