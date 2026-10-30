import type { RefObject } from 'preact';
import type { CanvasNodeState } from '../types';
export declare function canCopyPrimitiveJson(node: CanvasNodeState): boolean;
export declare function usePrimitiveJson(node: CanvasNodeState, token: string, frame: RefObject<HTMLIFrameElement>, expanded: boolean): void;
export declare function copyPrimitiveJson(nodeId: string): Promise<void>;
