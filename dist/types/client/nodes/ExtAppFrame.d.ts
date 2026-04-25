import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import type { CanvasNodeState } from '../types';
type IframeLoadTarget = Pick<HTMLIFrameElement, 'addEventListener' | 'removeEventListener' | 'contentDocument'>;
type ExtAppBridgeNotifications = Pick<AppBridge, 'sendToolInput' | 'sendToolResult'>;
type DisplayMode = 'inline' | 'fullscreen' | 'pip';
interface ExtAppHostDimensionsTarget {
    getBoundingClientRect(): Pick<DOMRectReadOnly, 'width' | 'height'>;
}
export declare function waitForExtAppFrameLoad(target: IframeLoadTarget): Promise<void>;
export declare function getExtAppBridgeInitKey(node: CanvasNodeState, retryKey: number): string;
export declare function resolveExtAppDisplayModeRequest(requestedMode: DisplayMode, isExpanded: boolean): {
    nextMode: DisplayMode;
    shouldExpand: boolean;
    shouldCollapse: boolean;
};
export declare function sendExtAppBootstrapState(bridge: ExtAppBridgeNotifications, toolInput: Record<string, unknown>, toolResult: CallToolResult | undefined): Promise<void>;
export declare function resolveExtAppSandbox(value: unknown): string;
export declare function resolveExtAppContainerDimensions(target: ExtAppHostDimensionsTarget | null | undefined, fallback: {
    width: number;
    height: number;
}): {
    width: number;
    height: number;
};
export declare function shouldApplyExtAppSizeChange(height: unknown, isExpanded: boolean): height is number;
export declare function ExtAppFrame({ node }: {
    node: CanvasNodeState;
}): import("preact/jsx-runtime").JSX.Element;
export {};
