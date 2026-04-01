import type { Signal } from '@preact/signals';
import { useSignalEffect } from '@preact/signals';
import { useCallback, useRef } from 'preact/hooks';
import { canvasTheme } from '../state/canvas-store';
import { getCanvasTokens } from '../theme/tokens';
import type { CanvasEdge, CanvasNodeState, ViewportState } from '../types';

const MINIMAP_W = 180;
const MINIMAP_H = 120;
const PADDING = 20;

function getNodeColors(): Record<CanvasNodeState['type'], string> {
  const t = getCanvasTokens();
  return {
    markdown: t.accent,
    'mcp-app': t.ok,
    'json-render': t.ok,
    graph: t.purple,
    prompt: t.accent,
    response: t.ok,
    status: t.warn,
    context: t.muted,
    ledger: t.dim,
    trace: t.purple,
    file: t.accent,
    image: t.ok,
    group: t.dim,
  };
}

function getEdgeColors(): Record<CanvasEdge['type'], string> {
  const t = getCanvasTokens();
  return {
    relation: t.muted,
    'depends-on': t.warn,
    flow: t.accent,
    references: t.dim,
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

export function Minimap({
  viewport,
  nodes,
  edges,
  onNavigate,
  containerWidth,
  containerHeight,
}: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDragging = useRef(false);

  // Compute bounding box of all nodes
  const getBounds = useCallback(() => {
    const all = Array.from(nodes.value.values());
    if (all.length === 0) return { minX: 0, minY: 0, maxX: 1000, maxY: 800 };

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const n of all) {
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + n.size.width);
      maxY = Math.max(maxY, n.position.y + n.size.height);
    }

    // Include viewport bounds
    const v = viewport.value;
    const vpLeft = -v.x / v.scale;
    const vpTop = -v.y / v.scale;
    const vpRight = vpLeft + containerWidth / v.scale;
    const vpBottom = vpTop + containerHeight / v.scale;

    minX = Math.min(minX, vpLeft) - PADDING;
    minY = Math.min(minY, vpTop) - PADDING;
    maxX = Math.max(maxX, vpRight) + PADDING;
    maxY = Math.max(maxY, vpBottom) + PADDING;

    return { minX, minY, maxX, maxY };
  }, [nodes, viewport, containerWidth, containerHeight]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = MINIMAP_W * dpr;
    canvas.height = MINIMAP_H * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H);
    const t = getCanvasTokens();
    ctx.fillStyle = t.panel + 'd9'; // panel color with ~85% alpha
    ctx.fillRect(0, 0, MINIMAP_W, MINIMAP_H);

    const bounds = getBounds();
    const worldW = bounds.maxX - bounds.minX || 1;
    const worldH = bounds.maxY - bounds.minY || 1;
    const scale = Math.min(MINIMAP_W / worldW, MINIMAP_H / worldH);

    const toMiniX = (x: number) => (x - bounds.minX) * scale;
    const toMiniY = (y: number) => (y - bounds.minY) * scale;

    // Draw nodes
    const all = Array.from(nodes.value.values());
    const nodeColors = getNodeColors();
    for (const n of all) {
      ctx.fillStyle = nodeColors[n.type] ?? t.muted;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(
        toMiniX(n.position.x),
        toMiniY(n.position.y),
        Math.max(4, n.size.width * scale),
        Math.max(3, n.size.height * scale),
      );
    }

    const edgeColors = getEdgeColors();
    const nodeMap = nodes.value;
    for (const edge of edges.value.values()) {
      const fromNode = nodeMap.get(edge.from);
      const toNode = nodeMap.get(edge.to);
      if (!fromNode || !toNode) continue;
      const fromCx = toMiniX(fromNode.position.x + fromNode.size.width / 2);
      const fromCy = toMiniY(fromNode.position.y + fromNode.size.height / 2);
      const toCx = toMiniX(toNode.position.x + toNode.size.width / 2);
      const toCy = toMiniY(toNode.position.y + toNode.size.height / 2);
      ctx.beginPath();
      ctx.moveTo(fromCx, fromCy);
      ctx.lineTo(toCx, toCy);
      ctx.strokeStyle = edgeColors[edge.type] ?? t.muted;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    // Draw viewport rectangle
    const v = viewport.value;
    const vpLeft = -v.x / v.scale;
    const vpTop = -v.y / v.scale;
    const vpW = containerWidth / v.scale;
    const vpH = containerHeight / v.scale;

    ctx.globalAlpha = 1;
    ctx.strokeStyle = t.accent;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(toMiniX(vpLeft), toMiniY(vpTop), vpW * scale, vpH * scale);
  }, [nodes, edges, viewport, containerWidth, containerHeight, getBounds]);

  // Redraw on state changes (including theme)
  useSignalEffect(() => {
    void canvasTheme.value;
    void nodes.value;
    void edges.value;
    void viewport.value;
    draw();
  });

  const handleNavigateFromEvent = useCallback(
    (e: MouseEvent | PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const bounds = getBounds();
      const worldW = bounds.maxX - bounds.minX || 1;
      const worldH = bounds.maxY - bounds.minY || 1;
      const scale = Math.min(MINIMAP_W / worldW, MINIMAP_H / worldH);

      const v = viewport.value;
      const vpW = containerWidth / v.scale;
      const vpH = containerHeight / v.scale;

      // Center viewport on clicked point
      const worldX = mx / scale + bounds.minX;
      const worldY = my / scale + bounds.minY;
      onNavigate(-(worldX - vpW / 2) * v.scale, -(worldY - vpH / 2) * v.scale);
    },
    [getBounds, viewport, containerWidth, containerHeight, onNavigate],
  );

  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      e.stopPropagation();
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

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        zIndex: 9998,
        border: '1px solid var(--c-line)',
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
        boxShadow: '0 4px 16px var(--c-shadow)',
      }}
    >
      <canvas
        ref={canvasRef}
        width={MINIMAP_W}
        height={MINIMAP_H}
        style={{
          width: `${MINIMAP_W}px`,
          height: `${MINIMAP_H}px`,
          display: 'block',
          cursor: 'pointer',
        }}
        onPointerDown={handlePointerDown}
      />
    </div>
  );
}
