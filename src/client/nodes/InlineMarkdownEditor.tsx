import { gfm } from '@joplin/turndown-plugin-gfm';
import TurndownService from 'turndown';
import { useCallback, useLayoutEffect, useRef } from 'preact/hooks';
import { InlineFormatBar } from './InlineFormatBar';
import { promptAndInsertLink } from './inline-editor-commands';
import { sanitizeMarkdownHtml } from './markdown-sanitize';

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
  td.addRule('wikiLink', {
    filter: (node) => node.nodeName === 'A' && node.hasAttribute('data-wiki-markdown'),
    replacement: (_content, node) => {
      const label = node.textContent ?? '';
      return label === node.getAttribute('data-wiki-label')
        ? node.getAttribute('data-wiki-markdown')!
        : `[[${node.getAttribute('data-wiki-ref')}|${label}]]`;
    },
  });
  _turndown = td;
  return td;
}

/** Fully inline WYSIWYG editor. The rendered HTML is the editor.
 *
 *  Two persistence signals:
 *  - `onChange(md)` — fires on every input. Caller typically debounces.
 *  - `onSave(md)`  — fires on ⌘S and blur. Caller should persist dirty drafts immediately
 *    and cancel any pending debounced save, since `md` is the authoritative
 *    latest content: the exact caller draft until input, serialized DOM after it. */
export function InlineMarkdownEditor({
  markdown,
  initialHtml,
  className,
  onChange,
  onSave,
}: {
  markdown: string;
  initialHtml: string;
  className?: string;
  onChange: (markdown: string) => void;
  onSave?: (markdown: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const edited = useRef(false);
  const displayedMarkdown = useRef(markdown);
  const previousMarkdown = useRef(markdown);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const html = sanitizeMarkdownHtml(initialHtml);
    const sourceChanged = previousMarkdown.current !== markdown;
    previousMarkdown.current = markdown;
    if (!initialized.current || (sourceChanged && displayedMarkdown.current !== markdown)) {
      initialized.current = true;
      displayedMarkdown.current = markdown;
      edited.current = false;
      el.innerHTML = html;
      // Marked emits disabled GFM boxes; they are editable here.
      for (const box of el.querySelectorAll('input[type="checkbox"][disabled]')) box.removeAttribute('disabled');
      return;
    }
    // Local input already owns this Markdown. Only a different accepted source
    // replaces it; metadata-only refreshes must not move the selection.
    const fresh = document.createElement('div');
    fresh.innerHTML = html;
    const links = new Map(
      [...fresh.querySelectorAll('a[data-wiki-ref]')].map((link) => [link.getAttribute('data-wiki-ref'), link]),
    );
    for (const link of el.querySelectorAll('a[data-wiki-ref]')) {
      const replacement = links.get(link.getAttribute('data-wiki-ref'));
      if (!replacement) continue;
      for (const attribute of ['data-wiki-board', 'data-wiki-card', 'data-wiki-missing']) {
        const value = replacement.getAttribute(attribute);
        if (value === null) link.removeAttribute(attribute);
        else link.setAttribute(attribute, value);
      }
      link.classList.toggle('is-unresolved', replacement.classList.contains('is-unresolved'));
    }
  }, [initialHtml, markdown]);

  const serialize = useCallback((): string => {
    const el = rootRef.current;
    if (!el) return '';
    return getTurndown().turndown(el.innerHTML);
  }, []);

  const handleInput = useCallback(() => {
    edited.current = true;
    const md = serialize();
    displayedMarkdown.current = md;
    onChange(md);
  }, [onChange, serialize]);

  const handleSave = useCallback(() => {
    // A blur fired by unmounting (Esc closes the overlay while the editor is
    // focused) reads back an empty tree — saving that would WIPE the document.
    const el = rootRef.current;
    if (!el || !el.isConnected || el.innerHTML === '') return;
    // Turndown cannot round-trip source spacing. Until this editor receives
    // input, flush the caller's exact draft (including edits from Source mode).
    onSave?.(edited.current ? serialize() : markdown);
  }, [markdown, onSave, serialize]);

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
