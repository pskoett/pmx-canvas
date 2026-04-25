/**
 * Resolve the canvas node ID for a given ext-app `toolCallId`.
 *
 * v0.1.4 fixed a long-standing `ext-app-ext-app-…` double-prefix bug where
 * both `nodeId` and `toolCallId` carried the `ext-app-` prefix. This helper
 * encodes the lookup contract so it doesn't drift between the
 * `PmxCanvas` SDK class and the HTTP server.
 *
 * Resolution order:
 *   1. The direct prefixed form (`ext-app-<toolCallId>` if not already
 *      prefixed, otherwise `toolCallId` as-is).
 *   2. The legacy `ext-app-ext-app-…` form, for canvases persisted before
 *      v0.1.4 and still on disk. Remove this fallback in v0.2.x.
 *   3. A scan of the layout for any `mcp-app` ext-app node carrying that
 *      `toolCallId` in its data.
 */
import type { CanvasNodeState } from './canvas-state.js';
export interface ExtAppLookupSource {
    getNode(id: string): CanvasNodeState | undefined;
    listNodes(): readonly CanvasNodeState[];
}
export declare function findCanvasExtAppNodeId(toolCallId: string, source: ExtAppLookupSource): string | null;
