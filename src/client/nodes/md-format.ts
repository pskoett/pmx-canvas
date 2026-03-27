/**
 * Markdown formatting helpers for textarea elements.
 * Handles: wrap-style formatting (bold, italic, code, strikethrough),
 * prefix-style formatting (headings, lists, quotes),
 * Tab/Shift+Tab indentation, and floating toolbar positioning.
 */

export interface FormatAction {
  key: string;
  label: string;
  icon: string;
  shortcut?: string;
  action: (ta: HTMLTextAreaElement) => void;
}

/** Wrap selected text with a marker (e.g. ** for bold). If no selection, insert marker pair and place cursor between. */
function wrapSelection(ta: HTMLTextAreaElement, marker: string): void {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const selected = value.slice(s, e);

  // Check if already wrapped — unwrap
  const before = value.slice(Math.max(0, s - marker.length), s);
  const after = value.slice(e, e + marker.length);
  if (before === marker && after === marker) {
    const newValue = value.slice(0, s - marker.length) + selected + value.slice(e + marker.length);
    setValueAndCursor(ta, newValue, s - marker.length, e - marker.length);
    return;
  }

  if (selected) {
    const newValue = value.slice(0, s) + marker + selected + marker + value.slice(e);
    setValueAndCursor(ta, newValue, s + marker.length, e + marker.length);
  } else {
    const newValue = value.slice(0, s) + marker + marker + value.slice(e);
    setValueAndCursor(ta, newValue, s + marker.length, s + marker.length);
  }
}

/** Prefix the current line(s) with a string (e.g. "# " for heading). */
function prefixLines(ta: HTMLTextAreaElement, prefix: string): void {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const lineStart = value.lastIndexOf('\n', s - 1) + 1;
  const lineEnd = value.indexOf('\n', e);
  const end = lineEnd === -1 ? value.length : lineEnd;
  const lineText = value.slice(lineStart, end);

  // Toggle: if already prefixed, remove
  if (lineText.startsWith(prefix)) {
    const newValue = value.slice(0, lineStart) + lineText.slice(prefix.length) + value.slice(end);
    setValueAndCursor(ta, newValue, Math.max(lineStart, s - prefix.length), Math.max(lineStart, e - prefix.length));
    return;
  }

  const newValue = value.slice(0, lineStart) + prefix + value.slice(lineStart);
  setValueAndCursor(ta, newValue, s + prefix.length, e + prefix.length);
}

/** Insert a link template, using selected text as the label. */
function insertLink(ta: HTMLTextAreaElement): void {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const selected = value.slice(s, e);
  if (selected) {
    const newValue = value.slice(0, s) + `[${selected}](url)` + value.slice(e);
    // Select "url" for easy replacement
    const urlStart = s + selected.length + 3;
    setValueAndCursor(ta, newValue, urlStart, urlStart + 3);
  } else {
    const newValue = value.slice(0, s) + '[text](url)' + value.slice(e);
    // Select "text" for easy replacement
    setValueAndCursor(ta, newValue, s + 1, s + 5);
  }
}

/** Insert a code block. */
function insertCodeBlock(ta: HTMLTextAreaElement): void {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const selected = value.slice(s, e);
  const fence = '```';
  if (selected) {
    const newValue = value.slice(0, s) + `${fence}\n${selected}\n${fence}` + value.slice(e);
    setValueAndCursor(ta, newValue, s + fence.length + 1, s + fence.length + 1 + selected.length);
  } else {
    const newValue = value.slice(0, s) + `${fence}\n\n${fence}` + value.slice(e);
    setValueAndCursor(ta, newValue, s + fence.length + 1, s + fence.length + 1);
  }
}

/** Handle Tab/Shift+Tab for indentation on current line(s). */
export function handleTab(ta: HTMLTextAreaElement, shiftKey: boolean): void {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const lineStart = value.lastIndexOf('\n', s - 1) + 1;
  const lineEnd = value.indexOf('\n', e);
  const end = lineEnd === -1 ? value.length : lineEnd;

  // Multi-line selection: indent/dedent all lines
  const lines = value.slice(lineStart, end).split('\n');
  let newS = s;
  let newE = e;

  const processed = lines.map((line, i) => {
    if (shiftKey) {
      // Dedent: remove up to 2 leading spaces or 1 tab
      if (line.startsWith('  ')) {
        if (i === 0) newS = Math.max(lineStart, newS - 2);
        newE -= 2;
        return line.slice(2);
      } else if (line.startsWith('\t')) {
        if (i === 0) newS = Math.max(lineStart, newS - 1);
        newE -= 1;
        return line.slice(1);
      }
      return line;
    } else {
      // Indent: add 2 spaces
      if (i === 0) newS += 2;
      newE += 2;
      return '  ' + line;
    }
  });

  const newValue = value.slice(0, lineStart) + processed.join('\n') + value.slice(end);
  setValueAndCursor(ta, newValue, newS, newE);
}

