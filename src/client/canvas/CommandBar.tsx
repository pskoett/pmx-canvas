import { useState } from 'preact/hooks';
import { IconSteer } from '../icons';
import { contextPinnedNodeIds, nodes, toggleContextPin } from '../state/canvas-store';
import { steerableAgents } from '../state/presence-store';
import { sendSteering } from '../state/session-store';
import { modChord } from '../utils/platform';

/**
 * Command bar (rail-chrome-v2 phase 5): the human's steering surface while a
 * session is attached — the design's floating composer, centered at the
 * bottom of the canvas region. Above it, the pinned context as gold ✦ chips
 * (× unpins — the same pin the node's own control toggles); the composer row
 * posts an AX steering message to the session. The context-budget meter lives
 * in the top bar (`ContextBudget`), where the mockup puts it. Replaces the
 * quiet board's pin bar only while attached.
 */
export function CommandBar() {
  const pinnedIds = [...contextPinnedNodeIds.value];
  const nodeMap = nodes.value;
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // Addressed steering: the picker lists the CONNECTED agents (live presences,
  // sessions first) and shows only when there is a real choice. A picked agent
  // that detaches or expires falls back to "All agents" — presence is the
  // source of truth for who can still claim a delivery.
  const agents = steerableAgents.value;
  const [target, setTarget] = useState<string | null>(null);
  // The picker only earns its place when the roster offers a real choice or
  // real information: two or more rows. A LONE steerable agent needs no
  // dropdown — steers auto-address it (the placeholder names it), which also
  // keeps stale broadcasts from leaking to agents that join later.
  const showPicker = agents.length >= 2;
  const soloTarget = !showPicker && agents.length === 1 && agents[0]!.steerable ? agents[0]! : null;
  // A picked agent that loses its inbox (or leaves) falls back to All —
  // steers must never keep targeting a roster row that cannot receive.
  const effective = showPicker
    ? target
      ? (agents.find((agent) => agent.value === target && agent.steerable) ?? null)
      : null
    : soloTarget;
  const effectiveTarget = effective?.value ?? null;

  const submit = async () => {
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true);
    const ok = await sendSteering(message, effectiveTarget);
    setSending(false);
    if (ok) setDraft('');
  };

  return (
    <div class="command-bar" data-testid="command-bar">
      {pinnedIds.length > 0 && (
        <div class="command-bar-chips" aria-label="Pinned context">
          {pinnedIds.map((id) => {
            const node = nodeMap.get(id);
            const title =
              typeof node?.data.title === 'string' && node.data.title.trim() ? node.data.title : (node?.type ?? id);
            return (
              <span key={id} class="command-bar-chip" data-node-id={id}>
                <span class="command-bar-chip-glyph" aria-hidden="true">
                  ✦
                </span>
                <span class="command-bar-chip-label" title={title}>
                  {title}
                </span>
                <button
                  type="button"
                  class="command-bar-chip-unpin"
                  aria-label={`Unpin ${title}`}
                  title="Remove from context"
                  onClick={() => toggleContextPin(id)}
                >
                  ×
                </button>
              </span>
            );
          })}
          <span class="command-bar-chips-note">in agent context</span>
        </div>
      )}
      <div class="command-bar-composer">
        <IconSteer size={15} class="command-bar-icon" />
        {showPicker && (
          <select
            class="command-bar-target"
            aria-label="Steer which agent"
            title="Connected agents — steering reaches all of them unless you address one"
            value={effectiveTarget ?? ''}
            onChange={(e) => setTarget((e.target as HTMLSelectElement).value || null)}
          >
            <option value="">All agents</option>
            {agents.map((agent) => {
              // Pump health at the point of choice: unclaimed steers already
              // sitting in this agent's queue (a growing number means its loop
              // is not polling), and proof-of-polling when its consumer key
              // claimed recently — attached alone doesn't mean anyone reads
              // the inbox.
              const queued = agent.pendingSteers && agent.pendingSteers > 0 ? ` · ${agent.pendingSteers} queued` : '';
              const polling = agent.polling ? ' · polling' : '';
              return (
                <option key={agent.value} value={agent.value} disabled={!agent.steerable}>
                  {agent.attached
                    ? `${agent.label}${polling}${queued}`
                    : agent.steerable
                      ? `${agent.label} · writer${polling}${queued}`
                      : `${agent.label} · no inbox`}
                </option>
              );
            })}
          </select>
        )}
        <input
          class="command-bar-input"
          type="text"
          value={draft}
          placeholder={`Steer ${effective?.label ?? 'the agent'}, or ${modChord('K')} to search the board…`}
          aria-label="Steer the agent"
          disabled={sending}
          onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <button
          type="button"
          class="command-bar-send"
          disabled={sending || !draft.trim()}
          onClick={() => void submit()}
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
