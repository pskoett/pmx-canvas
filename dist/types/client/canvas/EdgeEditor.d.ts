import type { CanvasEdge } from '../types';
export declare const edgeEditorAnchor: import("@preact/signals-core").Signal<{
    id: string;
    incarnation: number;
    point: {
        x: number;
        y: number;
    };
} | null>;
/** Like EdgeHint, the editor lives in App's screen layer, outside the transformed world. */
export declare function SelectedEdgeEditor(): import("preact/jsx-runtime").JSX.Element | null;
/** Screen-sized controls anchored to the selected relation, not scaled with its SVG. */
export declare function EdgeEditor({ edge, point }: {
    edge: CanvasEdge;
    point: {
        x: number;
        y: number;
    };
}): import("preact/jsx-runtime").JSX.Element;
