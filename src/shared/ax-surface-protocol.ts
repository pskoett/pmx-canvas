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
export const AX_SURFACE_EMIT_SOURCE = 'pmx-canvas-ax';

/** The parent canvas acking an AX interaction back to the emitting surface (#55). */
export const AX_SURFACE_ACK_SOURCE = 'pmx-canvas-ax-ack';

/** Parent→surface pushes (theme updates, live AX state) into html/viewer iframes. */
export const HTML_SURFACE_PUSH_SOURCE = 'pmx-canvas-html-node';

/** Tab-local JSON viewer state handoff, independent of AX capabilities. */
export const JSON_VIEWER_STATE_SOURCE = 'pmx-canvas-json-state';

/** MCP apps share their window channel with an SDK JSON-RPC transport. */
export const MCP_SURFACE_METHOD = 'notifications/pmx/surface';

export function surfaceNotification(params: Record<string, unknown>) {
  return { jsonrpc: '2.0' as const, method: MCP_SURFACE_METHOD, params };
}

export function readSurfaceNotification(message: unknown): unknown {
  if (
    message &&
    typeof message === 'object' &&
    'jsonrpc' in message &&
    message.jsonrpc === '2.0' &&
    'method' in message &&
    message.method === MCP_SURFACE_METHOD &&
    !('id' in message) &&
    'params' in message
  )
    return message.params;
  return null;
}
