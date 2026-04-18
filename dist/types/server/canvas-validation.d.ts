import type { CanvasLayout } from './canvas-state.js';
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
    summary: {
        nodes: number;
        edges: number;
        collisions: number;
        containments: number;
        containmentViolations: number;
        missingEdgeEndpoints: number;
    };
}
export declare function validateCanvasLayout(layout: CanvasLayout): CanvasValidationResult;
