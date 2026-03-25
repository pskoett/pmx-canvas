import {
  clearContextPins,
  contextPinnedNodeIds,
} from '../state/canvas-store';

export function ContextPinBar() {
  const count = contextPinnedNodeIds.value.size;
  if (count === 0) return null;

  return (
    <div class="context-pin-bar">
      <span class="context-pin-bar-count">
        {'\u2726'} {count} node{count !== 1 ? 's' : ''} in context
      </span>
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
