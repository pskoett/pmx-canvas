import type { CanvasLayout, CanvasNodeState } from './canvas-state.js';
export { NODE_MIN_SIZES, clampCreateNodeSize, nodeMinSize } from '../shared/node-sizes.js';
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
