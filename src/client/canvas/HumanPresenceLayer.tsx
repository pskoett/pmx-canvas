import { HUMAN_PRESENCE_TTL_MS } from '../../shared/human-presence.js';
import { viewport } from '../state/canvas-store';
import { otherHumans } from '../state/human-store';
import { useNow } from './use-now';

/**
 * Human collaborator cursors (rail-chrome-v2 phase 8, item 5): the other
 * render style of the presence layer — green arrow + name tag, never a phase
 * chip. Mounts whenever another tab is on the board, session or not (humans
 * collaborate on quiet boards too). World-space like the agent layer, glyph
 * counter-scaled so it keeps a constant screen size.
 */
export function HumanPresenceLayer() {
  // Staleness guard (0.5.0 readiness): an embedded pane whose stream stalls
  // (background throttling, dead SSE) kept painting ancient guest cursors from
  // its last frame. Cursors past the server TTL drop on the local clock even
  // when no fresh frame ever arrives.
  const now = useNow(otherHumans.value.length > 0 ? 5_000 : 0);
  const humans = otherHumans.value.filter(
    (human) =>
      human.cursor !== null &&
      (!human.lastSeenAt || now - Date.parse(human.lastSeenAt) < HUMAN_PRESENCE_TTL_MS + 5_000),
  );
  if (humans.length === 0) return null;
  const counterScale = 1 / Math.max(0.05, viewport.value.scale);
  return (
    <div class="human-presence-layer" aria-hidden="true">
      {humans.map((human) => (
        <div
          key={human.clientId}
          class={`human-cursor${human.grabbingNodeId ? ' is-grabbing' : ''}`}
          data-client-id={human.clientId}
          style={{ transform: `translate(${human.cursor!.x}px, ${human.cursor!.y}px)` }}
        >
          <div class="human-cursor-inner" style={{ transform: `scale(${counterScale})` }}>
            <svg class="human-cursor-glyph" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 2 L13 8 L8.5 9.5 L6.5 14 Z" fill="currentColor" stroke="var(--c-bg)" stroke-width="1" />
            </svg>
            <span class="human-cursor-tag">{human.name}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
