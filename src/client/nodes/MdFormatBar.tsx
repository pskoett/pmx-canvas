import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { isMac } from '../utils/platform';
import { type FormatAction, FORMAT_ACTIONS, getSelectionRect } from './md-format';

const PRIMARY_ACTIONS = FORMAT_ACTIONS.filter((a) => a.shortcut);
const SECONDARY_ACTIONS = FORMAT_ACTIONS.filter((a) => !a.shortcut);

/**
 * Floating format toolbar that appears above text selections in markdown textareas.
 */
export function MdFormatBar({ textareaRef }: { textareaRef: { current: HTMLTextAreaElement | null } }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const barRef = useRef<HTMLDivElement>(null);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updatePosition = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta || ta.selectionStart === ta.selectionEnd) {
      setVisible(false);
      return;
    }
    const rect = getSelectionRect(ta);
    if (!rect) {
      setVisible(false);
      return;
    }
    const barWidth = 380;
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - barWidth / 2, window.innerWidth - barWidth - 8));
    setPos({ top: rect.top - 40, left });
    setVisible(true);
  }, [textareaRef]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;

    const handleSelect = () => {
      if (hideTimeout.current) clearTimeout(hideTimeout.current);
      hideTimeout.current = setTimeout(updatePosition, 50);
    };

    const handleBlur = () => {
      hideTimeout.current = setTimeout(() => setVisible(false), 200);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.shiftKey || e.key.startsWith('Arrow')) handleSelect();
    };

    ta.addEventListener('select', handleSelect);
    ta.addEventListener('mouseup', handleSelect);
    ta.addEventListener('keyup', handleKeyUp);
    ta.addEventListener('blur', handleBlur);

    return () => {
      ta.removeEventListener('select', handleSelect);
      ta.removeEventListener('mouseup', handleSelect);
      ta.removeEventListener('keyup', handleKeyUp);
      ta.removeEventListener('blur', handleBlur);
      if (hideTimeout.current) clearTimeout(hideTimeout.current);
    };
  }, [textareaRef, updatePosition]);

  const runAction = useCallback((action: FormatAction) => {
    const ta = textareaRef.current;
    if (ta) {
      action.action(ta);
      ta.focus();
    }
  }, [textareaRef]);

  if (!visible) return null;

  const modLabel = isMac ? '⌘' : 'Ctrl';

  return (
    <div
      ref={barRef}
      class="md-format-bar"
      style={{ top: `${pos.top}px`, left: `${pos.left}px` }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {PRIMARY_ACTIONS.map((a) => (
        <button
          key={a.key}
          type="button"
          class={`md-format-btn md-format-btn-${a.key}`}
          title={`${a.label} (${modLabel}+${a.shortcut!.toUpperCase()})`}
          onClick={() => runAction(a)}
        >
          {a.icon}
        </button>
      ))}
      <div class="md-format-divider" />
      {SECONDARY_ACTIONS.map((a) => (
        <button
          key={a.key}
          type="button"
          class={`md-format-btn md-format-btn-${a.key}`}
          title={a.label}
          onClick={() => runAction(a)}
        >
          {a.icon}
        </button>
      ))}
    </div>
  );
}
