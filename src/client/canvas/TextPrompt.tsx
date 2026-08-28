import { signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';

/**
 * In-canvas replacement for `window.prompt`, which embedded browser panes
 * silently no-op (a Shift+F that "does nothing") and no test can drive. One
 * request at a time; a new ask cancels the previous one.
 */
interface TextPromptRequest {
  title: string;
  placeholder: string;
  /** Prefilled (and pre-selected) value — edit flows start from the current text. */
  initial: string;
  /** Submitting an empty field resolves '' instead of null — "clear the value" flows. */
  allowEmpty: boolean;
  confirm: string;
  /** Bumped per ask so consecutive requests get a FRESH input element. */
  seq: number;
  resolve: (value: string | null) => void;
}

export const textPromptRequest = signal<TextPromptRequest | null>(null);
let promptSeq = 0;

export function askText(
  title: string,
  placeholder: string,
  opts: { initial?: string; allowEmpty?: boolean; confirm?: string } = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    textPromptRequest.value?.resolve(null);
    promptSeq += 1;
    textPromptRequest.value = {
      seq: promptSeq,
      title,
      placeholder,
      initial: opts.initial ?? '',
      allowEmpty: opts.allowEmpty ?? false,
      confirm: opts.confirm ?? 'Add',
      resolve,
    };
  });
}

function settle(value: string | null): void {
  const request = textPromptRequest.value;
  textPromptRequest.value = null;
  request?.resolve(value);
}

export function TextPrompt() {
  const request = textPromptRequest.value;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!request) return;
    // Esc closes the dialog wherever focus sits (a click can move focus off the
    // input, and the global shortcut layer must never see this Esc). Focus and
    // the prefill are NOT here: an effect runs a frame after the dialog paints,
    // and a key (or a test's fill) inside that gap lands on the wrong target.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      settle(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [request]);

  if (!request) return null;

  const submit = () => {
    const value = inputRef.current?.value.trim() ?? '';
    settle(value ? value : request.allowEmpty ? '' : null);
  };

  return (
    <div class="text-prompt-backdrop" onPointerDown={() => settle(null)}>
      <div
        class="text-prompt"
        role="dialog"
        aria-label={request.title}
        data-testid="text-prompt"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div class="text-prompt-title">{request.title}</div>
        <input
          // A fresh element per ask (so defaultValue applies) focused in the
          // ref callback, which Preact runs synchronously during commit — the
          // dialog is never on screen unfocused.
          key={request.seq}
          ref={(el) => {
            inputRef.current = el;
            if (!el) return;
            el.focus();
            // Edit flows prefill — selecting it lets a retype replace in one stroke.
            if (request.initial) el.select();
          }}
          class="text-prompt-input"
          type="text"
          defaultValue={request.initial}
          placeholder={request.placeholder}
          onKeyDown={(e) => {
            // Contained: the global shortcut layer must not see these.
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              submit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              settle(null);
            }
          }}
        />
        <div class="text-prompt-actions">
          <button type="button" class="text-prompt-cancel" onClick={() => settle(null)}>
            Cancel
          </button>
          <button type="button" class="text-prompt-confirm" onClick={submit}>
            {request.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
