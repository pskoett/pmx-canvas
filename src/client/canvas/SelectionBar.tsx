import { useCallback } from 'preact/hooks';
import {
  addContextPins,
  addNode,
  bringToFront,
  clearSelection,
  getSelectedNodes,
  selectedNodeIds,
} from '../state/canvas-store';
import { createEdgeFromClient } from '../state/intent-bridge';

export function SelectionBar() {
  const count = selectedNodeIds.value.size;
  if (count === 0) return null;

  const handleAsk = useCallback(() => {
    const selected = getSelectedNodes();
    if (selected.length === 0) return;

    // Compute horizontal centroid and vertical bottom of selected nodes
    let cx = 0;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const n of selected) {
      cx += n.position.x + n.size.width / 2;
      const bottom = n.position.y + n.size.height;
      if (bottom > maxY) maxY = bottom;
    }
    cx /= selected.length;

    // Place prompt node below the selection, centered horizontally
    const promptX = cx - 260;
    const promptY = maxY + 40;

    const contextNodeIds = selected.map((n) => n.id);
    const id = `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    addNode({
      id,
      type: 'prompt',
      position: { x: promptX, y: promptY },
      size: { width: 520, height: 400 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      dockPosition: null,
      data: { text: '', turns: [], threadStatus: 'draft', status: 'draft', contextNodeIds },
    });
    bringToFront(id);
    clearSelection();
  }, []);

  const handlePinContext = useCallback(() => {
    const ids = Array.from(selectedNodeIds.value);
    if (ids.length === 0) return;
    addContextPins(ids);
    clearSelection();
  }, []);

  const handleConnect = useCallback(() => {
    const ids = Array.from(selectedNodeIds.value);
    // Create relation edges between all pairs
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
      <button type="button" class="selection-bar-btn selection-bar-ask" onClick={handleAsk}>
        Ask about selection
      </button>
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
