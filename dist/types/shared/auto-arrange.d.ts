export interface ArrangePosition {
    x: number;
    y: number;
}
export interface ArrangeSize {
    width: number;
    height: number;
}
export interface ArrangeNode {
    id: string;
    type: string;
    position: ArrangePosition;
    size: ArrangeSize;
    pinned: boolean;
    dockPosition: 'left' | 'right' | null;
    data: Record<string, unknown>;
}
export interface ArrangeEdge {
    id: string;
    from: string;
    to: string;
}
export interface AutoArrangeResult {
    nodePositions: Map<string, ArrangePosition>;
    groupBounds: Map<string, ArrangePosition & ArrangeSize>;
}
type ArrangeMode = 'grid' | 'graph';
export declare function computeAutoArrange(allNodes: ArrangeNode[], allEdges: ArrangeEdge[], mode: ArrangeMode): AutoArrangeResult;
export {};
