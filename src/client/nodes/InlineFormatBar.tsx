import type { RefObject } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { promptAndInsertLink, wrapSelectionInCode } from './inline-editor-commands';

const GAP = 8;

type ExecCommand =
  | 'bold'
  | 'italic'
  | 'strikeThrough'
  | 'formatBlock'
  | 'insertUnorderedList'
  | 'insertOrderedList';

type BlockTag = 'H1' | 'H2' | 'H3' | 'P' | 'BLOCKQUOTE';

type Action =
  | { kind: 'exec'; command: Exclude<ExecCommand, 'formatBlock'>; icon: string; title: string; dividerBefore?: boolean }
  | { kind: 'block'; tag: BlockTag; icon: string; title: string; dividerBefore?: boolean }
  | { kind: 'code'; icon: string; title: string; dividerBefore?: boolean }
  | { kind: 'link'; icon: string; title: string; dividerBefore?: boolean };

const ACTIONS: Action[] = [
  { kind: 'exec', command: 'bold', icon: 'B', title: 'Bold (⌘B)' },
  { kind: 'exec', command: 'italic', icon: 'I', title: 'Italic (⌘I)' },
  { kind: 'exec', command: 'strikeThrough', icon: 'S', title: 'Strikethrough' },
  { kind: 'code', icon: '{ }', title: 'Inline code', dividerBefore: true },
  { kind: 'block', tag: 'H1', icon: 'H1', title: 'Heading 1', dividerBefore: true },
  { kind: 'block', tag: 'H2', icon: 'H2', title: 'Heading 2' },
  { kind: 'block', tag: 'H3', icon: 'H3', title: 'Heading 3' },
  { kind: 'block', tag: 'P', icon: '¶', title: 'Paragraph' },
  { kind: 'block', tag: 'BLOCKQUOTE', icon: '❝', title: 'Quote', dividerBefore: true },
  { kind: 'exec', command: 'insertUnorderedList', icon: '•', title: 'Bullet list' },
  { kind: 'exec', command: 'insertOrderedList', icon: '1.', title: 'Numbered list' },
  { kind: 'link', icon: '🔗', title: 'Link (⌘K)', dividerBefore: true },
];

function runAction(action: Action): void {
  switch (action.kind) {
    case 'exec':
      document.execCommand(action.command);
      return;
    case 'block':
      document.execCommand('formatBlock', false, action.tag);
      return;
    case 'code':
      wrapSelectionInCode();
      return;
    case 'link':
      promptAndInsertLink();
      return;
  }
}

/** Floating selection toolbar for a contentEditable host. Mounts once; while
 *  visible, positions itself above the current selection's viewport rect. */
export function InlineFormatBar({
  hostRef,
  onChange,
}: {
  hostRef: RefObject<HTMLElement>;
  onChange: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [barWidth, setBarWidth] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  const recompute = useCallback(() => {
    const host = hostRef.current;
    if (!host) {
      setVisible(false);
      return;
    }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setVisible(false);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!host.contains(range.commonAncestorContainer)) {
      setVisible(false);
      return;
    }
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setVisible(false);
      return;
    }
    // Use measured width if we have it; fall back to a conservative estimate
    // on the very first show before layout completes.
    const width = barWidth || 420;
    const left = Math.max(
      GAP,
      Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - GAP),
    );
    const top = Math.max(GAP, rect.top - GAP - 36);
    setPos({ top, left });
    setVisible(true);
  }, [hostRef, barWidth]);

  // Coalesce selection/scroll/resize into at most one recompute per frame.
  const schedule = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      recompute();
    });
  }, [recompute]);

  useEffect(() => {
    document.addEventListener('selectionchange', schedule);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => {
      document.removeEventListener('selectionchange', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [schedule]);

  // Measure the bar once visible so subsequent shows use the real width.
  useLayoutEffect(() => {
    if (!visible) return;
    const el = barRef.current;
    if (!el) return;
    const measured = el.getBoundingClientRect().width;
    if (measured && Math.abs(measured - barWidth) > 1) setBarWidth(measured);
  }, [visible, barWidth]);

  const handleClick = useCallback(
    (action: Action) => {
      runAction(action);
      onChange();
      recompute();
    },
    [onChange, recompute],
  );

  if (!visible) return null;

  return (
    <div
      ref={barRef}
      class="md-inline-format-bar"
      style={{ top: `${pos.top}px`, left: `${pos.left}px` }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {ACTIONS.flatMap((a, i) => {
        const btn = (
          <button
            key={`btn-${i}`}
            type="button"
            class="md-inline-format-btn"
            title={a.title}
            onClick={() => handleClick(a)}
          >
            {a.icon}
          </button>
        );
        return a.dividerBefore
          ? [<span key={`div-${i}`} class="md-inline-format-divider" />, btn]
          : [btn];
      })}
    </div>
  );
}
