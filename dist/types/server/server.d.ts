/**
 * Standalone canvas server — extracted from PMX web-canvas/server.ts.
 *
 * Provides:
 * - GET  /workbench              -> canvas SPA HTML
 * - GET  /api/file?path=...      -> read markdown content
 * - POST /api/file/save          -> persist markdown edits
 * - POST /api/render             -> server-side markdown render (marked)
 * - GET  /api/canvas/state       -> canvas layout
 * - POST /api/canvas/update      -> batch node updates
 * - POST /api/canvas/edge        -> add edge
 * - DELETE /api/canvas/edge      -> remove edge
 * - POST /api/canvas/prompt      -> canvas prompt
 * - POST /api/canvas/context-pins -> update context pins
 * - GET  /api/canvas/pinned-context -> get pinned context preamble
 * - GET  /api/canvas/spatial-context -> spatial analysis (clusters, reading order, neighborhoods)
 * - GET  /api/canvas/search?q=...  -> full-text search across nodes
 * - GET  /api/canvas/code-graph   -> auto-detected file dependency graph
 * - POST /api/canvas/undo         -> undo last mutation
 * - POST /api/canvas/redo         -> redo last undone mutation
 * - GET  /api/canvas/history      -> mutation history timeline
 * - POST /api/canvas/json-render  -> create a native json-render node
 * - POST /api/canvas/graph        -> create a native graph node
 * - GET  /api/canvas/json-render/view?nodeId=... -> local json-render viewer
 * - POST /api/canvas/web-artifact -> build bundled HTML artifact + optional canvas node
 * - GET  /api/workbench/events   -> SSE event stream
 * - GET  /api/workbench/state    -> workbench state snapshot
 * - POST /api/workbench/intent   -> workbench intents
 * - GET  /api/workbench/webview  -> Bun.WebView automation status
 * - POST /api/workbench/webview/start -> start Bun.WebView automation session
 * - POST /api/workbench/webview/evaluate -> evaluate JS in Bun.WebView automation session
 * - POST /api/workbench/webview/resize -> resize Bun.WebView automation viewport
 * - POST /api/workbench/webview/screenshot -> capture Bun.WebView automation screenshot
 * - DELETE /api/workbench/webview -> stop Bun.WebView automation session
 */
export interface PrimaryWorkbenchEventPayload {
    [key: string]: unknown;
}
export interface CanvasAutomationWebViewOptions {
    backend?: 'webkit' | 'chrome';
    width?: number;
    height?: number;
    chromePath?: string;
    chromeArgv?: string[];
    dataStoreDir?: string;
}
export interface CanvasAutomationWebViewStatus {
    supported: boolean;
    active: boolean;
    headlessOnly: true;
    url: string | null;
    backend: 'webkit' | 'chrome' | null;
    width: number | null;
    height: number | null;
    dataStoreDir: string | null;
    startedAt: string | null;
    lastError: string | null;
}
export declare function getCanvasAutomationWebViewStatus(): CanvasAutomationWebViewStatus;
export declare function stopCanvasAutomationWebView(): Promise<boolean>;
export declare function startCanvasAutomationWebView(url: string, options?: CanvasAutomationWebViewOptions): Promise<CanvasAutomationWebViewStatus>;
export declare function evaluateCanvasAutomationWebView(expression: string): Promise<unknown>;
export declare function wrapCanvasAutomationScript(script: string): string;
export declare function resizeCanvasAutomationWebView(width: number, height: number): Promise<CanvasAutomationWebViewStatus>;
export declare function screenshotCanvasAutomationWebView(options?: Record<string, unknown>): Promise<Uint8Array>;
export interface PrimaryWorkbenchIntent {
    id: number;
    type: 'focus-primary' | 'refresh-artifact' | 'review-artifact' | 'focus-approval' | 'open-aux' | 'close-aux' | 'mcp-app-focus' | 'mcp-app-close' | 'trace-toggle' | 'trace-clear' | 'canvas-prompt';
    payload: PrimaryWorkbenchEventPayload;
    createdAt: string;
}
export interface PrimaryWorkbenchCanvasPromptRequest {
    nodeId: string;
    text: string;
    displayText: string;
    parentNodeId?: string;
    contextNodeIds: string[];
}
type PrimaryWorkbenchCanvasPromptHandler = (request: PrimaryWorkbenchCanvasPromptRequest) => Promise<void>;
export declare function setPrimaryWorkbenchAutoOpenEnabled(enabled: boolean): void;
export declare function isPrimaryWorkbenchAutoOpenEnabled(): boolean;
export declare function hasWorkbenchSubscribers(): boolean;
export declare function setPrimaryWorkbenchCanvasPromptHandler(handler: PrimaryWorkbenchCanvasPromptHandler | null): void;
export declare function buildMacBrowserOpenScript(appName: string, url: string): string;
export declare function openUrlInExternalBrowser(url: string): boolean;
export declare function emitPrimaryWorkbenchEvent(event: string, payload?: PrimaryWorkbenchEventPayload): void;
export declare function consumePrimaryWorkbenchIntents(limit?: number): PrimaryWorkbenchIntent[];
export declare function getPrimaryWorkbenchUrl(workspaceRoot?: string): string | null;
export declare function syncCanvasBrowserOpenedFromSubscribers(): void;
export declare function isCanvasBrowserOpened(): boolean;
export declare function isCanvasBrowserOpening(): boolean;
export declare function markCanvasBrowserOpened(): void;
export declare function markCanvasBrowserOpening(): void;
export declare function openPrimaryWorkbenchPath(pathLike: string, workspaceRoot?: string): string | null;
export interface CanvasServerOptions {
    port?: number;
    workspaceRoot?: string;
    autoOpenBrowser?: boolean;
}
export declare function startCanvasServer(options?: CanvasServerOptions): string | null;
export declare function stopCanvasServer(): void;
export declare function getCanvasServerPort(): number | null;
export { closeMcpAppHostSession, focusMcpAppHostSession, getMcpAppHostSnapshot, isTrustedMcpAppDomain, listMcpAppHostSessions, markMcpAppHostSessionOpenedExternally, preRegisterKnownMcpAppHostCapabilities, registerMcpAppHostCapability, routeMcpAppCandidateToHost, } from './mcp-app-host.js';
export type { McpAppCandidateInput, McpAppHostCapability, McpAppHostCapabilityState, McpAppHostRoutingResult, McpAppHostSession, McpAppHostSnapshot, } from './mcp-app-host.js';
