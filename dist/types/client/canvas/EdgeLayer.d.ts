import { type Signal } from '@preact/signals';
import type { CanvasEdge, CanvasNodeState } from '../types';
/** The link pill's hint, outside the zoomed canvas so it keeps screen size and is never clipped. */
export declare function EdgeHint(): import("preact/src").JSX.Element | null;
/**
 * Edges are drawn in world space, so a 1.5px stroke renders as 0.4 screen px at
 * 26% zoom. Full inverse compensation keeps edge chrome at a constant SCREEN
 * size while zoomed out (standard graph-editor behaviour). Deliberately
 * uncapped — the 2.2 cap used for node chrome still leaves hairlines invisible
 * at overview zoom.
 */
export declare function edgeChromeScale(scale: number): number;
/**
 * Lines draw below group frames, so a link never covers a group's header; pills
 * draw in their own layer above the frames, so a link inside a group keeps a
 * hoverable, clickable label (LinkAuthorship.dc.html).
 */
export type EdgeLayerPart = 'lines' | 'pills';
interface EdgeLayerProps {
    nodes: Signal<Map<string, CanvasNodeState>>;
    edges: Signal<Map<string, CanvasEdge>>;
    onEdgeContextMenu?: (e: MouseEvent, edgeId: string) => void;
    part: EdgeLayerPart;
}
export declare function EdgeLayer({ nodes, edges, onEdgeContextMenu, part }: EdgeLayerProps): import("preact/src").JSX.Element | null;
export {};
