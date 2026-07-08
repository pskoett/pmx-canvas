import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import type { CanvasNodeState } from '../types';
type ExtAppBridgeNotifications = Pick<AppBridge, 'sendToolInput' | 'sendToolResult'>;
type DisplayMode = 'inline' | 'fullscreen' | 'pip';
type ExtAppFrameStatus = 'loading' | 'ready' | 'done';
interface ExtAppHostDimensionsTarget {
    clientWidth?: number;
    clientHeight?: number;
    getBoundingClientRect(): Pick<DOMRectReadOnly, 'width' | 'height'>;
}
/**
 * Finding F (0.2.4): detect a WebKit-only host — Safari or a WKWebView (e.g. the
 * GitHub Copilot app's embedded panel). Blink engines (Chrome / Chromium / Edge /
 * the Codex browser, all of which carry a Chrome/Chromium/CriOS/Edg token) and
 * Android WebView are excluded, as is Gecko (no `AppleWebKit`). Used to gate the
 * one-time ext-app iframe repaint remount to the only engine that exhibits the
 * present-at-load black-tile paint race, so the remount is a strict no-op
 * everywhere we can test (Chrome / Codex / Playwright).
 */
export declare function isWebKitOnlyHost(userAgent: string): boolean;
export declare const WEBKIT_REMOUNT_SETTLE_MS = 1000;
export interface WebkitRemountTask {
    /** Perform the remount. Return false if the node no longer needs it (skips the boot wait). */
    remount: () => boolean;
    /** Resolves when the remounted app genuinely boots AND finishes its bootstrap replay, or after a bounded timeout. */
    awaitBoot: () => Promise<void>;
}
export declare function extAppRecoveryLog(nodeId: string, event: string): void;
export declare function enqueueWebkitRemount(task: WebkitRemountTask): void;
export declare function shouldScheduleWebKitRepaint(status: ExtAppFrameStatus, hasReplayToolResult: boolean): boolean;
export declare function getExtAppBridgeInitKey(node: CanvasNodeState, retryKey: number): string;
export declare function resolveExtAppDisplayModeRequest(requestedMode: DisplayMode, isExpanded: boolean): {
    nextMode: DisplayMode;
    shouldExpand: boolean;
    shouldCollapse: boolean;
};
export declare function sendExtAppBootstrapState(bridge: ExtAppBridgeNotifications, toolInput: Record<string, unknown>, toolResult: CallToolResult | undefined): Promise<void>;
export declare function resolveExtAppSandbox(value: unknown): string;
export declare function buildExtAppAxBridgeScript(axToken: string, nodeId: string): string;
/**
 * Boot beacon injected into EVERY ext-app document (not gated on AX): posts one
 * parent message the moment the iframe's scripts execute. This is the liveness
 * signal the WebKit never-booted watchdog keys on — it distinguishes an app
 * that is alive but boots via the 1200ms bootstrap fallback (e.g. a non-SDK
 * widget that never sends ui/notifications/initialized) from a dead window
 * whose scripts never ran. Without it, the watchdog treated every
 * fallback-booted app as never-booted and remounted it up to the attempt cap —
 * a reboot/flicker loop for exactly the apps the fallback exists to support
 * (0.3.2 pre-release review). The token scopes the message to this component;
 * the host also checks event.source against the live iframe.
 */
export declare function buildExtAppBootBeaconScript(frameToken: string, nodeId: string): string;
export declare function injectExtAppAxBridgeScript(html: string, axBridgeScript: string): string;
export declare function resolveExtAppContainerDimensions(target: ExtAppHostDimensionsTarget | null | undefined, fallback: {
    width: number;
    height: number;
}): {
    width: number;
    height: number;
};
export declare function shouldApplyExtAppSizeChange(height: unknown, isExpanded: boolean): height is number;
export declare function resolveExtAppInlineFrameHeight(appHeight: number, hostHeight: number): number;
export declare function ExtAppFrame({ node, expanded }: {
    node: CanvasNodeState;
    expanded?: boolean;
}): import("preact/jsx-runtime").JSX.Element;
export {};
