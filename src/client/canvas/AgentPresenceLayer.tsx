import { useRef } from 'preact/hooks';
import { agentPhaseLabel, type AgentPresence } from '../../shared/agent-presence.js';
import { nodes, viewport } from '../state/canvas-store';
import { agentPresences, presenceWorldPosition } from '../state/presence-store';

/**
 * Agent presence layer (rail-chrome-v2 phase 3): one cursor + phase chip per
 * live writer — attached sessions and external (unattached) writers alike. Lives inside the
 * world layer (like IntentLayer) so it pans and zooms with the board; the
 * glyph itself is counter-scaled so it stays a constant screen size. Moves
 * glide (220ms) — pans and zooms do not, because those move the world layer.
 *
 * Sibling of IntentLayer by design: ghosts show WHAT is about to change and
 * carry the veto; this layer shows WHERE the agent is and WHAT PHASE it is in.
 */
export function AgentPresenceLayer() {
  // Remember the last resolved position per writer so a cursor parked on a
  // node that was just removed stays where it was instead of vanishing.
  const lastPositions = useRef(new Map<string, { x: number; y: number }>());

  const scale = viewport.value.scale;
  const nodeMap = nodes.value;
  const counterScale = 1 / Math.max(0.05, scale);

  // Every live writer paints a cursor, attached session or not — an external
  // writer editing a quiet board is exactly when the human needs to see WHERE
  // it is working (user call, 2026-08-24). Unattached writers get the
  // `is-external` style; a board with no writers renders nothing. Attached
  // twins never double-paint (twin-merge folds an agent's channels into one
  // session), and an external writer's channels appear exactly as the
  // External-activity panel counts them.
  const cursors = agentPresences.value
    .map((presence) => {
      const resolved = presenceWorldPosition(presence, (id) => nodeMap.get(id));
      if (resolved) lastPositions.current.set(presence.sessionId, resolved);
      const position = resolved ?? lastPositions.current.get(presence.sessionId) ?? null;
      return position ? { presence, position } : null;
    })
    .filter((entry): entry is { presence: AgentPresence; position: { x: number; y: number } } => entry !== null);

  if (cursors.length === 0) return null;

  return (
    <div class="agent-presence-layer" aria-hidden="true">
      {cursors.map(({ presence, position }) => (
        <div
          key={presence.sessionId}
          class={`agent-cursor phase-${presence.phase}${presence.attached ? '' : ' is-external'}${presence.parentAgentId ? ' is-worker' : ''}`}
          data-session-id={presence.sessionId}
          style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
        >
          <div class="agent-cursor-inner" style={{ transform: `scale(${counterScale})` }}>
            <svg class="agent-cursor-glyph" width="16" height="18" viewBox="0 0 16 18" aria-hidden="true">
              <path
                d="M1.5 1.5L14.5 9.2 8.3 10.6 5.2 16.5z"
                fill="currentColor"
                stroke="var(--c-bg)"
                stroke-width="1.2"
              />
            </svg>
            <span class="agent-cursor-chip">
              <span class="agent-cursor-dot" />
              <span class="agent-cursor-label">{agentPhaseLabel(presence)}</span>
              <span class="agent-cursor-who">{presence.label}</span>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
