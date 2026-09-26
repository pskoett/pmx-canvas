import type { RefObject } from 'preact';
import type { CanvasNodeState } from '../types';
export declare function isSameOriginFrameDocumentUrl(url: string, origin?: string): boolean;
type ViewerFrameSource = {
    src?: string;
    srcdoc?: string;
};
/**
 * Keep the last painted viewer in front while its replacement navigates. Viewer
 * specs are immutable documents, so updates normally change `?v=` and reload the
 * iframe; putting the new document in a hidden sibling avoids exposing Chromium's
 * white navigation paint. Two animation frames after load gives the new document
 * a composited paint before the old one is removed.
 */
export declare function RefreshingViewerFrame({ source, iframeRef, onLoad, title, className, sandbox, allow, tabIndex, }: {
    source: ViewerFrameSource;
    iframeRef: RefObject<HTMLIFrameElement>;
    onLoad: () => void;
    title: string;
    className?: string;
    sandbox?: string;
    allow?: string;
    tabIndex?: number;
}): import("preact").JSX.Element;
export declare function McpAppNode({ node, expanded }: {
    node: CanvasNodeState;
    expanded?: boolean;
}): import("preact").JSX.Element;
export {};
