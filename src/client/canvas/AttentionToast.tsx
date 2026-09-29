import { attentionToast, openAttentionHistory } from '../state/attention-store';

export function AttentionToast() {
  const toast = attentionToast.value;
  if (!toast) return null;

  return (
    <button
      type="button"
      class={`attention-toast attention-tone-${toast.tone}`}
      onClick={openAttentionHistory}
      aria-label={`${toast.title}${toast.detail ? `: ${toast.detail}` : ''} — open change history`}
    >
      <span class="attention-toast-dot" aria-hidden="true" />
      <span class="attention-toast-copy">
        <span class="attention-toast-title">{toast.title}</span>
        {toast.detail && <span class="attention-toast-detail">{toast.detail}</span>}
      </span>
    </button>
  );
}