function setValueAndCursor(ta: HTMLTextAreaElement, value: string, selStart: number, selEnd: number): void {
  // Use native setter to trigger Preact's onInput
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(ta, value);
  } else {
    ta.value = value;
  }
  ta.selectionStart = selStart;
  ta.selectionEnd = selEnd;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Format actions available in the toolbar. */
export const FORMAT_ACTIONS: FormatAction[] = [
  { key: 'bold', label: 'Bold', icon: 'B', shortcut: 'b', action: (ta) => wrapSelection(ta, '**') },
  { key: 'italic', label: 'Italic', icon: 'I', shortcut: 'i', action: (ta) => wrapSelection(ta, '_') },
  { key: 'strike', label: 'Strikethrough', icon: 'S', shortcut: 'u', action: (ta) => wrapSelection(ta, '~~') },
  { key: 'code', label: 'Inline code', icon: '`', shortcut: 'e', action: (ta) => wrapSelection(ta, '`') },
  { key: 'link', label: 'Link', icon: '🔗', shortcut: 'k', action: insertLink },
  { key: 'h1', label: 'Heading 1', icon: 'H1', action: (ta) => prefixLines(ta, '# ') },
  { key: 'h2', label: 'Heading 2', icon: 'H2', action: (ta) => prefixLines(ta, '## ') },
  { key: 'quote', label: 'Blockquote', icon: '❝', action: (ta) => prefixLines(ta, '> ') },
  { key: 'ul', label: 'Bullet list', icon: '•', action: (ta) => prefixLines(ta, '- ') },
  { key: 'ol', label: 'Numbered list', icon: '1.', action: (ta) => prefixLines(ta, '1. ') },
  { key: 'codeblock', label: 'Code block', icon: '{ }', action: insertCodeBlock },
];

/** Handle Cmd/Ctrl+key formatting shortcuts in a textarea. Returns true if handled. */
export function handleFormatShortcut(e: KeyboardEvent, ta: HTMLTextAreaElement): boolean {
  if (!(e.metaKey || e.ctrlKey)) return false;
  const action = FORMAT_ACTIONS.find((a) => a.shortcut === e.key);
  if (!action) return false;
  e.preventDefault();
  action.action(ta);
  return true;
}

/** Get the screen rect of the current text selection for positioning a floating toolbar. */
export function getSelectionRect(ta: HTMLTextAreaElement): { top: number; left: number; width: number } | null {
  if (ta.selectionStart === ta.selectionEnd) return null;

  // Create a mirror div to measure cursor position
  const mirror = document.createElement('div');
  const style = getComputedStyle(ta);
  const props = [
    'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
    'wordSpacing', 'textIndent', 'whiteSpace', 'wordWrap', 'overflowWrap',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'boxSizing', 'width',
  ] as const;
  for (const p of props) {
    (mirror.style as any)[p] = style[p as any];
  }
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.overflow = 'hidden';
  mirror.style.height = 'auto';
  mirror.style.top = '0';
  mirror.style.left = '0';

  const text = ta.value;
  const beforeText = document.createTextNode(text.slice(0, ta.selectionStart));
  const span = document.createElement('span');
  span.textContent = text.slice(ta.selectionStart, ta.selectionEnd) || '.';
  mirror.appendChild(beforeText);
  mirror.appendChild(span);
  mirror.appendChild(document.createTextNode(text.slice(ta.selectionEnd)));

  document.body.appendChild(mirror);
  const spanRect = span.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  const taRect = ta.getBoundingClientRect();
  document.body.removeChild(mirror);

  return {
    top: taRect.top + (spanRect.top - mirrorRect.top) - ta.scrollTop,
    left: taRect.left + (spanRect.left - mirrorRect.left) - ta.scrollLeft,
    width: spanRect.width,
  };
}
