import type { CanvasNodeState } from '../types';
export declare const AUTO_FIT_MAX_HEIGHT = 600;
export declare const AUTO_FIT_TITLEBAR_HEIGHT = 37;
export declare function shouldAutoFitNode(node: CanvasNodeState): boolean;
export declare function computeAutoFitHeight(node: CanvasNodeState, contentHeight: number): number | null;
