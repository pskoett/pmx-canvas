import { canvasTheme } from '../state/canvas-store';
import { openNodeInSystemBrowserRequest } from '../state/intent-bridge';
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
  /** Nonce authorizing iframe → parent AX emits (html bridge). */
  axToken?: string;
  /** Nonce for the content-height reporter (node grows to fit content). */
  frameToken?: string;
}

/** Build the stable per-node surface URL (/api/canvas/surface/:id) the iframe and "Open as site" both use. */
export function nodeSurfaceUrl(nodeId: string, opts: SurfaceUrlOptions = {}): string {
  const params = new URLSearchParams();
  params.set('theme', opts.theme ?? canvasTheme.value);
  if (opts.themeToken) params.set('themeToken', opts.themeToken);
  if (opts.present) params.set('present', '1');
  if (opts.presentToken) params.set('presentToken', opts.presentToken);
  if (opts.v) params.set('v', opts.v);
  if (opts.axToken) params.set('axToken', opts.axToken);
  if (opts.frameToken) params.set('frameToken', opts.frameToken);
  return `/api/canvas/surface/${encodeURIComponent(nodeId)}?${params.toString()}`;
}

/** Whether a node can be opened as a standalone site (shared with the server). */
export function canOpenAsSite(node: CanvasNodeState): boolean {
  return canOpenNodeAsSurface(node.type, node.data as Record<string, unknown>);
}

/**
 * Open the node's standalone surface in the user's system browser. Falls back to
 * `window.open` when the server cannot launch a browser, preserving in-browser tests
 * and headless/disabled-browser environments.
 */
export async function openNodeAsSite(node: CanvasNodeState): Promise<void> {
  const url = nodeSurfaceUrl(node.id);
  const res = await openNodeInSystemBrowserRequest(node.id, url);
  if (!res.opened) window.open(url, '_blank', 'noopener');
}
