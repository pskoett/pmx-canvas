import { useCallback } from 'preact/hooks';
import { IconArrange } from '../icons';
import { attentionHistoryOpen } from '../state/attention-store';
import {
  addContextPins,
  alignSelection,
  arrangeSelection,
  clearSelection,
  contextPinnedNodeIds,
  distributeSelection,
  removeNode,
  selectedNodeIds,
} from '../state/canvas-store';
import { createEdgeFromClient, createGroupFromClient, removeNodeFromClient } from '../state/intent-bridge';
import { sessionActive } from '../state/presence-store';
import { BarHint } from './BarHint';

/**
 * Floating bottom-center bar for a multi-selection (rail-chrome-v2 phase 7,
 * design item 13): count, align left/top, distribute, auto-arrange, Group (G),
 * Connect, Pin to agent context, delete. Restyle over the existing handlers —
 * the geometry actions live in the store and persist like a drag does.
 */
export function SelectionBar() {
  const count = selectedNodeIds.value.size;

  const handlePinContext = useCallback(() => {
    const ids = Array.from(selectedNodeIds.value);
    if (ids.length === 0) return;
    addContextPins(ids);
    clearSelection();
  }, []);

  const handleGroup = useCallback(() => {
    const ids = Array.from(selectedNodeIds.value);
    if (ids.length === 0) return;
    createGroupFromClient({ title: 'Group', childIds: ids });
    clearSelection();
  }, []);

  const handleConnect = useCallback(() => {
    const ids = Array.from(selectedNodeIds.value);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        createEdgeFromClient(ids[i], ids[j], 'relation');
      }
    }
    clearSelection();
  }, []);

  const handleDelete = useCallback(() => {
    const ids = Array.from(selectedNodeIds.value);
    for (const id of ids) {
      removeNode(id);
      void removeNodeFromClient(id);
    }
    clearSelection();
  }, []);

  if (count === 0) return null;
  const many = count >= 2;
  // The quiet board's pin bar shares the bottom-center slot (same rule as
  // `ContextPinBar`'s own visibility) — sit above it rather than under it.
  const abovePinBar = !sessionActive.value && contextPinnedNodeIds.value.size > 0 && !attentionHistoryOpen.value;

  return (
    <div class={`selection-bar${abovePinBar ? ' is-above-pin-bar' : ''}`} role="toolbar" aria-label="Selection">
      <span class="selection-bar-count">
        {count} node{count !== 1 ? 's' : ''} selected
      </span>
      {many && (
        <>
          <span class="selection-bar-sep" />
          <BarHint label="Align left" side="up">
            <button
              type="button"
              class="selection-bar-icon"
              aria-label="Align left"
              onClick={() => alignSelection('left')}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <line x1="2.5" y1="2" x2="2.5" y2="14" />
                <rect x="5" y="3.5" width="8" height="3.5" rx="1" />
                <rect x="5" y="9" width="5" height="3.5" rx="1" />
              </svg>
            </button>
          </BarHint>
          <BarHint label="Align top" side="up">
            <button
              type="button"
              class="selection-bar-icon"
              aria-label="Align top"
              onClick={() => alignSelection('top')}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <line x1="2" y1="2.5" x2="14" y2="2.5" />
                <rect x="3.5" y="5" width="3.5" height="8" rx="1" />
                <rect x="9" y="5" width="3.5" height="5" rx="1" />
              </svg>
            </button>
          </BarHint>
          <BarHint
            label="Distribute horizontally"
            body="Evens the gaps. A selection that cannot fit flows into a clean row instead of overlapping."
            side="up"
          >
            <button
              type="button"
              class="selection-bar-icon"
              aria-label="Distribute"
              disabled={count < 3}
              onClick={() => distributeSelection()}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                aria-hidden="true"
              >
                <rect x="1.5" y="5" width="3.5" height="6" rx="1" />
                <rect x="6.25" y="5" width="3.5" height="6" rx="1" />
                <rect x="11" y="5" width="3.5" height="6" rx="1" />
              </svg>
            </button>
          </BarHint>
          <BarHint label="Auto-arrange selection" side="up">
            <button
              type="button"
              class="selection-bar-icon"
              aria-label="Auto-arrange"
              onClick={() => arrangeSelection()}
            >
              <IconArrange size={14} />
            </button>
          </BarHint>
          <span class="selection-bar-sep" />
          <BarHint label="Group the selection" shortcut="G" side="up">
            <button type="button" class="selection-bar-action" onClick={handleGroup}>
              <svg
                width="13"
                height="13"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-dasharray="3 2.5"
                aria-hidden="true"
              >
                <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
              </svg>
              Group
            </button>
          </BarHint>
          <BarHint label="Connect every pair" side="up">
            <button type="button" class="selection-bar-action" onClick={handleConnect}>
              Connect
            </button>
          </BarHint>
        </>
      )}
      <BarHint label="Pin to agent context" side="up">
        <button type="button" class="selection-bar-action is-pin" onClick={handlePinContext}>
          <span aria-hidden="true">✦</span>
          Pin as context
        </button>
      </BarHint>
      <span class="selection-bar-sep" />
      <BarHint label="Delete selection" side="up">
        <button type="button" class="selection-bar-icon is-danger" aria-label="Delete selection" onClick={handleDelete}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M2.5 4 H13.5" />
            <path d="M5.5 4 V2.5 H10.5 V4" />
            <path d="M4 4 L4.8 13.5 H11.2 L12 4" />
          </svg>
        </button>
      </BarHint>
      <BarHint label="Clear selection" shortcut="Esc" side="up">
        <button type="button" class="selection-bar-icon" onClick={clearSelection} aria-label="Clear selection">
          ×
        </button>
      </BarHint>
    </div>
  );
}
