import { useRef, useState } from 'preact/hooks';
import { useFocusTrap } from './use-focus-trap';

/** Draft only: GitHub owns authentication and the final public submission. */
export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLFormElement>(null);
  const [kind, setKind] = useState('Bug report');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  useFocusTrap(ref, true);

  return (
    <div class="text-prompt-backdrop feedback-backdrop" onPointerDown={onClose}>
      <form
        ref={ref}
        class="text-prompt feedback-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        aria-describedby="feedback-privacy"
        action="https://github.com/pskoett/pmx-canvas/issues/new"
        method="get"
        target="_blank"
        rel="noopener noreferrer"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
      >
        <div id="feedback-title" class="text-prompt-title">
          Bug and feedback
        </div>
        <p id="feedback-privacy" class="feedback-note">
          Opens a draft issue in pskoett/pmx-canvas. Review and submit it on GitHub using your account. Issues are
          public. Only what you enter below is included; no board contents, workspace paths, screenshots, or logs are
          attached.
        </p>
        <label>
          Feedback type
          <select class="text-prompt-input" value={kind} onChange={(e) => setKind(e.currentTarget.value)}>
            <option>Bug report</option>
            <option>Feature request</option>
            <option>General feedback</option>
          </select>
        </label>
        <label>
          Title
          <input
            class="text-prompt-input"
            name="title"
            required
            maxLength={120}
            value={title}
            onInput={(e) => setTitle(e.currentTarget.value)}
            placeholder="A short summary"
          />
        </label>
        <label>
          Description
          <textarea
            class="text-prompt-input"
            required
            maxLength={1200}
            rows={6}
            value={description}
            onInput={(e) => setDescription(e.currentTarget.value)}
            placeholder="What happened, what you expected, and steps to reproduce — or describe your idea."
          />
        </label>
        <input type="hidden" name="body" value={`## ${kind}\n\n${description.trim()}`} />
        <div class="text-prompt-actions">
          <button type="button" class="text-prompt-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" class="text-prompt-confirm" disabled={!title.trim() || !description.trim()}>
            Continue on GitHub ↗
          </button>
        </div>
      </form>
    </div>
  );
}
