import { type Signal, computed, signal } from '@preact/signals';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import {
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
import { activeBoard } from '../state/boards-store';
import { reportClientViewportSize } from '../state/intent-bridge';
import { relationDefinition, relationKind, relationText } from '../../shared/relations.js';
import type { CanvasEdge, CanvasNodeState } from '../types';
import { relationFilter, relationFocus, relationHighlight } from '../state/relation-store';

/** Filter only the kinds on this board; shared presets are managed in Home. */
export function RelationLegend() {
  const board = activeBoard();
  const list = [...edges.value.values()];
  const legendRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const legend = legendRef.current;
    if (!legend) return;
    const observer = new ResizeObserver(() => void reportClientViewportSize());
    observer.observe(legend);
    return () => observer.disconnect();
  }, [board?.id, list.length > 0]);
  if (!board || list.length === 0) return null;
  const kinds = [...new Set(list.map(relationKind))];
  const selected = relationFilter.value?.boardId === board.id ? relationFilter.value.kind : null;
  return (
    <div
      ref={legendRef}
      class="relation-legend"
      aria-label="Relation legend"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <select
        aria-label="Filter board relations"
        value={selected ?? ''}
        onChange={(event) => {
          const kind = event.currentTarget.value;
          relationFilter.value = kind ? { boardId: board.id, kind } : null;
        }}
      >
        <option value="">All relations</option>
        {kinds.map((kind) => (
          <option key={kind} value={kind}>
            {kind} · {list.filter((edge) => relationKind(edge) === kind).length}
          </option>
        ))}
      </select>
      {kinds.map((kind) => {
        const definition = relationDefinition({ kind }, board.relationVocabulary);
        return (
          <button
            type="button"
            key={kind}
            aria-pressed={selected === kind}
            style={{ '--relation-ink': `var(--c-rel-${definition.ink})` }}
            onClick={() => {
              relationFilter.value = selected === kind ? null : { boardId: board.id, kind };
            }}
          >
            <span class="relation-swatch" aria-hidden="true" />
            {kind} <span class="relation-count">{list.filter((edge) => relationKind(edge) === kind).length}</span>
          </button>
        );
      })}
    </div>
  );
}

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
 * Who drew the link and when (docs/design/LinkAuthorship.dc.html): "Drawn by
 * Codex · 14:06", or, once someone else changed it, "You relabelled it · 14:20
 * (drawn by Codex · 14:06)". A folded "not seen" state joins it.
 */
