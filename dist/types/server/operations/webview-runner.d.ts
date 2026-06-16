/**
 * Webview runner injection (plan-008 Wave 3).
 *
 * The Bun.WebView automation machinery (startCanvasAutomationWebView / stop /
 * evaluate / resize / status) lives in `../server.ts`, which `operations/` must
 * NEVER import (the isolation rule). The webview ops call into the runner
 * declared here; `server.ts` injects the real implementation at module load via
 * `setWebviewRunner`, exactly mirroring how `setOperationEventEmitter` injects
 * the SSE emitter.
 *
 * `screenshot` is intentionally NOT part of this runner: it returns a binary
 * payload and stays a standalone hand-written tool (`canvas_screenshot`).
 */
/** Webview status shape (structurally the server.ts CanvasAutomationWebViewStatus). */
export interface WebviewStatus {
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
/** Start options (structurally the server.ts CanvasAutomationWebViewOptions). */
export interface WebviewStartOptions {
    backend?: 'webkit' | 'chrome';
    width?: number;
    height?: number;
    chromePath?: string;
    chromeArgv?: string[];
    dataStoreDir?: string;
}
/** Outcome of a start attempt, carrying the success/error asymmetry the legacy
 * route preserved:
 *  - success → 200 { ok:true, webview }
 *  - the canvas server is not running → 503 { ok:false, error } (no webview)
 *  - a supported start failed → 500, an unsupported runtime → 501; both return
 *    { ok:false, error, webview } and the 500-vs-501 split is read off
 *    `webview.supported` (the status), so no separate field is needed. */
export type WebviewStartResult = {
    ok: true;
    webview: WebviewStatus;
} | {
    ok: false;
    serverNotRunning: true;
    error: string;
} | {
    ok: false;
    serverNotRunning?: false;
    error: string;
    webview: WebviewStatus;
};
export interface WebviewRunner {
    /** Current automation status (never throws). */
    status(): WebviewStatus;
    /** Start or replace the headless automation session for the workbench page. */
    start(options: WebviewStartOptions): Promise<WebviewStartResult>;
    /** Stop the active session (resolves false when none was active). May throw. */
    stop(): Promise<boolean>;
    /** Resize the active viewport. Throws when no session is active. */
    resize(width: number, height: number): Promise<WebviewStatus>;
    /** Evaluate JavaScript in the active page. Throws when no session is active. */
    evaluate(expression: string): Promise<unknown>;
}
export declare function setWebviewRunner(runner: WebviewRunner | null): void;
export declare function getWebviewRunner(): WebviewRunner;
