export interface CanvasNodeKindInput {
    type: string;
    data: Record<string, unknown>;
}
export declare function getCanvasNodeKind(node: CanvasNodeKindInput): string;
