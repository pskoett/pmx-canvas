import { canvasTheme } from '../state/canvas-store';
import { canOpenNodeAsSurface } from '../../shared/surface.js';
import type { CanvasNodeState } from '../types';

/**
 * Stable content hash (djb2) used to cache-bust the surface iframe `src` when a
 * node's HTML changes. The server always serves current state, but a same `src`
 * string won't reload the iframe on its own — bumping `?v=` does.
 */
export function surfaceContentHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export interface SurfaceUrlOptions {
  theme?: string;
  themeToken?: string;
  present?: boolean;
  presentToken?: string;
  v?: string;
}

/** Build the stable per-node surface URL (/api/canvas/surface/:id) the iframe and "Open as site" both use. */
export function nodeSurfaceUrl(nodeId: string, opts: SurfaceUrlOptions = {}): string {
  const params = new URLSearchParams();
  params.set('theme', opts.theme ?? canvasTheme.value);
  if (opts.themeToken) params.set('themeToken', opts.themeToken);
  if (opts.present) params.set('present', '1');
  if (opts.presentToken) params.set('presentToken', opts.presentToken);
  if (opts.v) params.set('v', opts.v);
  return `/api/canvas/surface/${encodeURIComponent(nodeId)}?${params.toString()}`;
}

/** Whether a node can be opened as a standalone site (shared with the server). */
export function canOpenAsSite(node: CanvasNodeState): boolean {
  return canOpenNodeAsSurface(node.type, node.data as Record<string, unknown>);
}

/** Open the node's surface in a new browser tab. */
export function openNodeAsSite(node: CanvasNodeState): void {
  window.open(nodeSurfaceUrl(node.id), '_blank', 'noopener');
}
