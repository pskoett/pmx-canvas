import { useEffect } from 'preact/hooks';
import { nodes } from '../state/canvas-store';
import {
  hoveredIntentId,
  intents,
  type ClientIntent,
} from '../state/intent-store';
import { vetoGhostIntent } from '../state/intent-bridge';
import { getNodeIcon } from '../icons';
import { TYPE_LABELS } from '../types';
import type { CanvasNodeState } from '../types';

/**
 * Ghost Cursor of Intent overlay. Renders the agent's pre-commit moves as faint
 * placeholders in world space (it lives inside the canvas transform, like
 * FocusFieldLayer, so positions are world coords). Five kinds:
 *   create  → dashed ghost node with icon + type badge
 *   move    → ghost at the destination + a dashed trail from the current node
 *   connect → dashed bezier in the edge-type color
 *   remove  → red crosshatch tombstone over the target
 *   edit    → shimmer bar over the target
 * Each ghost carries a label/confidence chip, its reason, a seq badge (staged
 * batches), and a ✕ veto (also Esc while hovered).
 */

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const DEFAULT_GHOST_SIZE = { width: 260, height: 150 };

const GHOST_SIZE: Partial<Record<string, { width: number; height: number }>> = {
  markdown: { width: 300, height: 170 },
  status: { width: 280, height: 110 },
  context: { width: 300, height: 200 },
  trace: { width: 220, height: 64 },
  file: { width: 300, height: 190 },
  image: { width: 260, height: 200 },
  webpage: { width: 320, height: 210 },
  html: { width: 320, height: 210 },
  group: { width: 340, height: 210 },
  graph: { width: 320, height: 210 },
  'json-render': { width: 320, height: 210 },
  'mcp-app': { width: 340, height: 230 },
};

function isKnownNodeType(value: string | undefined): value is CanvasNodeState['type'] {
  return !!value && value in TYPE_LABELS;
}

function getNodeRect(nodeId: string | undefined): Rect | null {
  if (!nodeId) return null;
  const node = nodes.value.get(nodeId);
  if (!node || node.dockPosition !== null) return null;
  return { left: node.position.x, top: node.position.y, width: node.size.width, height: node.size.height };
}

