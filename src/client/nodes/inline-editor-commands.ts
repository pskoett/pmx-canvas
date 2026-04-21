/** Shared contentEditable command helpers used by both the inline editor
 *  and its floating toolbar. Kept in a module that neither component
 *  depends on transitively so we don't get a circular import. */

/** Prompt for a URL and insert it as a link on the current selection.
 *  Rejects `javascript:` and `data:` schemes so a link can't execute script
 *  when clicked. */
export function promptAndInsertLink(): void {
  const url = window.prompt('Link URL:');
  if (!url) return;
  const trimmed = url.trim().toLowerCase();
  if (trimmed.startsWith('javascript:') || trimmed.startsWith('data:')) return;
  document.execCommand('createLink', false, url);
}

/** Wrap the current non-empty selection in an inline `<code>` element and
 *  place the caret immediately after the new element. No-op on collapsed
 *  selections. */
export function wrapSelectionInCode(): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return;
  const text = range.toString();
  const code = document.createElement('code');
  code.textContent = text;
  range.deleteContents();
  range.insertNode(code);
  // Build a fresh range after the inserted node — `deleteContents` mutates
  // the original range's boundaries in a way that behaves inconsistently
  // across browsers on selections spanning block boundaries.
  const after = document.createRange();
  after.setStartAfter(code);
  after.setEndAfter(code);
  sel.removeAllRanges();
  sel.addRange(after);
}
