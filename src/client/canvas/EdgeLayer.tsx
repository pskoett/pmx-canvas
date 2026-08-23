import type { Signal } from '@preact/signals';
import { activeNodeId, draggingEdge, searchHighlightIds, viewport, visibleNodeFor } from '../state/canvas-store';
import type { CanvasEdge, CanvasNodeState } from '../types';

// ── Edge type visual styles ──────────────────────────────────
const EDGE_COLORS: Record<CanvasEdge['type'], string> = {
  relation: 'var(--c-muted)',
  'depends-on': 'var(--c-warn)',
  flow: 'var(--c-accent)',
  // --c-dim is a very low-contrast hairline in dark palettes (forest: #5D7566
  // on #0C1712); the dashed style is what distinguishes `references`.
  references: 'var(--c-muted)',
};

const DIRECTED_TYPES = new Set<CanvasEdge['type']>(['depends-on', 'flow']);

/**
 * Edges are drawn in world space, so a 1.5px stroke renders as 0.4 screen px at
 * 26% zoom. Full inverse compensation keeps edge chrome at a constant SCREEN
 * size while zoomed out (standard graph-editor behaviour). Deliberately
 * uncapped — the 2.2 cap used for node chrome still leaves hairlines invisible
 * at overview zoom.
 */
export function edgeChromeScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return scale < 1 ? 1 / scale : 1;
}

function dashArray(edge: CanvasEdge, scale: number): string | undefined {
  const dashed = `${8 * scale} ${4 * scale}`;
  if (edge.style === 'dashed') return dashed;
  if (edge.style === 'dotted') return `${3 * scale} ${3 * scale}`;
  if (edge.type === 'references' && !edge.style) return dashed;
  return undefined;
}

// ── Anchor computation ───────────────────────────────────────
interface Anchor {
  x: number;
  y: number;
}

function computeAnchor(node: CanvasNodeState, target: CanvasNodeState): Anchor {
  const cx = node.position.x + node.size.width / 2;
  const cy = node.position.y + node.size.height / 2;
  const tx = target.position.x + target.size.width / 2;
  const ty = target.position.y + target.size.height / 2;

  const dx = tx - cx;
  const dy = ty - cy;

  const hw = node.size.width / 2;
  const hh = node.size.height / 2;

  // Determine which side the edge exits from
  const tanAngle = Math.abs(dy / (dx || 0.001));
  const boxRatio = hh / (hw || 0.001);

  if (tanAngle > boxRatio) {
    // Top or bottom
    const sign = dy > 0 ? 1 : -1;
    return {
      x: cx + (hh / tanAngle) * (dx > 0 ? 1 : -1),
      y: cy + hh * sign,
    };
  }

  // Left or right
  const sign = dx > 0 ? 1 : -1;
  return {
    x: cx + hw * sign,
    y: cy + tanAngle * hw * (dy > 0 ? 1 : -1),
  };
}

// ── Bezier midpoint at t=0.5 ─────────────────────────────────
function bezierMidpoint(
  x1: number,
  y1: number,
  cx1: number,
  cy1: number,
  cx2: number,
  cy2: number,
  x2: number,
  y2: number,
): { x: number; y: number } {
  const t = 0.5;
  const mt = 1 - t;
  return {
    x: mt * mt * mt * x1 + 3 * mt * mt * t * cx1 + 3 * mt * t * t * cx2 + t * t * t * x2,
    y: mt * mt * mt * y1 + 3 * mt * mt * t * cy1 + 3 * mt * t * t * cy2 + t * t * t * y2,
  };
}

// ── EdgePath component ───────────────────────────────────────
interface EdgePathProps {
  edge: CanvasEdge;
  fromNode: CanvasNodeState;
  toNode: CanvasNodeState;
  focused: boolean; // connected to the active node
  dimmed: boolean; // active node exists but this edge is NOT connected
  scale: number; // inverse-viewport compensation, see edgeChromeScale()
}

