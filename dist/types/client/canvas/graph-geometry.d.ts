import type { Point } from './memory-layout';
/** Painted bounds, collision clearance, ports and Fit share this footprint. */
export declare const GRAPH_NODE: {
    width: number;
    height: number;
    gap: number;
};
interface Rect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}
export interface GraphRoute {
    path: string;
    points: Point[];
    label?: Point & Rect;
}
interface Link {
    id: string;
    from: string;
    to: string;
    label: string;
}
/** Obstacle visibility is shared across routes and independent of zoom/hover. */
export declare function graphRoutes(positions: Map<string, Point>, links: Link[]): Map<string, GraphRoute>;
export {};
