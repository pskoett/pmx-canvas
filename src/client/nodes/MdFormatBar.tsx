import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { FORMAT_ACTIONS, getSelectionRect } from './md-format';

/**
 * Floating format toolbar that appears above text selections in markdown textareas.
 * Shows formatting buttons (bold, italic, code, link, headings, etc.)
 */
export function MdFormatBar({ textareaRef }: { textareaRef: { current: HTMLTextAreaElement | null } }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const barRef = useRef<HTMLDivElement>(null);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updatePosition = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (ta.selectionStart === ta.selectionEnd) {
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
      // Small delay to let selection stabilize
      hideTimeout.current = setTimeout(updatePosition, 50);
    };

    const handleBlur = () => {
      // Delay hide so clicking toolbar buttons works
      hideTimeout.current = setTimeout(() => setVisible(false), 200);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      // Update on arrow keys or shift+arrow (selection change)
      if (e.shiftKey || e.key.startsWith('Arrow')) {
        handleSelect();
      }
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

  if (!visible) return null;

  // Split actions into primary (with shortcuts) and secondary groups
  const primary = FORMAT_ACTIONS.filter((a) => a.shortcut);
  const secondary = FORMAT_ACTIONS.filter((a) => !a.shortcut);

  return (
    <div
      ref={barRef}
      class="md-format-bar"
      style={{ top: `${pos.top}px`, left: `${pos.left}px` }}
      onMouseDown={(e) => e.preventDefault()} // prevent textarea blur
    >
      {primary.map((a) => (
        <button
          key={a.key}
          type="button"
          class={`md-format-btn md-format-btn-${a.key}`}
          title={`${a.label} (${isMac ? '⌘' : 'Ctrl'}+${a.shortcut!.toUpperCase()})`}
          onClick={() => {
            const ta = textareaRef.current;
            if (ta) {
              a.action(ta);
              ta.focus();
            }
          }}
        >
          {a.icon}
        </button>
      ))}
      <div class="md-format-divider" />
      {secondary.map((a) => (
        <button
          key={a.key}
          type="button"
          class={`md-format-btn md-format-btn-${a.key}`}
          title={a.label}
          onClick={() => {
            const ta = textareaRef.current;
            if (ta) {
              a.action(ta);
              ta.focus();
            }
          }}
        >
          {a.icon}
        </button>
      ))}
    </div>
  );
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
