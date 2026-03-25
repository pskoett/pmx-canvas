import { useCallback } from 'preact/hooks';
import {
  addContextPins,
  clearSelection,
  selectedNodeIds,
} from '../state/canvas-store';
import { createEdgeFromClient } from '../state/intent-bridge';

export function SelectionBar() {
  const count = selectedNodeIds.value.size;
  if (count === 0) return null;

  const handlePinContext = useCallback(() => {
    const ids = Array.from(selectedNodeIds.value);
    if (ids.length === 0) return;
    addContextPins(ids);
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

  return (
    <div class="selection-bar">
      <span class="selection-bar-count">
        {'\u2726'} {count} node{count !== 1 ? 's' : ''} selected
      </span>
      <button
        type="button"
        class="selection-bar-btn selection-bar-pin-ctx"
        onClick={handlePinContext}
      >
        Pin as context
      </button>
      {count >= 2 && (
        <button type="button" class="selection-bar-btn" onClick={handleConnect}>
          Connect
        </button>
      )}
      <button
        type="button"
        class="selection-bar-btn selection-bar-clear"
        onClick={clearSelection}
        title="Clear selection"
      >
        {'\u00d7'}
      </button>
    </div>
  );
}
