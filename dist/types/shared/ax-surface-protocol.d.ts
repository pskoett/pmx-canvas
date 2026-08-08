/**
 * Wire-protocol source tags for sandboxed-surface ↔ canvas postMessage traffic
 * (plan-009 M2): one module owns the strings that used to be spread across the
 * client node components, the server-side surface script generators, the
 * ext-app script builders, and the json-render viewer. These are the trust
 * boundary between opaque-origin iframes and the canvas — a typo'd tag fails
 * SILENTLY (the listener just ignores the message), so single-siting them is a
 * correctness measure, not cosmetics. The values are a persisted wire contract
 * with already-generated surface documents: never change them.
 */
/** A sandboxed surface emitting an AX interaction to the parent canvas. */
export declare const AX_SURFACE_EMIT_SOURCE = "pmx-canvas-ax";
/** The parent canvas acking an AX interaction back to the emitting surface (#55). */
export declare const AX_SURFACE_ACK_SOURCE = "pmx-canvas-ax-ack";
/** Parent→surface pushes (theme updates, live AX state) into html/viewer iframes. */
export declare const HTML_SURFACE_PUSH_SOURCE = "pmx-canvas-html-node";
/** Ext-app boot beacon: the iframe's scripts executed (WebKit watchdog liveness). */
export declare const EXT_APP_BOOT_BEACON_SOURCE = "pmx-canvas-ext-app-alive";
/**
 * Parent→ext-app paint probe (Finding N): the parent asks the app document to
 * answer with a double-rAF `paint-tick` beacon. A frame whose rendering
 * pipeline is live answers within a frame or two; silence past the timeout is
 * the paint-fail signal that drives the recovery ladder.
 */
export declare const EXT_APP_PAINT_PROBE_SOURCE = "pmx-canvas-ext-app-paint-probe";
