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
  resolve: (value: string | null) => void;
}

export const textPromptRequest = signal<TextPromptRequest | null>(null);

export function askText(title: string, placeholder: string): Promise<string | null> {
  return new Promise((resolve) => {
    textPromptRequest.value?.resolve(null);
    textPromptRequest.value = { title, placeholder, resolve };
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
    if (request) inputRef.current?.focus();
  }, [request]);

  if (!request) return null;

  const submit = () => {
    const value = inputRef.current?.value.trim() ?? '';
    settle(value ? value : null);
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
          ref={inputRef}
          class="text-prompt-input"
          type="text"
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
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
