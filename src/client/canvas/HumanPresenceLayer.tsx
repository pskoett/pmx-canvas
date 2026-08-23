import { viewport } from '../state/canvas-store';
import { otherHumans } from '../state/human-store';

/**
 * Human collaborator cursors (rail-chrome-v2 phase 8, item 5): the other
 * render style of the presence layer — green arrow + name tag, never a phase
 * chip. Mounts whenever another tab is on the board, session or not (humans
 * collaborate on quiet boards too). World-space like the agent layer, glyph
 * counter-scaled so it keeps a constant screen size.
 */
export function HumanPresenceLayer() {
  const humans = otherHumans.value.filter((human) => human.cursor !== null);
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