function center(rect: Rect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function ghostOpacity(intent: ClientIntent): number {
  if (typeof intent.confidence !== 'number') return 0.82;
  return 0.4 + Math.max(0, Math.min(1, intent.confidence)) * 0.55;
}

function bezierPath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

function GhostInfo({ intent }: { intent: ClientIntent }) {
  const NodeIcon = isKnownNodeType(intent.nodeType) ? getNodeIcon(intent.nodeType) : null;
  const label = intent.label || intent.kind;
  const confidencePct =
    typeof intent.confidence === 'number' ? `${Math.round(intent.confidence * 100)}%` : null;
  return (
    <div
      class="intent-info"
      onMouseEnter={() => (hoveredIntentId.value = intent.id)}
      onMouseLeave={() => {
        if (hoveredIntentId.value === intent.id) hoveredIntentId.value = null;
      }}
    >
      <div class="intent-chip">
        {typeof intent.seq === 'number' && <span class="intent-seq">{intent.seq}</span>}
        {NodeIcon && (
          <span class="intent-chip-icon" aria-hidden="true">
            <NodeIcon size={12} />
          </span>
        )}
        <span class="intent-chip-label">{label}</span>
        {confidencePct && <span class="intent-confidence">{confidencePct}</span>}
        {intent.phase === 'forming' && (
          <button
            type="button"
            class="intent-veto"
            title="Veto this move (Esc)"
            aria-label="Veto this move"
            onClick={(e) => {
              e.stopPropagation();
              void vetoGhostIntent(intent);
            }}
          >
            ✕
          </button>
        )}
      </div>
      {intent.reason && <div class="intent-reason">{intent.reason}</div>}
    </div>
  );
}

function GhostBox({ intent, rect }: { intent: ClientIntent; rect: Rect }) {
  const NodeIcon = isKnownNodeType(intent.nodeType) ? getNodeIcon(intent.nodeType) : null;
  const typeLabel = isKnownNodeType(intent.nodeType) ? TYPE_LABELS[intent.nodeType] : 'Node';
  return (
    <div
      class={`intent-ghost intent-ghost-box is-${intent.phase}`}
      data-intent-id={intent.id}
      style={{
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        opacity: ghostOpacity(intent),
      }}
    >
      <div class="intent-ghost-titlebar">
        <span class="intent-ghost-icon" aria-hidden="true">
          {NodeIcon ? <NodeIcon size={13} /> : '◇'}
        </span>
        <span class="intent-ghost-badge">{typeLabel}</span>
      </div>
      <GhostInfo intent={intent} />
    </div>
  );
}

function GhostOverlay({ intent, rect, variant }: { intent: ClientIntent; rect: Rect; variant: 'remove' | 'edit' }) {
  return (
    <div
      class={`intent-ghost intent-ghost-${variant} is-${intent.phase}`}
      data-intent-id={intent.id}
      style={{
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        opacity: ghostOpacity(intent),
      }}
    >
      {variant === 'edit' && <div class="intent-edit-bar" />}
      <GhostInfo intent={intent} />
    </div>
  );
}

function renderGhost(intent: ClientIntent) {
  const settledRect = intent.phase === 'settling'
    ? getNodeRect(intent.settledNodeId)
    : null;
  switch (intent.kind) {
    case 'create': {
      if (!intent.position) return null;
      const size = (intent.nodeType && GHOST_SIZE[intent.nodeType]) || DEFAULT_GHOST_SIZE;
      const rect: Rect = settledRect ?? { left: intent.position.x, top: intent.position.y, ...size };
      return <GhostBox key={intent.id} intent={intent} rect={rect} />;
    }
    case 'move': {
      if (!intent.position) return null;
      const source = getNodeRect(intent.nodeId);
      const size = source ?? DEFAULT_GHOST_SIZE;
      const rect: Rect = settledRect ?? { left: intent.position.x, top: intent.position.y, width: size.width, height: size.height };
      return <GhostBox key={intent.id} intent={intent} rect={rect} />;
    }
    case 'remove': {
      const rect = settledRect ?? getNodeRect(intent.nodeId);
      if (!rect) return null;
      return <GhostOverlay key={intent.id} intent={intent} rect={rect} variant="remove" />;
    }
    case 'edit': {
      const rect = settledRect ?? getNodeRect(intent.nodeId);
      if (!rect) return null;
      return <GhostOverlay key={intent.id} intent={intent} rect={rect} variant="edit" />;
    }
    case 'connect': {
      if (!intent.edge) return null;
      const from = getNodeRect(intent.edge.from);
      const to = getNodeRect(intent.edge.to);
      if (!from || !to) return null;
      const mid = { x: (from.left + from.width / 2 + to.left + to.width / 2) / 2, y: (from.top + from.height / 2 + to.top + to.height / 2) / 2 };
      const rect: Rect = { left: mid.x - 110, top: mid.y - 18, width: 220, height: 36 };
      // The bezier itself is drawn in the shared SVG layer; here we anchor the info card.
      return (
        <div
          key={intent.id}
          class={`intent-ghost intent-ghost-connect is-${intent.phase}`}
          data-intent-id={intent.id}
          style={{ left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, opacity: ghostOpacity(intent) }}
        >
          <GhostInfo intent={intent} />
        </div>
      );
    }
    default:
      return null;
  }
}

export function IntentLayer() {
  const list = Array.from(intents.value.values());

  // Esc vetoes the hovered ghost before App's hierarchical Esc handler runs.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return;
      const id = hoveredIntentId.value;
      if (!id) return;
      const intent = intents.value.get(id);
      if (!intent || intent.phase !== 'forming') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      void vetoGhostIntent(intent);
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  if (list.length === 0) return null;

  return (
    <div class="intent-layer">
      <svg class="intent-line-layer" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
        <defs>
          <marker id="intent-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" class="intent-arrow-head" />
          </marker>
        </defs>
        {list.map((intent) => {
          if (intent.kind === 'connect' && intent.edge) {
            const from = getNodeRect(intent.edge.from);
            const to = getNodeRect(intent.edge.to);
            if (!from || !to) return null;
            return (
              <path
                key={`line-${intent.id}`}
                d={bezierPath(center(from), center(to))}
                class={`intent-edge type-${intent.edge.type}`}
                style={{ opacity: ghostOpacity(intent) }}
              />
            );
          }
          if (intent.kind === 'move' && intent.position) {
            const source = getNodeRect(intent.nodeId);
            if (!source) return null;
            const size = source;
            const dest = { x: intent.position.x + size.width / 2, y: intent.position.y + size.height / 2 };
            return (
              <path
                key={`line-${intent.id}`}
                d={bezierPath(center(source), dest)}
                class="intent-trail"
                markerEnd="url(#intent-arrow)"
                style={{ opacity: ghostOpacity(intent) }}
              />
            );
          }
          return null;
        })}
      </svg>
      {list.map(renderGhost)}
    </div>
  );
}
