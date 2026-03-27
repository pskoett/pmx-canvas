import type { Signal } from '@preact/signals';
import { activeNodeId } from '../state/canvas-store';
import type { CanvasEdge, CanvasNodeState } from '../types';

// ── Edge type visual styles ──────────────────────────────────
const EDGE_COLORS: Record<CanvasEdge['type'], string> = {
  relation: 'var(--c-muted)',
  'depends-on': 'var(--c-warn)',
  flow: 'var(--c-accent)',
  references: 'var(--c-dim)',
};

const DIRECTED_TYPES = new Set<CanvasEdge['type']>(['depends-on', 'flow']);

function dashArray(edge: CanvasEdge): string | undefined {
  if (edge.style === 'dashed') return '8 4';
  if (edge.style === 'dotted') return '3 3';
  if (edge.type === 'references' && !edge.style) return '8 4';
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
  focused: boolean;   // connected to the active node
  dimmed: boolean;    // active node exists but this edge is NOT connected
}

function EdgePath({ edge, fromNode, toNode, focused, dimmed }: EdgePathProps) {
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
  const dash = dashArray(edge);

  const mid = edge.label
    ? bezierMidpoint(start.x, start.y, cx1, cy1, cx2, cy2, end.x, end.y)
    : null;

  const pathId = `edge-path-${edge.id}`;

  return (
    <g>
      {/* Invisible wide hitbox for hover/click */}
      <path
        d={d}
        fill="none"
        stroke="transparent"
        stroke-width="12"
        style={{ cursor: 'pointer' }}
      />

      {/* Glow layer for focused edges */}
      {focused && (
        <path
          d={d}
          fill="none"
          stroke={color}
          stroke-width="6"
          stroke-dasharray={dash}
          opacity="0.15"
          style={{ filter: 'blur(3px)' }}
        />
      )}

      {/* Visible edge */}
      <path
        id={pathId}
        d={d}
        fill="none"
        stroke={color}
        stroke-width={focused ? 2.5 : 1.5}
        stroke-dasharray={dash}
        marker-end={directed ? 'url(#edge-arrow)' : undefined}
        opacity={dimmed ? 0.2 : focused ? 1 : 0.75}
        style={{ transition: 'opacity 0.2s, stroke-width 0.2s' }}
      />

      {/* Animated pulse dot */}
      {edge.animated && (
        <circle r="3" fill={color} opacity="0.9">
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
            x={-(edge.label.length * 3.5 + 8)}
            y="-10"
            width={edge.label.length * 7 + 16}
            height="20"
            rx="4"
          />
          <text
            class="edge-label"
            text-anchor="middle"
            dominant-baseline="central"
            fill="var(--c-text)"
            font-size="11"
          >
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

  if (edgeList.length === 0) return null;

  return (
    <svg
      aria-label="Canvas connections"
      role="img"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'visible',
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
        const fromNode = nodeMap.get(edge.from);
        const toNode = nodeMap.get(edge.to);
        if (!fromNode || !toNode) return null;
        const isConnected = hasFocus && (edge.from === focusId || edge.to === focusId);
        return (
          <EdgePath
            key={edge.id}
            edge={edge}
            fromNode={fromNode}
            toNode={toNode}
            focused={isConnected}
            dimmed={hasFocus && !isConnected}
          />
        );
      })}
    </svg>
  );
}
