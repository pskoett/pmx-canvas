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
export interface CanvasHiddenEdgeEndpoint {
    edgeId: string;
    nodeId: string;
    nodeTitle: string | null;
    dockPosition: 'left' | 'right';
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
    /**
     * Edges whose endpoint node is DOCKED — it renders in the HUD column, not on
     * the canvas, so the edge visually terminates in empty space even though both
     * endpoint IDs resolve (0.4.6 orb feedback #1). Advisory: reported for
     * diagnosis, but does NOT fail `ok` (see the note at the return site).
     */
    hiddenEdgeEndpoints: CanvasHiddenEdgeEndpoint[];
    /** Nodes below their type's readable minimum (advisory — does not fail `ok`). */
    sizeWarnings: CanvasSizeWarning[];
    summary: {
        nodes: number;
        edges: number;
        collisions: number;
        containments: number;
        containmentViolations: number;
        missingEdgeEndpoints: number;
        hiddenEdgeEndpoints: number;
        sizeWarnings: number;
    };
}
export declare function validateCanvasLayout(layout: CanvasLayout): CanvasValidationResult;
