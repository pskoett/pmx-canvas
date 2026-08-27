import { agentIdentityHue } from '../../shared/agent-presence.js';
import type { Signal } from '@preact/signals';
import { useCallback, useRef } from 'preact/hooks';
import { fenceRectFromNodes } from '../../shared/scope-fence.js';
import { selectedNodeIds } from '../state/canvas-store';
import { agentPresences, presenceWorldPosition } from '../state/presence-store';
import { scopeFence } from '../state/session-store';
import type { CanvasEdge, CanvasNodeState, ViewportState } from '../types';
import { KIND_COLOR } from './kind-colors';

/**
 * Minimap v2 (rail-chrome-v2 phase 7, design item 19): a true-scale node map
 * rendered from the store — each node a scaled rect in its kind color, groups
 * and the scope fence as dashed outlines, the viewport frame with a grab
 * cursor, the zoom % in the corner, selection outlines mirrored, and a pulsing
 * violet dot where an attached agent is. 168×112 at rest; hovering magnifies
 * the whole map ×1.7 from the bottom-right corner (CSS). Click jumps the
 * viewport; dragging pans.
 */

export const MINIMAP_W = 168;
export const MINIMAP_H = 112;
const PADDING = 20;

interface MinimapBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface MinimapFrame {
  bounds: MinimapBounds;
  scale: number;
}

export function computeMinimapFrame(
  nodeMap: Map<string, CanvasNodeState>,
  currentViewport: ViewportState,
  containerWidth: number,
  containerHeight: number,
): MinimapFrame {
  const all = Array.from(nodeMap.values());

  let minX = 0;
  let minY = 0;
  let maxX = 1000;
  let maxY = 800;

  if (all.length > 0) {
    minX = Number.POSITIVE_INFINITY;
    minY = Number.POSITIVE_INFINITY;
    maxX = Number.NEGATIVE_INFINITY;
    maxY = Number.NEGATIVE_INFINITY;
    for (const node of all) {
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + node.size.width);
      maxY = Math.max(maxY, node.position.y + node.size.height);
    }
  }

  const viewportLeft = -currentViewport.x / currentViewport.scale;
  const viewportTop = -currentViewport.y / currentViewport.scale;
  const viewportRight = viewportLeft + containerWidth / currentViewport.scale;
  const viewportBottom = viewportTop + containerHeight / currentViewport.scale;

  const bounds = {
    minX: Math.min(minX, viewportLeft) - PADDING,
    minY: Math.min(minY, viewportTop) - PADDING,
    maxX: Math.max(maxX, viewportRight) + PADDING,
    maxY: Math.max(maxY, viewportBottom) + PADDING,
  };

  const worldW = bounds.maxX - bounds.minX || 1;
  const worldH = bounds.maxY - bounds.minY || 1;

  return {
    bounds,
    scale: Math.min(MINIMAP_W / worldW, MINIMAP_H / worldH),
  };
}

interface MinimapProps {
  viewport: Signal<ViewportState>;
  nodes: Signal<Map<string, CanvasNodeState>>;
  edges: Signal<Map<string, CanvasEdge>>;
  onNavigate: (x: number, y: number) => void;
  containerWidth: number;
  containerHeight: number;
}

