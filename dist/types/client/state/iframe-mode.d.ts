export type IframeMode = 'src' | 'srcdoc';
export declare const IFRAME_PROBE_PATH = "/api/canvas/iframe-probe";
/** Boot-wide iframe transport mode; null until the probe (or override) resolves. */
export declare const iframeMode: import("@preact/signals-core").Signal<IframeMode | null>;
export declare function forcedIframeMode(): IframeMode | null;
/**
 * Probe whether `src`-URL iframes load in this embedding context. Resolves true
 * when the hidden probe iframe fires `load`; false on error or timeout. The
 * blocked-portal case shows its placeholder without reliably firing either
 * event, so the timeout is the real signal there — and a false negative is
 * safe, because srcdoc rendering works in normal hosts too.
 */
export declare function probeSrcIframes(timeoutMs?: number): Promise<boolean>;
/**
 * Resolve the boot-wide iframe mode once; all surface hooks share the result.
 * The blocked-src condition only exists when the canvas page itself runs
 * inside an iframe, so top-level documents resolve `src` synchronously — the
 * normal path pays zero probe latency before surfaces mount. Only embedded
 * documents run the probe (`embedded` is overridable for tests).
 */
export declare function resolveIframeMode(opts?: {
    embedded?: boolean;
    ampOrb?: boolean;
}): Promise<IframeMode>;
/** Test hook: clear the memoized probe so each test starts unresolved. */
export declare function resetIframeModeForTests(): void;
