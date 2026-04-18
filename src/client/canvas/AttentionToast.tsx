import { attentionToast } from '../state/attention-store';

export function AttentionToast() {
  const toast = attentionToast.value;
  if (!toast) return null;

  return (
    <div class={`attention-toast attention-tone-${toast.tone}`} aria-live="polite" aria-atomic="true">
      <div class="attention-toast-kicker">Board Read</div>
      <div class="attention-toast-title">{toast.title}</div>
      {toast.detail && <div class="attention-toast-detail">{toast.detail}</div>}
    </div>
  );
}
