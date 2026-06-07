/**
 * Cross-cutting helpers for node "surfaces" — the standalone documents served at
 * /api/canvas/surface/:nodeId. Shared by the server route, the server-side node
 * serialization, and the client so the openability rule lives in exactly one
 * place. The authoritative dispatch (serve vs redirect) lives in the server's
 * handleNodeSurface; this predicate mirrors which node types it can open.
 */

/**
 * Whether a node has an "Open as site" surface. Coarse by design (presence of the
 * minimal field) — the route itself decides what to actually serve.
 */
export function canOpenNodeAsSurface(type: string, data: Record<string, unknown>): boolean {
  switch (type) {
    case 'html':
      return (typeof data.html === 'string' && data.html.length > 0)
        || (typeof data.content === 'string' && data.content.length > 0);
    case 'json-render':
    case 'graph':
      return true;
    case 'mcp-app':
      return (data.viewerType === 'web-artifact' && typeof data.path === 'string' && data.path.length > 0)
        || (data.mode === 'ext-app' && typeof data.html === 'string' && data.html.length > 0)
        || (typeof data.url === 'string' && data.url.length > 0);
    case 'webpage':
      return typeof data.url === 'string' && data.url.length > 0;
    default:
      return false;
  }
}

/**
 * CSP sandbox tokens for a hosted ext-app surface, used both as the in-canvas
 * iframe `sandbox` attribute and as the `Content-Security-Policy: sandbox` value
 * when the surface route serves an ext-app standalone. All tokens are in the
 * server's safe-sandbox allowlist; notably NOT allow-same-origin.
 */
export const DEFAULT_EXT_APP_SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox';
