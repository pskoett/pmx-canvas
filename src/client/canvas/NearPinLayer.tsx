import { centerDistance } from '../../server/spatial-analysis.js';
import { nodes, toggleContextPin, viewport } from '../state/canvas-store';
import {
  closeNearCardSoon,
  keepNearCard,
  nearCard,
  nearPins,
  shownPinsFor,
  tetherFocus,
} from '../state/near-pin-store';
import type { CanvasNodeState } from '../types';
import { viewKey } from './NodeContextMark';

/** The brief's "near" radius (findNeighborhoods), in world px. */
const NEAR_RADIUS = 600;

interface Point {
  x: number;
  y: number;
}

/** Where the segment from `from` to the box's centre crosses the box's edge. */
function edgePoint(from: Point, box: { left: number; top: number; width: number; height: number }): Point {
  const to = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  const t = Math.min(
    dx === 0 ? Number.POSITIVE_INFINITY : box.width / 2 / Math.abs(dx),
    dy === 0 ? Number.POSITIVE_INFINITY : box.height / 2 / Math.abs(dy),
  );
  return t >= 1 ? to : { x: to.x + dx * t, y: to.y + dy * t };
}

function titleOf(node: CanvasNodeState): string {
  return typeof node.data.title === 'string' && node.data.title.trim() ? node.data.title : node.type;
}

/**
 * Which pin? (docs/design/NearPin.dc.html §2): for a hovered, selected or
 * dragged pin — or the pins a near chip asked to show — dotted tethers to its
 * neighbours, numbered nearest first, and the 600 px radius. Drawn in screen
 * space (architecture rule 9) so they stay legible at fit zoom; while an
 * unpinned node is dragged only the nearest pin's radius shows (§3).
 */
export function NearPinLayer() {
  const focus = tetherFocus.value;
  if (focus.pinIds.length === 0) return null;
  const v = viewport.value;
  const all = nodes.value;
  const near = nearPins.value;
  const toScreen = (x: number, y: number): Point => ({ x: x * v.scale + v.x, y: y * v.scale + v.y });

  return (
    <svg class="near-pin-layer" aria-hidden="true">
      {focus.pinIds.map((pinId) => {
        const pin = all.get(pinId);
        if (!pin) return null;
        const pinTopLeft = toScreen(pin.position.x, pin.position.y);
        const pinBox = {
          left: pinTopLeft.x,
          top: pinTopLeft.y,
          width: pin.size.width * v.scale,
          height: pin.size.height * v.scale,
        };
        const c = { x: pinBox.left + pinBox.width / 2, y: pinBox.top + pinBox.height / 2 };
        const r = NEAR_RADIUS * v.scale;
        const neighbours = focus.ringOnly
          ? []
          : [...near]
              .filter(([, pins]) => pins.some((entry) => entry.pinNodeId === pinId))
              .map(([id]) => all.get(id))
              .filter((node): node is CanvasNodeState => node !== undefined)
              .sort((a, b) => centerDistance(a, pin) - centerDistance(b, pin));
        return (
          <g key={pinId} data-pin-id={pinId}>
            <circle class="near-pin-radius" cx={c.x} cy={c.y} r={r} />
            <text class="near-pin-radius-label" x={c.x + r * 0.72} y={c.y + r * 0.72}>
              {NEAR_RADIUS} px from {titleOf(pin)}
            </text>
            {neighbours.map((node, index) => {
              const topLeft = toScreen(node.position.x, node.position.y);
              const box = {
                left: topLeft.x,
                top: topLeft.y,
                width: node.size.width * v.scale,
                height: node.size.height * v.scale,
              };
              // Edge to edge: the line never crosses either card's content.
              const end = edgePoint(c, box);
              const start = edgePoint({ x: box.left + box.width / 2, y: box.top + box.height / 2 }, pinBox);
              return (
                <g key={node.id} class="near-pin-tether" data-near-node={node.id}>
                  <path d={`M ${start.x} ${start.y} L ${end.x} ${end.y}`} />
                  <circle class="near-pin-number" cx={end.x} cy={end.y} r={10} />
                  <text class="near-pin-number-label" x={end.x} y={end.y}>
                    {index + 1}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Hover a near chip (docs/design/NearPin.dc.html §2): which pins, how far, and
 * the two ways on — pin it to put it first, or show the pins' tethers.
 */
export function NearPinCard() {
  const card = nearCard.value;
  if (!card || card.view !== viewKey()) return null;
  const node = nodes.value.get(card.nodeId);
  const near = nearPins.value.get(card.nodeId);
  if (!node || !near) return null;
  const showing = shownPinsFor.value === node.id;
  const left = Math.max(8, Math.min(card.at.right - 240, window.innerWidth - 248));
  return (
    <div
      class="near-hint"
      role="dialog"
      aria-label={near.length > 1 ? `Near ${near.length} pins` : 'Near a pin'}
      style={{ left: `${left}px`, top: `${card.at.bottom + 8}px` }}
      onPointerEnter={keepNearCard}
      onPointerLeave={closeNearCardSoon}
      onFocusIn={keepNearCard}
      onFocusOut={closeNearCardSoon}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span class="near-hint-label">{near.length > 1 ? `Near ${near.length} pins` : 'Near a pin'}</span>
      {near.map((pin) => {
        const pinNode = nodes.value.get(pin.pinNodeId);
        return (
          <span key={pin.pinNodeId} class="near-hint-row">
            <span class="near-hint-title">{pin.pinTitle}</span>
            {pinNode && <span class="near-hint-distance">{Math.round(centerDistance(node, pinNode))} px</span>}
          </span>
        );
      })}
      <span class="near-hint-body">
        The agent gets its title and a short summary because a pin is nearby. Pin it to put it first.
      </span>
      <span class="near-hint-actions">
        <button
          type="button"
          class="near-hint-pin"
          onClick={() => {
            nearCard.value = null;
            toggleContextPin(node.id);
          }}
        >
          Pin to put it first
        </button>
        <button
          type="button"
          class="near-hint-show"
          aria-pressed={showing}
          onClick={() => {
            shownPinsFor.value = showing ? null : node.id;
          }}
        >
          {showing ? 'Hide pins' : 'Show pins'}
        </button>
      </span>
    </div>
  );
}