function EdgePath({ edge, fromNode, toNode, focused, dimmed, scale }: EdgePathProps) {
  const start = computeAnchor(fromNode, toNode);
  const end = computeAnchor(toNode, fromNode);

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const curvature = Math.min(dist * 0.25, 80);

  // Control points: offset perpendicular to direct line
  const nx = dx / (dist || 1);
  const ny = dy / (dist || 1);
  const cx1 = start.x + nx * curvature;
  const cy1 = start.y + ny * curvature;
  const cx2 = end.x - nx * curvature;
  const cy2 = end.y - ny * curvature;

  const d = `M ${start.x} ${start.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${end.x} ${end.y}`;
  const color = EDGE_COLORS[edge.type];
  const directed = DIRECTED_TYPES.has(edge.type);
  const dash = dashArray(edge, scale);

  const mid = edge.label ? bezierMidpoint(start.x, start.y, cx1, cy1, cx2, cy2, end.x, end.y) : null;

  const pathId = `edge-path-${edge.id}`;

  return (
    <g>
      {/* Invisible wide hitbox for hover/click */}
      <path d={d} fill="none" stroke="transparent" stroke-width={12 * scale} style={{ cursor: 'pointer' }} />

      {/* Glow layer for focused edges */}
      {focused && (
        <path
          d={d}
          fill="none"
          stroke={color}
          stroke-width={6 * scale}
          stroke-dasharray={dash}
          opacity="0.15"
          style={{ filter: 'blur(3px)' }}
        />
      )}

      {/* Visible edge — the `edge-arrow` marker uses the default
          markerUnits="strokeWidth", so the arrowhead scales with this. */}
      <path
        id={pathId}
        d={d}
        fill="none"
        stroke={color}
        stroke-width={(focused ? 2.5 : 1.5) * scale}
        stroke-dasharray={dash}
        marker-end={directed ? 'url(#edge-arrow)' : undefined}
        opacity={dimmed ? 0.2 : focused ? 1 : 0.85}
        style={{ transition: 'opacity 0.2s, stroke-width 0.2s' }}
      />

      {/* Animated pulse dot */}
      {edge.animated && (
        <circle r={3 * scale} fill={color} opacity="0.9">
          <animateMotion dur="2s" repeatCount="indefinite">
            <mpath href={`#${pathId}`} />
          </animateMotion>
        </circle>
      )}

      {/* Label at midpoint */}
      {mid && edge.label && (
        <g transform={`translate(${mid.x}, ${mid.y})`}>
          <rect
            class="edge-label-bg"
            x={-(edge.label.length * 3.5 + 8) * scale}
            y={-10 * scale}
            width={(edge.label.length * 7 + 16) * scale}
            height={20 * scale}
            rx={4 * scale}
          />
          <text class="edge-label" text-anchor="middle" dominant-baseline="central" fill="var(--c-text)">
            {edge.label}
          </text>
        </g>
      )}
    </g>
  );
}

// ── EdgeLayer ────────────────────────────────────────────────
interface EdgeLayerProps {
  nodes: Signal<Map<string, CanvasNodeState>>;
  edges: Signal<Map<string, CanvasEdge>>;
}

export function EdgeLayer({ nodes, edges }: EdgeLayerProps) {
  const nodeMap = nodes.value;
  const edgeList = Array.from(edges.value.values());
  const focusId = activeNodeId.value;
  const hasFocus = focusId !== null;
  const searchSet = searchHighlightIds.value;
  const hasSearch = searchSet !== null;
  const scale = edgeChromeScale(viewport.value.scale);

  // A drag-to-connect preview must draw on a board with no edges yet.
  if (edgeList.length === 0 && !draggingEdge.value) return null;

  const PAD = 96;
  const worldNodes = Array.from(nodeMap.values());
  if (worldNodes.length === 0) return null;
  const minX = Math.min(...worldNodes.map((node) => node.position.x)) - PAD;
  const minY = Math.min(...worldNodes.map((node) => node.position.y)) - PAD;
  const maxX = Math.max(...worldNodes.map((node) => node.position.x + node.size.width)) + PAD;
  const maxY = Math.max(...worldNodes.map((node) => node.position.y + node.size.height)) + PAD;
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);

  return (
    <svg
      aria-label="Canvas connections"
      role="img"
      viewBox={`${minX} ${minY} ${width} ${height}`}
      width={width}
      height={height}
      style={{
        position: 'absolute',
        top: `${minY}px`,
        left: `${minX}px`,
        pointerEvents: 'none',
        overflow: 'visible',
        '--edge-chrome-scale': scale.toFixed(3),
      }}
    >
      <title>Canvas connections</title>
      <defs>
        <marker
          id="edge-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 10 5 L 0 9 z" fill="currentColor" opacity="0.75" />
        </marker>
      </defs>
      {edgeList.map((edge) => {
        // An endpoint hidden behind a collapsed group's chip is drawn to the chip.
        const fromNode = visibleNodeFor(edge.from);
        const toNode = visibleNodeFor(edge.to);
        if (!fromNode || !toNode || fromNode.id === toNode.id) return null;
        const isConnected = hasFocus && (edge.from === focusId || edge.to === focusId);
        const searchDimmed = hasSearch && !(searchSet.has(edge.from) || searchSet.has(edge.to));
        return (
          <EdgePath
            key={edge.id}
            edge={edge}
            fromNode={fromNode}
            toNode={toNode}
            focused={isConnected}
            dimmed={(hasFocus && !isConnected) || searchDimmed}
            scale={scale}
          />
        );
      })}
      {/* Live preview edge while drag-connecting */}
      {draggingEdge.value &&
        (() => {
          const de = draggingEdge.value;
          const dx = de.cursorX - de.fromX;
          const dy = de.cursorY - de.fromY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const curve = Math.min(dist * 0.25, 80);
          const nx = dx / (dist || 1);
          const ny = dy / (dist || 1);
          const previewD = `M ${de.fromX} ${de.fromY} C ${de.fromX + nx * curve} ${de.fromY + ny * curve}, ${de.cursorX - nx * curve} ${de.cursorY - ny * curve}, ${de.cursorX} ${de.cursorY}`;
          return (
            <g>
              <path
                d={previewD}
                fill="none"
                stroke="var(--c-accent)"
                stroke-width={6 * scale}
                opacity="0.1"
                style={{ filter: 'blur(3px)' }}
              />
              <path
                d={previewD}
                fill="none"
                stroke="var(--c-accent)"
                stroke-width={2 * scale}
                stroke-dasharray={`${6 * scale} ${4 * scale}`}
                opacity="0.8"
              />
              <circle cx={de.cursorX} cy={de.cursorY} r={5 * scale} fill="var(--c-accent)" opacity="0.5" />
            </g>
          );
        })()}
    </svg>
  );
}
