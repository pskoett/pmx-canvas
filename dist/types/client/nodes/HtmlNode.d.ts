import type { CanvasNodeState } from '../types';
export declare function createHtmlNodeSrcDocForTest(userHtml: string, options: {
    theme: string;
    themeCss: string;
    themeToken?: string;
    presentation?: boolean;
    presentationExitToken?: string;
}): string;
export declare function shouldShowPresentationControls(node: CanvasNodeState): boolean;
export declare function HtmlNode({ node, expanded, presentation, presentationExitToken, autoFocus, }: {
    node: CanvasNodeState;
    expanded?: boolean;
    presentation?: boolean;
    presentationExitToken?: string;
    autoFocus?: boolean;
}): import("preact/src").JSX.Element;
