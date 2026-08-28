import { focusNode, viewport } from '../state/canvas-store';
import { createNodeFromClient } from '../state/intent-bridge';
import { canvasAreaCenter } from './canvas-area';

/** Default frames for human creates that pass no size (the server clamps to the type floor). */
const DEFAULT_FRAME: Record<string, { width: number; height: number }> = {
  markdown: { width: 520, height: 360 },
  group: { width: 600, height: 400 },
  html: { width: 720, height: 640 },
  image: { width: 720, height: 520 },
  file: { width: 720, height: 600 },
  webpage: { width: 520, height: 420 },
};

/**
 * A human create from the rail, keyboard, palette, or empty state lands
 * centred in the CURRENT viewport — where the human is looking — instead of
 * at the server's board-relative auto-placement, which on a busy board can
 * be far off-screen (the rail's Group landed out of view). Explicit x/y win.
 */
export async function createNodeInView(opts: {
  type: string;
  title?: string;
  content?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}): Promise<{ ok: boolean; id?: string }> {
  if (opts.x !== undefined && opts.y !== undefined) return createNodeFromClient(opts);
  const frame = DEFAULT_FRAME[opts.type] ?? { width: 360, height: 200 };
  const width = opts.width ?? frame.width;
  const height = opts.height ?? frame.height;
  const centre = canvasAreaCenter();
  const v = viewport.value;
  const result = await createNodeFromClient({
    ...opts,
    width,
    height,
    x: Math.round((centre.x - v.x) / v.scale - width / 2),
    y: Math.round((centre.y - v.y) / v.scale - height / 2),
  });
  // The shared viewport can move between the ask (a prompted dialog) and the
  // create — focus the node so it can never land off-screen (0.5.0 readiness,
  // Codex: Open image… required a palette hunt to find its node).
  if (result.ok && result.id) focusNode(result.id);
  return result;
}
