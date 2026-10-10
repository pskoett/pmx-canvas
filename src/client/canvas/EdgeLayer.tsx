import { type Signal, signal } from '@preact/signals';
import {
  activeNodeId,
  draggingEdge,
  edges,
  searchHighlightIds,
  selectedEdgeId,
  viewport,
  visibleNodeFor,
} from '../state/canvas-store';
import { linkMarks, writerName } from '../state/context-status-store';
import { HUMAN_STARTED_SESSION_LABEL } from '../../shared/agent-presence';
import { activeSession } from '../state/presence-store';
import type { CanvasEdge, CanvasNodeState } from '../types';

// ── Edge type visual styles ──────────────────────────────────
const EDGE_COLORS: Record<CanvasEdge['type'], string> = {
  relation: 'var(--c-muted)',
  'depends-on': 'var(--c-rel-informs)',
  flow: 'var(--c-accent)',
  // --c-dim is a very low-contrast hairline in dark palettes (forest: #5D7566
  // on #0C1712); the dashed style is what distinguishes `references`.
  references: 'var(--c-muted)',
};

const DIRECTED_TYPES = new Set<CanvasEdge['type']>(['depends-on', 'flow']);

/** The attached agent's name; a session you started that no agent has joined yet names no one. */
function agentName(): string {
  const label = activeSession.value?.label;
  return label && label !== HUMAN_STARTED_SESSION_LABEL ? label : 'the agent';
}

/** The hovered link pill's hint, drawn at screen level by `EdgeHint` (the edge layer is SVG in world space). */
const edgeHint = signal<{ x: number; y: number; text: string; edgeId: string; view: unknown } | null>(null);