export function Minimap({ viewport, nodes, onNavigate, containerWidth, containerHeight }: MinimapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const nodeMap = nodes.value;
  const v = viewport.value;
  const frame = computeMinimapFrame(nodeMap, v, containerWidth, containerHeight);
  const { bounds, scale } = frame;
  const toX = (x: number) => (x - bounds.minX) * scale;
  const toY = (y: number) => (y - bounds.minY) * scale;

  const handleNavigateFromEvent = useCallback(
    (e: MouseEvent | PointerEvent) => {
      const map = mapRef.current;
      if (!map) return;
      // The map may be magnified (hover): read the rendered size, not the logical one.
      const rect = map.getBoundingClientRect();
      const mx = ((e.clientX - rect.left) / rect.width) * MINIMAP_W;
      const my = ((e.clientY - rect.top) / rect.height) * MINIMAP_H;
      const current = computeMinimapFrame(nodes.value, viewport.value, containerWidth, containerHeight);
      const vp = viewport.value;
      const vpW = containerWidth / vp.scale;
      const vpH = containerHeight / vp.scale;
      const worldX = mx / current.scale + current.bounds.minX;
      const worldY = my / current.scale + current.bounds.minY;
      onNavigate(-(worldX - vpW / 2) * vp.scale, -(worldY - vpH / 2) * vp.scale);
    },
    [nodes, viewport, containerWidth, containerHeight, onNavigate],
  );

  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      isDragging.current = true;
      handleNavigateFromEvent(e);
      const onPointerMove = (ev: PointerEvent) => {
        if (isDragging.current) handleNavigateFromEvent(ev);
      };
      const onPointerUp = () => {
        isDragging.current = false;
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
      };
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
    },
    [handleNavigateFromEvent],
  );

  const selected = selectedNodeIds.value;
  const fence = scopeFence.value;
  const fenceRect = fence
    ? fenceRectFromNodes(
        fence.nodeIds.map((id) => nodeMap.get(id)).filter((node): node is CanvasNodeState => node !== undefined),
        fence.padding,
      )
    : null;
  // Every live writer shows on the map — attached sessions, external writers,
  // and fleet workers alike (amended presence contract): the minimap is where
  // the human looks first to find WHERE an agent is working.
  const presenceDots = agentPresences.value
    .map((presence) => ({
      id: presence.sessionId,
      phase: presence.phase,
      worker: presence.parentAgentId != null,
      external: !presence.attached,
      at: presenceWorldPosition(presence, (id) => nodeMap.get(id)),
    }))
    .filter((dot): dot is typeof dot & { at: { x: number; y: number } } => dot.at !== null);

  const vpLeft = -v.x / v.scale;
  const vpTop = -v.y / v.scale;

  return (
    <div
      ref={mapRef}
      class="minimap"
      data-testid="minimap"
      title="Click to jump · drag the frame to pan"
      onPointerDown={handlePointerDown}
    >
      {Array.from(nodeMap.values()).map((node) => {
        const isGroup = node.type === 'group';
        return (
          <span
            key={node.id}
            class={`minimap-node${isGroup ? ' is-group' : ''}${selected.has(node.id) ? ' is-selected' : ''}`}
            data-kind={node.type}
            style={{
              left: `${toX(node.position.x)}px`,
              top: `${toY(node.position.y)}px`,
              width: `${Math.max(isGroup ? 6 : 4, node.size.width * scale)}px`,
              height: `${Math.max(isGroup ? 5 : 3, node.size.height * scale)}px`,
              '--kind': KIND_COLOR[node.type],
            }}
          />
        );
      })}
      {fenceRect && (
        <span
          class="minimap-fence"
          style={{
            left: `${toX(fenceRect.x)}px`,
            top: `${toY(fenceRect.y)}px`,
            width: `${fenceRect.width * scale}px`,
            height: `${fenceRect.height * scale}px`,
          }}
        />
      )}
      {presenceDots.map((dot) => (
        <span
          key={dot.id}
          class={`minimap-presence phase-${dot.phase}${dot.worker ? ' is-worker' : ''}${dot.external ? ' is-external' : ''}`}
          style={{
            left: `${toX(dot.at.x) - 4}px`,
            top: `${toY(dot.at.y) - 4}px`,
            '--identity-color': `hsl(${agentIdentityHue(dot.id)} 65% 62%)`,
          }}
        />
      ))}
      <span
        class="minimap-frame"
        style={{
          left: `${toX(vpLeft)}px`,
          top: `${toY(vpTop)}px`,
          width: `${(containerWidth / v.scale) * scale}px`,
          height: `${(containerHeight / v.scale) * scale}px`,
        }}
      />
      <span class="minimap-zoom">{Math.round(v.scale * 100)}%</span>
    </div>
  );
}
