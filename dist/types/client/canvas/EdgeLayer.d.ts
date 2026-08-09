import type { Signal } from '@preact/signals';
import type { CanvasEdge, CanvasNodeState } from '../types';
/**
 * Edges are drawn in world space, so a 1.5px stroke renders as 0.4 screen px at
 * 26% zoom. Full inverse compensation keeps edge chrome at a constant SCREEN
 * size while zoomed out (standard graph-editor behaviour). Deliberately
 * uncapped — the 2.2 cap used for node chrome still leaves hairlines invisible
 * at overview zoom.
 */
export declare function edgeChromeScale(scale: number): number;
interface EdgeLayerProps {
    nodes: Signal<Map<string, CanvasNodeState>>;
    edges: Signal<Map<string, CanvasEdge>>;
}
export declare function EdgeLayer({ nodes, edges }: EdgeLayerProps): import("preact/src").JSX.Element | null;
export {};