function linkHint(edge: CanvasEdge, notSeen: boolean): string | null {
  // A link from before authorship was recorded names no one: "you" could be false.
  if (edge.changedBy?.actor !== 'agent' && edge.changedBy?.actor !== 'human') return null;
  const by = who(edge.changedBy);
  const takenOver = !!edge.createdBy && who(edge.createdBy) !== by;
  const lead = takenOver
    ? `${by === 'you' ? 'You' : by} relabelled it${clock(edge.changedAt)} (drawn by ${edge.createdBy ? who(edge.createdBy) : ''}${clock(edge.createdAt)})`
    : `${by === 'you' ? 'You drew it' : `Drawn by ${by}`}${clock(edge.createdAt ?? edge.changedAt)}`;
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

const edgeZoom = computed(() => viewport.value.scale);

function dashArray(edge: CanvasEdge, scale: number): string | undefined {
  const dashed = `${8 * scale} ${4 * scale}`;
  if (edge.style === 'dashed') return dashed;
  if (edge.style === 'dotted') return `${3 * scale} ${3 * scale}`;
  if (!edge.style && relationDefinition(edge, activeBoard()?.relationVocabulary).kind === 'related')
    return `${2 * scale} ${5 * scale}`;
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

interface LabelObstacle {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Nearest clear position along either axis through the original curve midpoint.
 * Expanded obstacles describe forbidden pill centres. Boundary candidates include
 * the outside of the whole occupied area, so even a crowded board has a solution.
 * World-space placement is independent of pan; all three layers use the same order.
 */
function placeLabel(
  mid: { x: number; y: number },
  width: number,
  height: number,
  obstacles: LabelObstacle[],
  gap: number,
) {
  const forbidden = obstacles.map((box) => ({
    left: box.x - width / 2 - gap,
    right: box.x + box.width + width / 2 + gap,
    top: box.y - height / 2 - gap,
    bottom: box.y + box.height + height / 2 + gap,
  }));
  const clear = (point: { x: number; y: number }) =>
    forbidden.every(
      (box) => point.x <= box.left || point.x >= box.right || point.y <= box.top || point.y >= box.bottom,
    );
  if (clear(mid)) return mid;
  const candidates = [mid];
  for (const box of forbidden) {
    if (mid.x > box.left && mid.x < box.right) {
      candidates.push({ x: mid.x, y: box.top }, { x: mid.x, y: box.bottom });
    }
    if (mid.y > box.top && mid.y < box.bottom) {
      candidates.push({ x: box.left, y: mid.y }, { x: box.right, y: mid.y });
    }
  }
  const distance = (point: { x: number; y: number }) => (point.x - mid.x) ** 2 + (point.y - mid.y) ** 2;
  candidates.sort((a, b) => distance(a) - distance(b));
  return candidates.find(clear)!;
}

// ── EdgePath component ───────────────────────────────────────
interface EdgePathProps {
  edge: CanvasEdge;
  fromNode: CanvasNodeState;
  toNode: CanvasNodeState;
  layout: ReturnType<typeof edgeLayout>;
  focused: boolean; // connected to the active node
  dimmed: boolean; // active node exists but this edge is NOT connected
  selected: boolean; // click-selected — Delete removes it
  scale: number; // inverse-viewport compensation, see edgeChromeScale()
  part: EdgeLayerPart;
}

/**
 * Lines draw below group frames, so a link never covers a group's header; pills
 * draw in their own layer above the frames, so a link inside a group keeps a
 * label (LinkAuthorship.dc.html). Transparent pill hits stay below ports without
 * moving the painted label below the frame's wash.
 */
export type EdgeLayerPart = 'lines' | 'pills' | 'pill-hits';

function edgeLayout(
  edge: CanvasEdge,
  start: Anchor,
  end: Anchor,
  scale: number,
  obstacles: LabelObstacle[],
  textWidth: (text: string, weight?: number) => number,
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const curvature = Math.min(Math.max(dist * 0.35, 32), 160);

  const cp1 = sideControlPoint(start, curvature);
  const cp2 = sideControlPoint(end, curvature);

  const d = `M ${start.x} ${start.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${end.x} ${end.y}`;
  const definition = relationDefinition(edge, activeBoard()?.relationVocabulary);
  const color = `var(--c-rel-${definition.ink})`;
  const directed = definition.directed;
  const dash = dashArray(edge, scale);

  // Labels keep a constant screen size only while nodes are still readable —
  // label chrome caps like node chrome (2.2). Below 35% zoom the label goes and
  // only the link's marks stay (LinkAuthorship.dc.html).
  const labelScale = Math.min(scale, 2.2);
  const zoom = edgeZoom.value;
  const marks = linkMarks(edge);
  // Reasons belong in the hint/inspector, not a long pill covering both endpoints.
  const label = edge.label ?? edge.kind;
  const showLabel = !!label && zoom >= 0.35;
  // Pill layout in label units (× labelScale): the label, then a hairline and
  // "not seen by …", which keeps only its glyph on a short line or below 60% zoom.
  const pad = showLabel ? 9 : 5;
  const labelWidth = showLabel ? textWidth(label) : 0;
  const notSeenText = `not seen by ${agentName()}`;
  const wordedNotSeenWidth = 12 + textWidth(notSeenText, 500) + 4;
  const fullWidth = pad * 2 + labelWidth + (marks.notSeen ? (labelWidth ? 12 : 0) + wordedNotSeenWidth : 0);
  // A short line: the full pill plus some line on either side would not fit.
  const notSeenWords = marks.notSeen && zoom >= 0.6 && dist >= (fullWidth + 60) * labelScale;
  const notSeenWidth = marks.notSeen ? (labelWidth ? 12 : 0) + (notSeenWords ? wordedNotSeenWidth : 12) : 0;
  const pillWidth = pad * 2 + labelWidth + notSeenWidth;
  const labelX = -pillWidth / 2 + pad;
  const notSeenX = labelX + labelWidth + (labelWidth ? 12 : 0);
  const hasPill = showLabel || marks.notSeen;
  const curveMid = hasPill ? bezierMidpoint(start.x, start.y, cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y) : null;
  const mid = curveMid ? placeLabel(curveMid, pillWidth * labelScale, 20 * labelScale, obstacles, 4 * scale) : null;
  if (mid) {
    obstacles.push({
      x: mid.x - (pillWidth / 2) * labelScale,
      y: mid.y - 10 * labelScale,
      width: pillWidth * labelScale,
      height: 20 * labelScale,
    });
  }
  return {
    d,
    color,
    directed,
    dash,
    labelScale,
    marks,
    label,
    showLabel,
    labelWidth,
    notSeenText,
    notSeenWords,
    pillWidth,
    labelX,
    notSeenX,
    curveMid,
    mid,
  };
}

function EdgePath({ edge, fromNode, toNode, layout, focused, dimmed, selected, scale, part }: EdgePathProps) {
  const {
    d,
    color,
    directed,
    dash,
    labelScale,
    marks,
    label,
    showLabel,
    labelWidth,
    notSeenText,
    notSeenWords,
    pillWidth,
    labelX,
    notSeenX,
    curveMid,
    mid,
  } = layout;

  const pathId = `edge-path-${edge.id}`;
  const select = (e: MouseEvent) => {
    // The viewport's background click clears the selection — a click
    // that LANDED on an edge must not immediately undo itself.
    e.stopPropagation();
    selectedEdgeId.value = edge.id;
  };
  const showHint = (anchor: Element, point?: { x: number; y: number }) => {
    const text = [
      `${String(fromNode.data.title ?? fromNode.id)} → ${String(toNode.data.title ?? toNode.id)}`,
      relationText(edge),
      linkHint(edge, marks.notSeen),
    ]
      .filter(Boolean)
      .join('\n');
    const rect = anchor.getBoundingClientRect();
    edgeHint.value = {
      x: point?.x ?? rect.left + rect.width / 2,
      y: (point?.y ?? rect.bottom) + 8,
      text,
      edgeId: edge.id,
      view: viewport.value,
    };
  };
  const hideHint = () => {
    edgeHint.value = null;
  };

  if (part === 'pill-hits') {
    if (!mid) return null;
    return (
      <rect
        class="edge-pill-hit"
        data-testid="edge-pill-hit"
        data-edge-id={edge.id}
        x={mid.x - (pillWidth / 2) * labelScale}
        y={mid.y - 10 * labelScale}
        width={pillWidth * labelScale}
        height={20 * labelScale}
        rx={10 * labelScale}
        fill="transparent"
        onClick={select}
        onPointerEnter={(e) => showHint(e.currentTarget)}
        onPointerLeave={hideHint}
      />
    );
  }

  if (part === 'pills') {
    if (!mid) return null;
    return (
      <g
        transform={`translate(${mid.x}, ${mid.y})`}
        class="edge-pill"
        data-testid="edge-pill"
        data-edge-id={edge.id}
        opacity={dimmed && !selected ? 0.35 : 1}
      >
        <rect
          class="edge-label-bg"
          x={(-pillWidth / 2) * labelScale}
          y={-10 * labelScale}
          width={pillWidth * labelScale}
          height={20 * labelScale}
          rx={10 * labelScale}
        />
        {showLabel && (
          <text
            class="edge-label"
            x={(labelX + labelWidth / 2) * labelScale}
            text-anchor="middle"
            dominant-baseline="central"
            fill={color}
          >
            {label}
          </text>
        )}
        {marks.notSeen && (
          <g class="edge-link-mark is-not-seen" data-testid="edge-link-mark">
            {labelWidth > 0 && (
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
      {/* A displaced label remains attached to its original curve, not a new
          relation. No arrow; same semantic ink, below cards like the curve. */}
      {mid && curveMid && (mid.x !== curveMid.x || mid.y !== curveMid.y) && (
        <line
          data-testid="edge-label-leader"
          data-edge-id={edge.id}
          x1={curveMid.x}
          y1={curveMid.y}
          x2={mid.x}
          y2={mid.y}
          stroke={color}
          stroke-width={scale}
          stroke-dasharray={`${3 * scale} ${3 * scale}`}
          opacity={dimmed && !selected ? 0.2 : 0.85}
        />
      )}
      {/* Invisible wide hitbox — the ONE interactive part of the edge layer
          (the svg itself is pointer-events:none): click selects the edge
          (Delete then removes it); usePanZoom owns right-click versus drag. */}
      <path
        data-edge-id={edge.id}
        d={d}
        fill="none"
        stroke="transparent"
        stroke-width={12 * scale}
        style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
        onClick={select}
        onPointerEnter={(e) => showHint(e.currentTarget, { x: e.clientX, y: e.clientY })}
        onPointerLeave={hideHint}
      />

      {/* Visible edge — the `edge-arrow` marker uses the default
          markerUnits="strokeWidth", so the arrowhead scales with this. */}
      <path
        id={pathId}
        d={d}
        class={selected ? 'edge-line edge-selected' : 'edge-line'}
        fill="none"
        stroke={color}
        stroke-width={(selected ? 3 : focused ? 2.5 : 1.5) * scale}
        stroke-dasharray={dash}
        marker-end={directed ? 'url(#edge-arrow)' : undefined}
        opacity={selected ? 1 : dimmed ? 0.2 : focused ? 1 : 0.85}
        style={{ color }}
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
}

export function EdgeLayer({ nodes, edges }: EdgeLayerProps) {
  const textContext = useMemo(() => document.createElement('canvas').getContext('2d'), []);
  const font = useMemo(
    () =>
      signal({
        family: getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim() || 'sans-serif',
        version: 0,
      }),
    [],
  );
  useLayoutEffect(() => {
    // Re-measure when Plex replaces the fallback font, without waiting for a
    // pan/zoom. All three paint/hit layers share the same glyph advances.
    const refresh = () => {
      font.value = {
        family: getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim() || 'sans-serif',
        version: font.value.version + 1,
      };
    };
    document.fonts?.addEventListener('loadingdone', refresh);
    return () => document.fonts?.removeEventListener('loadingdone', refresh);
  }, []);
  const geometry = useMemo(
    () =>
      computed(() => {
        const family = font.value.family;
        const textWidth = (text: string, weight = 400) => {
          // Non-rendering DOMs have no canvas context. Keep their bounds conservative.
          if (!textContext) return text.length * 11;
          textContext.font = `${weight} 11px ${family}`;
          const metrics = textContext.measureText(text);
          return Math.ceil(Math.max(metrics.width, metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight));
        };
        const nodeMap = nodes.value;
        const edgeList = Array.from(edges.value.values());
        const scale = edgeChromeScale(edgeZoom.value);

        // Allocate a port to every incident link, including parallel and reverse links.
        const ports = new Map<string, { start: Anchor; end: Anchor }>();
        const sides = new Map<string, Array<{ anchor: Anchor; node: CanvasNodeState; order: number; id: string }>>();
        for (const edge of edgeList) {
          if (edge.toBoardId) continue;
          const from = visibleNodeFor(edge.from);
          const to = visibleNodeFor(edge.to);
          if (!from || !to || from.id === to.id) continue;
          const start = computeAnchor(from, to);
          const end = computeAnchor(to, from);
          ports.set(edge.id, { start, end });
          for (const [anchor, node, other] of [
            [start, from, to],
            [end, to, from],
          ] as const) {
            const key = `${node.id}:${anchor.side}`;
            const vertical = anchor.side === 'left' || anchor.side === 'right';
            const group = sides.get(key) ?? [];
            group.push({ anchor, node, order: vertical ? other.position.y : other.position.x, id: edge.id });
            sides.set(key, group);
          }
        }
        for (const group of sides.values()) {
          if (group.length < 2) continue;
          group.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
          group.forEach(({ anchor, node }, index) => {
            const fraction = (index + 1) / (group.length + 1);
            if (anchor.side === 'left' || anchor.side === 'right')
              anchor.y = node.position.y + node.size.height * fraction;
            else anchor.x = node.position.x + node.size.width * fraction;
          });
        }

        // Reserve the actual four outward handle rectangles, not a padded card:
        // padding the whole card falsely closes row gaps at fractional zoom.
        // Expanded groups have only their 24px edge row, and no ports.
        const obstacles: LabelObstacle[] = [];
        const portSize = 32 / edgeZoom.value;
        for (const node of nodeMap.values()) {
          if (visibleNodeFor(node.id)?.id !== node.id) continue;
          const frame = node.type === 'group' && !node.collapsed;
          const { x, y } = node.position;
          const { width, height } = node.size;
          obstacles.push({
            x,
            y: y - (frame ? 12 : 0),
            width,
            height: frame ? 24 : height,
          });
          if (node.type !== 'group') {
            for (const [px, py] of [
              [x + width / 2 - portSize / 2, y - portSize],
              [x + width / 2 - portSize / 2, y + height],
              [x - portSize, y + height / 2 - portSize / 2],
              [x + width, y + height / 2 - portSize / 2],
            ]) {
              obstacles.push({ x: px, y: py, width: portSize, height: portSize });
            }
          }
        }
        const layouts = new Map<string, ReturnType<typeof edgeLayout>>();
        for (const edge of edgeList) {
          const anchors = ports.get(edge.id);
          if (anchors) layouts.set(edge.id, edgeLayout(edge, anchors.start, anchors.end, scale, obstacles, textWidth));
        }
        return { nodeMap, edgeList, layouts, scale };
      }),
    [nodes, edges, textContext, font],
  );

  const { nodeMap, edgeList, layouts, scale } = geometry.value;
  const focusId = relationFocus.value;
  const hasFocus = focusId !== null;
  const searchSet = searchHighlightIds.value;
  const hasSearch = searchSet !== null;

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
    <>
      {(['lines', 'pills', 'pill-hits'] as const).map((part) =>
        // A drag-to-connect preview must draw on a board with no edges yet.
        edgeList.length === 0 && (part !== 'lines' || !draggingEdge.value) ? null : (
          <svg
            key={part}
            aria-label={part === 'lines' ? 'Canvas connections' : undefined}
            aria-hidden={part !== 'lines' ? 'true' : undefined}
            role={part === 'lines' ? 'img' : undefined}
            viewBox={`${minX} ${minY} ${width} ${height}`}
            width={width}
            height={height}
            style={{
              position: 'absolute',
              top: `${minY}px`,
              left: `${minX}px`,
              // Painting stays unchanged. Hit priority is card > port > pill > group
              // interior > line, including raised and nested group frames.
              zIndex:
                part === 'pills'
                  ? 1
                  : part === 'pill-hits'
                    ? 'calc(var(--node-port-z, -1) - 1)'
                    : 'var(--edge-line-z, -5)',
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
                <path d="M 0 1 L 10 5 L 0 9 z" fill="context-stroke" opacity="0.75" />
              </marker>
            </defs>
            {edgeList.map((edge) => {
              // Remote endpoints are navigable links, never a same-ID card on this board.
              if (edge.toBoardId) return null;
              // An endpoint hidden behind a collapsed group's chip is drawn to the chip.
              const fromNode = visibleNodeFor(edge.from);
              const toNode = visibleNodeFor(edge.to);
              const layout = layouts.get(edge.id);
              if (!fromNode || !toNode || !layout) return null;
              const isConnected = hasFocus && (edge.from === focusId || edge.to === focusId);
              const searchDimmed = hasSearch && !(searchSet.has(edge.from) || searchSet.has(edge.to));
              const highlight = relationHighlight.value;
              return (
                <EdgePath
                  key={edge.id}
                  edge={edge}
                  fromNode={fromNode}
                  toNode={toNode}
                  layout={layout}
                  focused={isConnected}
                  dimmed={(highlight !== null && !highlight.links.has(edge.id)) || searchDimmed}
                  selected={selectedEdgeId.value === edge.id}
                  scale={scale}
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
        ),
      )}
    </>
  );
}
