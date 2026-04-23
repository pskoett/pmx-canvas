import type { CanvasNodeState } from '../types';
export interface ImageNodeWarning {
    title: string;
    detail: string;
}
export declare function getImageNodeWarnings(node: CanvasNodeState): ImageNodeWarning[];