function clock(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : ` · ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function who(actor: NonNullable<CanvasEdge['changedBy']>): string {
  return actor.actor === 'agent' ? writerName(actor) : 'you';
}

/**
 * Who drew the link and when (docs/design/LinkAuthorship.dc.html): "✦ Drawn by
 * Codex · 14:06", or, once someone else changed it, "You relabelled it · 14:20
 * (drawn by Codex · 14:06)". A folded "not seen" state joins it.
 */
function linkHint(edge: CanvasEdge, notSeen: boolean): string | null {
  // A link from before authorship was recorded names no one: "you" could be false.
  if (edge.changedBy?.actor !== 'agent' && edge.changedBy?.actor !== 'human') return null;
  const by = who(edge.changedBy);
  const agent = edge.changedBy.actor === 'agent';
  const takenOver = !!edge.createdBy && who(edge.createdBy) !== by;
  const lead = takenOver
    ? `${agent ? '✦ ' : ''}${by === 'you' ? 'You' : by} relabelled it${clock(edge.changedAt)} (drawn by ${edge.createdBy ? who(edge.createdBy) : ''}${clock(edge.createdAt)})`
    : `${agent ? '✦ ' : ''}${by === 'you' ? 'You drew it' : `Drawn by ${by}`}${clock(edge.createdAt ?? edge.changedAt)}`;
  return notSeen ? `${lead} · not seen by ${agentName()} yet` : lead;
}

/** The link pill's hint, outside the zoomed canvas so it keeps screen size and is never clipped. */
export function EdgeHint() {
  const hint = edgeHint.value;
  // The pill can vanish or move under a resting pointer (the link removed, the
  // view panned or zoomed) without a pointerleave: the hint goes with it.
  if (!hint || hint.view !== viewport.value || !edges.value.has(hint.edgeId)) return null;
  return (
    <span
      class="toolbar-tooltip edge-hint"
      role="tooltip"
      data-testid="edge-hint"
      style={{ left: `${hint.x}px`, top: `${hint.y}px` }}
    >
      <span class="toolbar-tooltip-label">{hint.text}</span>
    </span>
  );
}

// Connection-change glyphs (docs/design/LinksOptions.dc.html, option C), 24-unit paths.
const LINK_MARK_EYE_OFF =
  'M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3 3.6M6.6 6.6C3.8 8.3 2 12 2 12s3.5 6 10 6a9.6 9.6 0 0 0 4.4-1';
const LINK_MARK_SPARK = 'M12 2l2.2 6.6L21 11l-6.8 2.4L12 20l-2.2-6.6L3 11l6.8-2.4z';

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
type Side = 'top' | 'bottom' | 'left' | 'right';

interface Anchor {
  x: number;
  y: number;
  side: Side;
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
      side: sign > 0 ? 'bottom' : 'top',
    };
  }

  // Left or right
  const sign = dx > 0 ? 1 : -1;
  return {
    x: cx + hw * sign,
    y: cy + tanAngle * hw * (dy > 0 ? 1 : -1),
    side: sign > 0 ? 'right' : 'left',
  };
}

/**
 * Control point extending from an anchor along its side's outward normal —
 * the edge leaves/enters a card perpendicular to the border and bends toward
 * the other endpoint, instead of degenerating into a straight segment (which
 * is what control points placed along the direct line produce).
 */
function sideControlPoint(anchor: Anchor, curvature: number): { x: number; y: number } {
  switch (anchor.side) {
    case 'top':
      return { x: anchor.x, y: anchor.y - curvature };
    case 'bottom':
      return { x: anchor.x, y: anchor.y + curvature };
    case 'left':
      return { x: anchor.x - curvature, y: anchor.y };
    case 'right':
      return { x: anchor.x + curvature, y: anchor.y };
  }
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
  selected: boolean; // click-selected — Delete removes it
  scale: number; // inverse-viewport compensation, see edgeChromeScale()
  onContextMenu?: (e: MouseEvent, edgeId: string) => void;
  part: EdgeLayerPart;
}

/**
 * Lines draw below group frames, so a link never covers a group's header; pills
 * draw in their own layer above the frames, so a link inside a group keeps a
 * hoverable, clickable label (LinkAuthorship.dc.html).
 */
export type EdgeLayerPart = 'lines' | 'pills';

function EdgePath({ edge, fromNode, toNode, focused, dimmed, selected, scale, onContextMenu, part }: EdgePathProps) {
  const start = computeAnchor(fromNode, toNode);
  const end = computeAnchor(toNode, fromNode);

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const curvature = Math.min(Math.max(dist * 0.35, 32), 160);

  const cp1 = sideControlPoint(start, curvature);
  const cp2 = sideControlPoint(end, curvature);

  const d = `M ${start.x} ${start.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${end.x} ${end.y}`;
  const color = EDGE_COLORS[edge.type];
  const directed = DIRECTED_TYPES.has(edge.type);
  const dash = dashArray(edge, scale);

  // Labels keep a constant screen size only while nodes are still readable —
  // label chrome caps like node chrome (2.2). Below 35% zoom the label goes and
  // only the link's marks stay (LinkAuthorship.dc.html).
  const labelScale = Math.min(scale, 2.2);
  const zoom = viewport.value.scale;
  const marks = linkMarks(edge);
  const showLabel = !!edge.label && zoom >= 0.35;
  // Pill layout in label units (× labelScale): ✦, the label, then a hairline and
  // "not seen by …", which keeps only its glyph on a short line or below 60% zoom.
  const pad = showLabel ? 9 : 5;
  const sparkWidth = marks.agent ? 12 : 0;
  const labelWidth = showLabel ? (edge.label?.length ?? 0) * 7 : 0;
  const notSeenText = `not seen by ${agentName()}`;
  const wordedNotSeenWidth = 12 + notSeenText.length * 6.2 + 4;
  const fullWidth =
    pad * 2 +
    sparkWidth +
    (sparkWidth && labelWidth ? 5 : 0) +
    labelWidth +
    (marks.notSeen ? (sparkWidth || labelWidth ? 12 : 0) + wordedNotSeenWidth : 0);
  // A short line: the full pill plus some line on either side would not fit.
  const notSeenWords = marks.notSeen && zoom >= 0.6 && dist >= (fullWidth + 60) * labelScale;
  const notSeenWidth = marks.notSeen
    ? (sparkWidth || labelWidth ? 12 : 0) + (notSeenWords ? wordedNotSeenWidth : 12)
    : 0;
  const pillWidth = pad * 2 + sparkWidth + (sparkWidth && labelWidth ? 5 : 0) + labelWidth + notSeenWidth;
  const left = -pillWidth / 2 + pad;
  const labelX = left + sparkWidth + (sparkWidth && labelWidth ? 5 : 0);
  const notSeenX = labelX + labelWidth + (sparkWidth || labelWidth ? 12 : 0);
  const hasPill = showLabel || !!marks.agent || marks.notSeen;
  const mid = hasPill ? bezierMidpoint(start.x, start.y, cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y) : null;

  const pathId = `edge-path-${edge.id}`;
  const select = (e: MouseEvent) => {
    // The viewport's background click clears the selection — a click
    // that LANDED on an edge must not immediately undo itself.
    e.stopPropagation();
    selectedEdgeId.value = edge.id;
  };

  if (part === 'pills') {
    if (!mid) return null;
    return (
      <g
        transform={`translate(${mid.x}, ${mid.y})`}
        class="edge-pill"
        data-testid="edge-pill"
        opacity={dimmed && !selected ? 0.35 : 1}
        onClick={select}
        onDblClick={onContextMenu ? (e) => onContextMenu(e as unknown as MouseEvent, edge.id) : undefined}
        onPointerEnter={(e) => {
          const text = linkHint(edge, marks.notSeen);
          if (!text) return;
          const rect = (e.currentTarget as SVGGElement).getBoundingClientRect();
          edgeHint.value = {
            x: rect.left + rect.width / 2,
            y: rect.bottom + 8,
            text,
            edgeId: edge.id,
            view: viewport.value,
          };
        }}
        onPointerLeave={() => {
          edgeHint.value = null;
        }}
      >
        <rect
          class="edge-label-bg"
          x={(-pillWidth / 2) * labelScale}
          y={-10 * labelScale}
          width={pillWidth * labelScale}
          height={20 * labelScale}
          rx={10 * labelScale}
        />
        {marks.agent && (
          <path
            class="edge-link-spark"
            data-testid="edge-link-agent"
            transform={`translate(${left * labelScale}, ${-6 * labelScale}) scale(${(12 / 24) * labelScale})`}
            d={LINK_MARK_SPARK}
          />
        )}
        {showLabel && (
          <text
            class="edge-label"
            x={(labelX + labelWidth / 2) * labelScale}
            text-anchor="middle"
            dominant-baseline="central"
            fill="var(--c-text)"
          >
            {edge.label}
          </text>
        )}
        {marks.notSeen && (
          <g class="edge-link-mark is-not-seen" data-testid="edge-link-mark">
            {(sparkWidth > 0 || labelWidth > 0) && (
              <line
                x1={(notSeenX - 6) * labelScale}
                x2={(notSeenX - 6) * labelScale}
                y1={-6 * labelScale}
                y2={6 * labelScale}
                stroke="var(--c-line)"
                stroke-width={labelScale}
              />
            )}
            <path
              transform={`translate(${notSeenX * labelScale}, ${-5 * labelScale}) scale(${(10 / 24) * labelScale})`}
              d={LINK_MARK_EYE_OFF}
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            {notSeenWords && (
              <text
                class="edge-label"
                x={(notSeenX + 14) * labelScale}
                text-anchor="start"
                dominant-baseline="central"
                fill="currentColor"
              >
                {notSeenText}
              </text>
            )}
          </g>
        )}
      </g>
    );
  }

  return (
    <g>
      {/* Invisible wide hitbox — the ONE interactive part of the edge layer
          (the svg itself is pointer-events:none): click selects the edge
          (Delete then removes it), double-click opens the edge menu. */}
      <path
        d={d}
        fill="none"
        stroke="transparent"
        stroke-width={12 * scale}
        style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
        onClick={select}
        onDblClick={onContextMenu ? (e) => onContextMenu(e as unknown as MouseEvent, edge.id) : undefined}
      />

      {/* Glow layer for focused or selected edges */}
      {(focused || selected) && (
        <path
          d={d}
          fill="none"
          stroke={color}
          stroke-width={6 * scale}
          stroke-dasharray={dash}
          opacity={selected ? 0.3 : 0.15}
          style={{ filter: 'blur(3px)' }}
        />
      )}

      {/* Visible edge — the `edge-arrow` marker uses the default
          markerUnits="strokeWidth", so the arrowhead scales with this. */}
      <path
        id={pathId}
        d={d}
        class={selected ? 'edge-selected' : undefined}
        fill="none"
        stroke={color}
        stroke-width={(selected ? 3 : focused ? 2.5 : 1.5) * scale}
        stroke-dasharray={dash}
        marker-end={directed ? 'url(#edge-arrow)' : undefined}
        opacity={selected ? 1 : dimmed ? 0.2 : focused ? 1 : 0.85}
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
    </g>
  );
}

// ── EdgeLayer ────────────────────────────────────────────────
interface EdgeLayerProps {
  nodes: Signal<Map<string, CanvasNodeState>>;
  edges: Signal<Map<string, CanvasEdge>>;
  onEdgeContextMenu?: (e: MouseEvent, edgeId: string) => void;
  part: EdgeLayerPart;
}

export function EdgeLayer({ nodes, edges, onEdgeContextMenu, part }: EdgeLayerProps) {
  const nodeMap = nodes.value;
  const edgeList = Array.from(edges.value.values());
  const focusId = activeNodeId.value;
  const hasFocus = focusId !== null;
  const searchSet = searchHighlightIds.value;
  const hasSearch = searchSet !== null;
  const scale = edgeChromeScale(viewport.value.scale);

  // A drag-to-connect preview must draw on a board with no edges yet.
  if (edgeList.length === 0 && (part === 'pills' || !draggingEdge.value)) return null;

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
      aria-label={part === 'lines' ? 'Canvas connections' : undefined}
      aria-hidden={part === 'pills' ? 'true' : undefined}
      role={part === 'lines' ? 'img' : undefined}
      viewBox={`${minX} ${minY} ${width} ${height}`}
      width={width}
      height={height}
      style={{
        position: 'absolute',
        top: `${minY}px`,
        left: `${minX}px`,
        // Pills sit above group frames (z 0) and below cards (z 1, later in the
        // DOM); lines stay under the frames. Neither layer takes the pointer
        // itself; only hit paths and pills do.
        ...(part === 'pills' ? { zIndex: 1 } : {}),
        pointerEvents: 'none',
        overflow: 'visible',
        '--edge-chrome-scale': scale.toFixed(3),
        '--edge-label-scale': Math.min(scale, 2.2).toFixed(3),
      }}
    >
      {part === 'lines' && <title>Canvas connections</title>}
      <defs>
        {/* userSpaceOnUse decouples the arrowhead from the UNCAPPED stroke
            compensation: the line stays a visible hairline at any zoom, but
            the head caps at the node-chrome scale (2.2) instead of dwarfing
            sliver nodes at overview zoom. */}
        <marker
          id="edge-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerUnits="userSpaceOnUse"
          markerWidth={8 * Math.min(scale, 2.2)}
          markerHeight={8 * Math.min(scale, 2.2)}
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
            selected={selectedEdgeId.value === edge.id}
            scale={scale}
            onContextMenu={onEdgeContextMenu}
            part={part}
          />
        );
      })}
      {/* Live preview edge while drag-connecting */}
      {part === 'lines' &&
        draggingEdge.value &&
        (() => {
          const de = draggingEdge.value;
          // Route the preview EXACTLY like the committed edge will route
          // (side-tangent anchors against a 1px rect at the cursor) — the old
          // collinear preview made the line visibly JUMP on release.
          const fromNode = visibleNodeFor(de.fromId);
          const cursorRect = {
            position: { x: de.cursorX, y: de.cursorY },
            size: { width: 1, height: 1 },
          } as CanvasNodeState;
          let previewD: string;
          if (fromNode) {
            const start = computeAnchor(fromNode, cursorRect);
            const end = computeAnchor(cursorRect, fromNode);
            const pdx = end.x - start.x;
            const pdy = end.y - start.y;
            const pdist = Math.sqrt(pdx * pdx + pdy * pdy);
            const curvature = Math.min(Math.max(pdist * 0.35, 32), 160);
            const cp1 = sideControlPoint(start, curvature);
            const cp2 = sideControlPoint(end, curvature);
            previewD = `M ${start.x} ${start.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${end.x} ${end.y}`;
          } else {
            const dx = de.cursorX - de.fromX;
            const dy = de.cursorY - de.fromY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const curve = Math.min(dist * 0.25, 80);
            const nx = dx / (dist || 1);
            const ny = dy / (dist || 1);
            previewD = `M ${de.fromX} ${de.fromY} C ${de.fromX + nx * curve} ${de.fromY + ny * curve}, ${de.cursorX - nx * curve} ${de.cursorY - ny * curve}, ${de.cursorX} ${de.cursorY}`;
          }
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
