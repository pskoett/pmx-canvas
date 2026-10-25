import type { CanvasNodeState } from '../types';
type DisplayMode = 'inline' | 'fullscreen' | 'pip';
export declare function resolveExtAppDisplayModeRequest(requestedMode: DisplayMode, isExpanded: boolean): {
    nextMode: DisplayMode;
    shouldExpand: boolean;
    shouldCollapse: boolean;
};
export declare function buildExtAppAxBridgeScript(axToken: string, nodeId: string): string;
export declare function buildExtAppSurfaceBaseStyles(): string;
export declare function injectExtAppAxBridgeScript(html: string, script: string): string;
export declare function resolveExtAppContainerDimensions(target: {
    clientWidth?: number;
    clientHeight?: number;
    getBoundingClientRect(): Pick<DOMRectReadOnly, 'width' | 'height'>;
} | null | undefined, fallback: {
    width: number;
    height: number;
}): {
    width: number;
    height: number;
};
export declare function shouldApplyExtAppSizeChange(height: unknown, isExpanded: boolean): height is number;
export declare function ExtAppFrame({ node, expanded }: {
    node: CanvasNodeState;
    expanded?: boolean;
}): import("preact/jsx-runtime").JSX.Element;
export {};
