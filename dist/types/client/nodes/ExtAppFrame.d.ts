import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import type { CanvasNodeState } from '../types';
type IframeLoadTarget = Pick<HTMLIFrameElement, 'addEventListener' | 'removeEventListener' | 'contentDocument'>;
type ExtAppBridgeNotifications = Pick<AppBridge, 'sendToolInput' | 'sendToolResult'>;
export declare function waitForExtAppFrameLoad(target: IframeLoadTarget): Promise<void>;
export declare function getExtAppBridgeInitKey(node: CanvasNodeState, retryKey: number): string;
export declare function sendExtAppBootstrapState(bridge: ExtAppBridgeNotifications, toolInput: Record<string, unknown>, toolResult: CallToolResult | undefined): Promise<void>;
export declare function ExtAppFrame({ node }: {
    node: CanvasNodeState;
}): import("preact/src").JSX.Element;
export {};
