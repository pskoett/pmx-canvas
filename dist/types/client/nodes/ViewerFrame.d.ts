import type { JSX, RefObject } from 'preact';
export declare const VIEWER_LOAD_DEADLINE_MS = 10000;
export type ViewerSource = {
    src?: string;
    srcdoc?: string;
    error?: boolean;
    retry?: () => void;
};
type LoadDocument = (frame: HTMLIFrameElement, signal: AbortSignal) => Promise<boolean | 'cancelled' | undefined> | undefined;
type MountFrame = (frame: HTMLIFrameElement, fail: () => void) => () => void;
/** The document acknowledges mounting before its frame-gated paint signal. */
export declare function waitForViewerPaint(frame: HTMLIFrameElement, token: string, signal: AbortSignal): Promise<boolean>;
/** Preserve the painted document until its replacement restores and paints. */
export declare function RefreshingViewerFrame({ source, identity, iframeRef, onLoad, onMount, onOpen, onDocumentLoad, title, className, sandbox, allow, tabIndex, referrerPolicy, }: {
    source: ViewerSource;
    identity?: string;
    iframeRef: RefObject<HTMLIFrameElement>;
    onLoad?: () => void;
    onMount?: MountFrame;
    onOpen?: () => void;
    onDocumentLoad?: LoadDocument;
    title: string;
    className?: string;
    sandbox?: string;
    allow?: string;
    tabIndex?: number;
    referrerPolicy?: JSX.IntrinsicElements['iframe']['referrerPolicy'];
}): JSX.Element;
export {};
