import type { CanvasNodeState } from '../types';
export declare function shouldShowPresentationControls(node: CanvasNodeState): boolean;
export declare function HtmlNode({ node, expanded, presentation, presentationExitToken, autoFocus, }: {
    node: CanvasNodeState;
    expanded?: boolean;
    presentation?: boolean;
    presentationExitToken?: string;
    autoFocus?: boolean;
}): import("preact/src").JSX.Element;
