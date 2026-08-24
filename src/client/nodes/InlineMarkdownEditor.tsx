import { gfm } from '@joplin/turndown-plugin-gfm';
import TurndownService from 'turndown';
import { useCallback, useEffect, useRef } from 'preact/hooks';
import { InlineFormatBar } from './InlineFormatBar';
import { promptAndInsertLink } from './inline-editor-commands';

let _turndown: TurndownService | null = null;
function getTurndown(): TurndownService {
  if (_turndown) return _turndown;
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    bulletListMarker: '-',
  });
  td.use(gfm);
  _turndown = td;
  return td;
}

/** Fully inline WYSIWYG editor. The rendered HTML is the editor.
 *
 *  Two persistence signals:
 *  - `onChange(md)` — fires on every input. Caller typically debounces.
 *  - `onSave(md)`  — fires on ⌘S and blur. Caller should persist immediately
 *    and cancel any pending debounced save, since `md` is the authoritative
 *    latest content. Both receive freshly-serialized markdown so the caller
 *    never reads a stale state snapshot. */
export function InlineMarkdownEditor({
  initialHtml,
  className,
  onChange,
  onSave,
}: {
  initialHtml: string;
  className?: string;
  onChange: (markdown: string) => void;
  onSave?: (markdown: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  // Capture mount-time HTML — decouples us from prop identity churn under
  // strict-mode double-invoke. Re-mount via `key` to swap documents.
  const initialHtmlRef = useRef(initialHtml);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    el.innerHTML = initialHtmlRef.current;
    // GFM task checkboxes are live in the editor too: marked emits them
    // `disabled`, which also swallows clicks in the expanded view.
    for (const box of el.querySelectorAll('input[type="checkbox"][disabled]')) {
      box.removeAttribute('disabled');
    }
  }, []);

  const serialize = useCallback((): string => {
    const el = rootRef.current;
    if (!el) return '';
    return getTurndown().turndown(el.innerHTML);
  }, []);

  const handleInput = useCallback(() => {
    onChange(serialize());
  }, [onChange, serialize]);

  const handleSave = useCallback(() => {
    // A blur fired by unmounting (Esc closes the overlay while the editor is
    // focused) reads back an empty tree — saving that would WIPE the document.
    const el = rootRef.current;
    if (!el || !el.isConnected || el.innerHTML === '') return;
    onSave?.(serialize());
  }, [onSave, serialize]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === 's') {
        e.preventDefault();
        handleSave();
        return;
      }
      if (e.key === 'b') {
        e.preventDefault();
        document.execCommand('bold');
        handleInput();
        return;
      }
      if (e.key === 'i') {
        e.preventDefault();
        document.execCommand('italic');
        handleInput();
        return;
      }
      if (e.key === 'k') {
        e.preventDefault();
        promptAndInsertLink();
        handleInput();
      }
    },
    [handleInput, handleSave],
  );

  // A checkbox click inside contenteditable toggles the DOM property but
  // fires no `input` event — serialize explicitly (turndown's GFM rule reads
  // `node.checked`) so the tick persists like any other edit.
  const handleClick = useCallback(
    (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement && target.type === 'checkbox') {
        // Serialization parses innerHTML — a string, which carries ATTRIBUTES
        // only. Mirror the clicked property onto the attribute or the tick
        // vanishes on the next round-trip.
        target.toggleAttribute('checked', target.checked);
        handleInput();
      }
    },
    [handleInput],
  );

  // Arbitrary rich HTML (Word, the web) would force turndown to sanitize a
  // far wider surface and tends to lose fidelity — plain text is safer.
  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text/plain');
      if (text == null) return;
      e.preventDefault();
      document.execCommand('insertText', false, text);
      handleInput();
    },
    [handleInput],
  );

  return (
    <>
      <div
        ref={rootRef}
        class={className}
        contentEditable
        spellcheck={false}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onClick={handleClick}
        onBlur={handleSave}
      />
      <InlineFormatBar hostRef={rootRef} onChange={handleInput} />
    </>
  );
}
