import { attentionToast, openAttentionHistory } from '../state/attention-store';

export function AttentionToast() {
  const toast = attentionToast.value;
  if (!toast) return null;

  return (
    <button
      type="button"
      class={`attention-toast attention-tone-${toast.tone}`}
      onClick={openAttentionHistory}
      aria-label={`${toast.title} — open change history`}
      title={toast.detail || toast.title}
    >
      <span class="attention-toast-dot" aria-hidden="true" />
      <span class="attention-toast-title">{toast.title}</span>
    </button>
  );
}
