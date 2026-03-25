import { useCallback, useRef, useState } from 'preact/hooks';
import { ContextNode } from '../nodes/ContextNode';
import { LedgerNode } from '../nodes/LedgerNode';
import { MarkdownNode } from '../nodes/MarkdownNode';
import { McpAppNode } from '../nodes/McpAppNode';
import { PromptNode } from '../nodes/PromptNode';
import { ResponseNode } from '../nodes/ResponseNode';
import { StatusNode } from '../nodes/StatusNode';
import { TraceNode } from '../nodes/TraceNode';
import {
  activeNodeId,
  clearSelection,
  edges,
  nodes,
  persistLayout,
  selectNodes,
  setViewport,
  viewport,
} from '../state/canvas-store';
import type { CanvasNodeState } from '../types';
import { CanvasNode } from './CanvasNode';
import { EdgeLayer } from './EdgeLayer';
import { usePanZoom } from './use-pan-zoom';

function renderNodeContent(node: CanvasNodeState) {
  switch (node.type) {
    case 'markdown':
      return <MarkdownNode node={node} />;
    case 'mcp-app':
      return <McpAppNode node={node} />;
    case 'status':
      return <StatusNode node={node} />;
    case 'context':
      return <ContextNode node={node} />;
    case 'ledger':
      return <LedgerNode node={node} />;
    case 'trace':
      return <TraceNode node={node} />;
    case 'prompt':
      return <PromptNode node={node} />;
    case 'response':
      return <ResponseNode node={node} />;
    default:
      return <div>Unknown node type</div>;
  }
}

interface LassoRect {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface CanvasViewportProps {
  onNodeContextMenu?: (e: MouseEvent, nodeId: string) => void;
}

export function CanvasViewport({ onNodeContextMenu }: CanvasViewportProps) {
  const v = viewport.value;
  const isLassoing = useRef(false);
  const [lasso, setLasso] = useState<LassoRect | null>(null);
  // Ref mirrors lasso state so pointer handlers always read the latest value
  // without stale-closure issues from useCallback dependency capture.
  const lassoRef = useRef<LassoRect | null>(null);

  const containerRef = usePanZoom({
    viewport,
    onViewportChange: (next) => {
      // Don't pan while lassoing — usePanZoom's pointerdown still fires
      // (native listener) before our Preact handler can stopPropagation.
      if (isLassoing.current) return;
      setViewport(next);
      persistLayout();
    },
  });

  // Lasso: Shift+pointerdown on background starts lasso selection
  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      const container = containerRef.current;
      if (!container || e.target !== container) return;

      if (!e.shiftKey) {
        if (!lassoRef.current) {
          activeNodeId.value = null;
          clearSelection();
        }
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      isLassoing.current = true;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const initial = { startX: x, startY: y, currentX: x, currentY: y };
      lassoRef.current = initial;
      setLasso(initial);
      container.setPointerCapture(e.pointerId);
    },
    [containerRef],
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!isLassoing.current || !lassoRef.current) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const updated = {
        ...lassoRef.current,
        currentX: e.clientX - rect.left,
        currentY: e.clientY - rect.top,
      };
      lassoRef.current = updated;
      setLasso(updated);
    },
    [containerRef],
  );

  const handlePointerUp = useCallback(() => {
    const current = lassoRef.current;
    if (!isLassoing.current || !current) return;
    isLassoing.current = false;
    lassoRef.current = null;

    // Compute lasso rectangle in screen space
    const minX = Math.min(current.startX, current.currentX);
    const maxX = Math.max(current.startX, current.currentX);
    const minY = Math.min(current.startY, current.currentY);
    const maxY = Math.max(current.startY, current.currentY);

    // Only commit if the lasso was dragged at least a few pixels
    if (maxX - minX > 5 || maxY - minY > 5) {
      // Convert screen lasso rect to world-space
      const vp = viewport.value;
      const worldMinX = (minX - vp.x) / vp.scale;
      const worldMaxX = (maxX - vp.x) / vp.scale;
      const worldMinY = (minY - vp.y) / vp.scale;
      const worldMaxY = (maxY - vp.y) / vp.scale;

      // Find intersecting nodes (AABB intersection)
      const hits: string[] = [];
      for (const node of nodes.value.values()) {
        if (node.dockPosition !== null) continue;
        const nx = node.position.x;
        const ny = node.position.y;
        if (
          nx + node.size.width > worldMinX &&
          nx < worldMaxX &&
          ny + node.size.height > worldMinY &&
          ny < worldMaxY
        ) {
          hits.push(node.id);
        }
      }
      if (hits.length > 0) {
        selectNodes(hits);
      }
    }

    setLasso(null);
  }, []);

  // Only render world-space nodes (dockPosition === null); docked nodes are in the HUD layer.
  // Do NOT sort by zIndex here — CSS z-index handles visual stacking. Sorting would
  // reorder DOM children when bringToFront() changes zIndex, causing browsers to
  // detach/reattach iframe elements (which forces them to reload/reconnect).
  const worldNodes = Array.from(nodes.value.values()).filter((n) => n.dockPosition === null);

  // Compute lasso overlay rect in screen space
  let lassoStyle: Record<string, string> | null = null;
  if (lasso) {
    const l = Math.min(lasso.startX, lasso.currentX);
    const t = Math.min(lasso.startY, lasso.currentY);
    const w = Math.abs(lasso.currentX - lasso.startX);
    const h = Math.abs(lasso.currentY - lasso.startY);
    lassoStyle = {
      position: 'absolute',
      left: `${l}px`,
      top: `${t}px`,
      width: `${w}px`,
      height: `${h}px`,
      pointerEvents: 'none',
    };
  }

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        cursor: isLassoing.current ? 'crosshair' : 'grab',
      }}
    >
      {/* D4: CSS matrix(a,b,c,d,tx,ty) — scale uniformly (a=d=scale, b=c=0)
          then translate (tx=v.x, ty=v.y). transformOrigin: '0 0' ensures
          the scale pivot is the top-left corner of the world layer. */}
      <div
        style={{
          transform: `matrix(${v.scale}, 0, 0, ${v.scale}, ${v.x}, ${v.y})`,
          transformOrigin: '0 0',
          willChange: 'transform',
          position: 'absolute',
          top: 0,
          left: 0,
        }}
      >
        <EdgeLayer nodes={nodes} edges={edges} />
        {worldNodes.map((node) => (
          <CanvasNode key={node.id} node={node} onContextMenu={onNodeContextMenu}>
            {renderNodeContent(node)}
          </CanvasNode>
        ))}
      </div>
      {lassoStyle && <div class="lasso-rect" style={lassoStyle} />}
    </div>
  );
}
