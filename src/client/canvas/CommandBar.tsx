import { useState } from 'preact/hooks';
import { IconSteer } from '../icons';
import { contextPinnedNodeIds, nodes, toggleContextPin } from '../state/canvas-store';
import { sendSteering } from '../state/session-store';
import { MOD_KEY } from '../utils/platform';

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

  const submit = async () => {
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true);
    const ok = await sendSteering(message);
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
        <input
          class="command-bar-input"
          type="text"
          value={draft}
          placeholder={`Steer the agent, or ${MOD_KEY}+K to search the board…`}
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
