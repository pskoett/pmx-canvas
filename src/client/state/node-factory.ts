import type { CanvasNodeState } from '../types';

// ── Client node-creation defaults (plan-009 H5, client half) ──
// Single source of truth for the frame (position/size/zIndex/flags) a NEW
// client-created node gets when its creating event carries no explicit
// geometry. Extracted from sse-bridge, which kept one `makeNode` helper plus
// three inline node literals (ext-app open, prompt, response) duplicating
// these defaults.
//
// Divergences found during extraction — documented, NOT silently unified:
// - `canvas-store.ts` holds no node-creation defaults today. Human-created
//   nodes go through `createNodeFromClient` (intent-bridge → POST
//   /api/canvas/node) and get the SERVER's `defaultNodeSize`
//   (src/server/operations/ops/nodes.ts), which differs from this table for
//   most types (e.g. its fallback is 360x200). The server half of H5
//   (`syncEventToCanvasState`, `ensureDefaultDockedNodes`) is deliberately
//   deferred — do not "fix" that mismatch from this file.
// - The server seeds `status-main`/`context-main` docked AND collapsed
//   (`ensureDefaultDockedNodes` in src/server/server.ts); the SSE bridge
//   creates the same ids expanded, with `context-main` undocked. Client
//   behavior is preserved as-is.
// - sse-bridge's prompt literal hardcoded `height: 400` beside a table entry
//   of the same value; both now read the table (no rendering change).

export const DEFAULT_POSITIONS: Record<CanvasNodeState['type'], { x: number; y: number; w: number; h: number }> &
  Record<'prompt' | 'response', { x: number; y: number; w: number; h: number }> = {
  status: { x: 40, y: 80, w: 300, h: 120 },
  markdown: { x: 380, y: 80, w: 720, h: 600 },
  context: { x: 1130, y: 80, w: 320, h: 400 },
  'mcp-app': { x: 380, y: 720, w: 960, h: 600 },
  webpage: { x: 380, y: 80, w: 520, h: 420 },
  'json-render': { x: 380, y: 720, w: 840, h: 620 },
  graph: { x: 380, y: 720, w: 760, h: 520 },
  ledger: { x: 1130, y: 520, w: 320, h: 280 },
  trace: { x: 40, y: 900, w: 200, h: 56 },
  file: { x: 380, y: 80, w: 720, h: 600 },
  image: { x: 380, y: 80, w: 720, h: 520 },
  html: { x: 380, y: 80, w: 720, h: 640 },
  group: { x: 220, y: 60, w: 840, h: 560 },
  prompt: { x: 380, y: 1260, w: 520, h: 400 },
  response: { x: 380, y: 1480, w: 720, h: 400 },
};

/**
 * Build a canvas node with the shared client defaults. `position`/`size`
 * default to the type's DEFAULT_POSITIONS entry; callers that compute
 * placement (auto-placement, event-supplied geometry) pass explicit values.
 * Status nodes sit at zIndex 0 (background chrome), everything else at 1.
 */
export function makeNodeState(
  id: string,
  type: CanvasNodeState['type'],
  data: Record<string, unknown>,
  options: {
    position?: { x: number; y: number };
    size?: { width: number; height: number };
    dockPosition?: 'left' | 'right' | null;
  } = {},
): CanvasNodeState {
  const defaults = DEFAULT_POSITIONS[type];
  return {
    id,
    type,
    position: options.position ?? { x: defaults.x, y: defaults.y },
    size: options.size ?? { width: defaults.w, height: defaults.h },
    zIndex: type === 'status' ? 0 : 1,
    collapsed: false,
    pinned: false,
    dockPosition: options.dockPosition ?? null,
    data,
  };
}
