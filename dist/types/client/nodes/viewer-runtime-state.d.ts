import type { CanvasNodeState } from '../types';
export declare function restoreViewerRuntimeState(authored: CanvasNodeState, token: string, source: Window, signal?: AbortSignal): Promise<boolean | 'cancelled'>;
