import { useCallback } from 'preact/hooks';
import {
  addNode,
  bringToFront,
  clearContextPins,
  contextPinnedNodeIds,
  getContextPinnedNodes,
  viewport,
} from '../state/canvas-store';

export function ContextPinBar() {
  const count = contextPinnedNodeIds.value.size;
  if (count === 0) return null;

  const handleAskWithContext = useCallback(() => {
    const pinned = getContextPinnedNodes();
    if (pinned.length === 0) return;

    // Place prompt node at center of viewport
    const v = viewport.value;
    const cx = (window.innerWidth / 2 - v.x) / v.scale;
    const cy = (window.innerHeight / 2 - v.y) / v.scale;
    const contextNodeIds = pinned.map((n) => n.id);
    const id = `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    addNode({
      id,
      type: 'prompt',
      position: { x: cx - 260, y: cy - 90 },
      size: { width: 520, height: 400 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      dockPosition: null,
      data: { text: '', turns: [], threadStatus: 'draft', status: 'draft', contextNodeIds },
    });
    bringToFront(id);
  }, []);

  return (
    <div class="context-pin-bar">
      <span class="context-pin-bar-count">
        {'\u2726'} {count} node{count !== 1 ? 's' : ''} in context
      </span>
      <button
        type="button"
        class="context-pin-bar-btn context-pin-bar-ask"
        onClick={handleAskWithContext}
      >
        Ask with context
      </button>
      <button
        type="button"
        class="context-pin-bar-btn context-pin-bar-clear"
        onClick={clearContextPins}
        title="Clear all context pins"
      >
        {'\u00d7'}
      </button>
    </div>
  );
}
