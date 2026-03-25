import { clearContextPins, contextPinnedNodeIds } from '../state/canvas-store';

export function ContextPinHud() {
  const count = contextPinnedNodeIds.value.size;
  if (count === 0) return null;

  return (
    <div class="context-pin-hud">
      <span class="context-pin-hud-label">
        {'\u2726'} {count} in context
      </span>
      <button
        type="button"
        class="context-pin-hud-clear"
        onClick={clearContextPins}
        title="Clear all context pins"
      >
        ×
      </button>
    </div>
  );
}
